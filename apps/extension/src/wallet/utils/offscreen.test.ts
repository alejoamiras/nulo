import { beforeEach, describe, expect, test, vi, type Mock } from "vitest"
import {
	ensureOffscreenRunning,
	isSupersededByAdopt,
	OFFSCREEN_ADOPT_INSTANCE,
	OFFSCREEN_PING,
	OFFSCREEN_PONG,
	OFFSCREEN_READY_MESSAGE,
	shouldRespondPong,
} from "./offscreen"

const sw = { id: "nulo-ext-id" } as chrome.runtime.MessageSender
const tabSender = { id: "nulo-ext-id", tab: { id: 1 } } as unknown as chrome.runtime.MessageSender
const foreign = { id: "other-ext" } as chrome.runtime.MessageSender
const adopt = (token: string) => ({ type: OFFSCREEN_ADOPT_INSTANCE, token })

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: ensure chrome.runtime.id without clobbering the shared stub
	const c = ((globalThis as any).chrome ??= {})
	c.runtime = { ...c.runtime, id: "nulo-ext-id" }
})

describe("isSupersededByAdopt (F-10 stale-offscreen self-close)", () => {
	test("two stale windows are superseded by a fresh instance; the fresh one is not", () => {
		// SW's current instance token is "fresh"; two stale windows hold old tokens.
		expect(isSupersededByAdopt(adopt("fresh"), sw, "stale-1")).toBe(true)
		expect(isSupersededByAdopt(adopt("fresh"), sw, "stale-2")).toBe(true)
		expect(isSupersededByAdopt(adopt("fresh"), sw, "fresh")).toBe(false) // matching token → stays
	})

	test("Chrome (no instance token) is never superseded", () => {
		expect(isSupersededByAdopt(adopt("fresh"), sw, null)).toBe(false)
	})

	test("ignores an ADOPT from a tab-bound or foreign sender (spoof defense)", () => {
		expect(isSupersededByAdopt(adopt("fresh"), tabSender, "stale")).toBe(false)
		expect(isSupersededByAdopt(adopt("fresh"), foreign, "stale")).toBe(false)
		expect(isSupersededByAdopt(adopt("fresh"), undefined, "stale")).toBe(false)
	})

	test("ignores non-ADOPT messages", () => {
		expect(isSupersededByAdopt("OFFSCREEN_PING", sw, "stale")).toBe(false)
		expect(isSupersededByAdopt({ type: "SOMETHING_ELSE", token: "x" }, sw, "stale")).toBe(false)
		expect(isSupersededByAdopt(null, sw, "stale")).toBe(false)
	})
})

describe("shouldRespondPong (B-17 readiness gate)", () => {
	test("withholds PONG until services are ready", () => {
		expect(shouldRespondPong(OFFSCREEN_PING, false)).toBe(false) // document loaded, PXE still initializing
		expect(shouldRespondPong(OFFSCREEN_PING, true)).toBe(true) // PXE up → adoptable
	})

	test("only PING triggers a PONG, even once ready", () => {
		expect(shouldRespondPong(OFFSCREEN_READY_MESSAGE, true)).toBe(false)
		expect(shouldRespondPong("SOMETHING_ELSE", true)).toBe(false)
		expect(shouldRespondPong(null, true)).toBe(false)
	})
})

describe("ensureOffscreenRunning (cold-start single-flight)", () => {
	let listeners: Array<(m: unknown) => void>
	let getContexts: Mock
	let createDocument: Mock
	let closeDocument: Mock
	let sendMessage: Mock

	const deliver = (message: unknown) => {
		for (const l of [...listeners]) l(message)
	}
	const settleMicrotasks = () => new Promise((r) => setTimeout(r, 0))

	beforeEach(() => {
		listeners = []
		// biome-ignore lint/suspicious/noExplicitAny: augmenting the shared chrome stub for the offscreen surface
		const c = (globalThis as any).chrome
		c.runtime.getURL = (p: string) => `chrome-extension://test/${p}`
		getContexts = vi.fn(async () => [])
		c.runtime.getContexts = getContexts
		c.runtime.onMessage = {
			addListener: (l: (m: unknown) => void) => {
				listeners.push(l)
			},
			removeListener: (l: (m: unknown) => void) => {
				const i = listeners.indexOf(l)
				if (i >= 0) listeners.splice(i, 1)
			},
		}
		sendMessage = vi.fn(async () => {})
		c.runtime.sendMessage = sendMessage
		createDocument = vi.fn(async () => {})
		closeDocument = vi.fn(async () => {})
		c.offscreen = { createDocument, closeDocument }
	})

	test("concurrent callers share ONE pass: one probe, one create, no cross-caller close", async () => {
		const p1 = ensureOffscreenRunning()
		const p2 = ensureOffscreenRunning()
		const p3 = ensureOffscreenRunning()
		await settleMicrotasks()
		deliver(OFFSCREEN_READY_MESSAGE)
		await Promise.all([p1, p2, p3])

		// The pre-fix race: caller B re-probed while caller A was creating, saw
		// the loading document, health-pinged into silence, and CLOSED it.
		// Single-flighted, the probe and create run exactly once and close never.
		expect(getContexts).toHaveBeenCalledTimes(1)
		expect(createDocument).toHaveBeenCalledTimes(1)
		expect(closeDocument).not.toHaveBeenCalled()
	})

	test('"closed before fully loading" create rejection retries once and recovers', async () => {
		createDocument.mockRejectedValueOnce(new Error("Offscreen document closed before fully loading.")).mockResolvedValueOnce(undefined)

		const p = ensureOffscreenRunning()
		await settleMicrotasks()
		deliver(OFFSCREEN_READY_MESSAGE)
		await p

		expect(createDocument).toHaveBeenCalledTimes(2)
		expect(closeDocument).toHaveBeenCalledTimes(1)
	})

	test("a later call runs a fresh pass: healthy existing document short-circuits without create", async () => {
		getContexts.mockResolvedValue([{}])
		sendMessage.mockImplementation(async (m: unknown) => {
			if (m === OFFSCREEN_PING) queueMicrotask(() => deliver(OFFSCREEN_PONG))
		})

		await ensureOffscreenRunning()

		expect(createDocument).not.toHaveBeenCalled()
		expect(closeDocument).not.toHaveBeenCalled()
	})

	test("createDocument hanging past the 10s gate: all joiners reject, NO post-timeout retry, next pass recovers", async () => {
		vi.useFakeTimers()
		try {
			// A hung create must not outlive the ready-gate: the pass rejects at
			// 10s, and the timeout-induced close must not trigger the loading-race
			// retry (which would spawn an untracked document — or, pre-fix, turn
			// into a false SUCCESS via `await null` after the gate was cleared).
			createDocument.mockImplementationOnce(() => new Promise(() => {}))
			const outcomes: string[] = []
			const track = (p: Promise<void>) =>
				p.then(
					() => outcomes.push("resolved"),
					(e) => outcomes.push(String(e)),
				)
			const p1 = track(ensureOffscreenRunning())
			const p2 = track(ensureOffscreenRunning())
			await vi.advanceTimersByTimeAsync(10_000)
			await Promise.all([p1, p2])

			expect(outcomes).toEqual(["Offscreen is not responding", "Offscreen is not responding"])
			expect(createDocument).toHaveBeenCalledTimes(1) // no timeout-induced retry
			expect(closeDocument).toHaveBeenCalledTimes(1) // the gate's own kill

			// The single-flight cleared: a fresh pass creates again and succeeds.
			createDocument.mockImplementation(async () => {})
			const p3 = ensureOffscreenRunning()
			await vi.advanceTimersByTimeAsync(0)
			deliver(OFFSCREEN_READY_MESSAGE)
			await p3
			expect(createDocument).toHaveBeenCalledTimes(2)
		} finally {
			vi.useRealTimers()
		}
	})

	test("a timed-out pass's ZOMBIE create rejection cannot retry into a successor pass (pass-scoped fence)", async () => {
		vi.useFakeTimers()
		try {
			// Pass A: create hangs; its eventual rejection is delivered only AFTER
			// pass B is underway. A mutable "timed out" boolean would be reset by
			// B, re-arming A's retry — whose closeOffscreen would tear down B's
			// document (the cross-caller kill through a time shift).
			let rejectCreateA!: (e: unknown) => void
			createDocument.mockImplementationOnce(
				() =>
					new Promise((_, rej) => {
						rejectCreateA = rej
					}),
			)
			const pA = ensureOffscreenRunning().catch((e) => String(e))
			await vi.advanceTimersByTimeAsync(10_000)
			expect(await pA).toBe("Offscreen is not responding")
			expect(closeDocument).toHaveBeenCalledTimes(1) // the gate's kill

			// Pass B under way: created, awaiting READY.
			createDocument.mockImplementationOnce(async () => {})
			const pB = ensureOffscreenRunning()
			await vi.advanceTimersByTimeAsync(0)
			expect(createDocument).toHaveBeenCalledTimes(2)

			// A's zombie continuation lands NOW, with the loading-race message.
			rejectCreateA(new Error("Offscreen document closed before fully loading."))
			await vi.advanceTimersByTimeAsync(0)

			// Fenced: no third create, and B's document was NOT closed.
			expect(createDocument).toHaveBeenCalledTimes(2)
			expect(closeDocument).toHaveBeenCalledTimes(1)

			deliver(OFFSCREEN_READY_MESSAGE)
			await pB
		} finally {
			vi.useRealTimers()
		}
	})

	test("(B-17) a successor pass JOINS a timed-out pass's close before probing/creating", async () => {
		vi.useFakeTimers()
		try {
			// Pass A create hangs → times out at 10s → onOffscreenTimeout fires a
			// close that we hold open. The single-flight gate clears when A's `ready`
			// rejects, so pass B can start while A's close is still in flight.
			createDocument.mockImplementationOnce(() => new Promise(() => {}))
			let resolveCloseA!: () => void
			closeDocument.mockImplementationOnce(
				() =>
					new Promise<void>((r) => {
						resolveCloseA = r
					}),
			)

			const pA = ensureOffscreenRunning().catch((e) => String(e))
			await vi.advanceTimersByTimeAsync(10_000)
			expect(await pA).toBe("Offscreen is not responding")
			expect(closeDocument).toHaveBeenCalledTimes(1)
			expect(getContexts).toHaveBeenCalledTimes(1) // A probed once

			// Pass B starts while A's close is STILL pending. It must join the close
			// before doing anything — no re-probe, no new document yet.
			createDocument.mockImplementation(async () => {})
			const pB = ensureOffscreenRunning()
			await vi.advanceTimersByTimeAsync(0)
			expect(getContexts).toHaveBeenCalledTimes(1) // B is blocked on the join — has NOT probed
			expect(createDocument).toHaveBeenCalledTimes(1) // still just A's hung create

			// Let A's close settle → B proceeds to probe + create.
			resolveCloseA()
			await vi.advanceTimersByTimeAsync(0)
			expect(getContexts).toHaveBeenCalledTimes(2) // B probed after the join
			expect(createDocument).toHaveBeenCalledTimes(2) // B created after the join

			deliver(OFFSCREEN_READY_MESSAGE)
			await pB
		} finally {
			vi.useRealTimers()
		}
	})

	test("(B-17) a hung create-retry close COMPOSES with the timeout close; a successor joins both", async () => {
		vi.useFakeTimers()
		try {
			// Pass A: the first create hits the loading race → the retry branch closes,
			// and THAT close hangs. The ready-gate then times out and fires a SECOND
			// close. Both run through one serialized tail, so a successor that joins
			// pendingClose waits for the whole tail — the hung retry close can't land
			// after B created and tear B's document down.
			createDocument
				.mockRejectedValueOnce(new Error("Offscreen document closed before fully loading."))
				.mockImplementation(async () => {})
			let resolveRetryClose!: () => void
			closeDocument
				.mockImplementationOnce(
					() =>
						new Promise<void>((r) => {
							resolveRetryClose = r
						}),
				)
				.mockImplementation(async () => {})

			const pA = ensureOffscreenRunning().catch((e) => String(e))
			await vi.advanceTimersByTimeAsync(10_000)
			expect(await pA).toBe("Offscreen is not responding")
			const createsAfterA = createDocument.mock.calls.length

			// Successor starts while the retry close is STILL hanging → must NOT create.
			const pB = ensureOffscreenRunning()
			await vi.advanceTimersByTimeAsync(0)
			expect(createDocument.mock.calls.length).toBe(createsAfterA) // blocked on the composed tail

			resolveRetryClose() // the hung retry close settles → tail drains → B proceeds
			await vi.advanceTimersByTimeAsync(0)
			deliver(OFFSCREEN_READY_MESSAGE)
			await pB
			expect(createDocument.mock.calls.length).toBeGreaterThan(createsAfterA) // B created only after joining both closes
		} finally {
			vi.useRealTimers()
		}
	})
})

describe("ensureOffscreenRunning — Firefox hidden-window path (B-17 pass fence)", () => {
	let listeners: Array<(m: unknown) => void>
	let windowsCreate: Mock
	let windowsRemove: Mock

	beforeEach(() => {
		listeners = []
		// biome-ignore lint/suspicious/noExplicitAny: augmenting the shared chrome stub for the Firefox surface
		const c = (globalThis as any).chrome
		c.runtime.getURL = (p: string) => `moz-extension://test/${p}`
		c.runtime.onMessage = {
			addListener: (l: (m: unknown) => void) => listeners.push(l),
			removeListener: (l: (m: unknown) => void) => {
				const i = listeners.indexOf(l)
				if (i >= 0) listeners.splice(i, 1)
			},
		}
		c.runtime.sendMessage = vi.fn(async () => {})
		// Firefox MV3 ships NO chrome.offscreen → hasOffscreenApi() is false and the
		// hidden-window branch runs. isOffscreenAlreadyRunning trusts the in-memory
		// firefoxOffscreenWindowId (null at cold start).
		c.offscreen = undefined
		windowsCreate = vi.fn()
		windowsRemove = vi.fn(async () => {})
		c.windows = { create: windowsCreate, remove: windowsRemove }
	})

	test("a superseded pass's late windows.create closes the orphan instead of clobbering the tracked window", async () => {
		vi.useFakeTimers()
		try {
			// Pass A's windows.create hangs past the 10s ready-gate → the pass times
			// out and passSeq advances. When A's create finally resolves, the pass is
			// stale: without the fence it would overwrite firefoxOffscreenWindowId
			// with A's orphan window and broadcast adoption, stranding the successor's
			// live window. With the fence it closes the orphan and bails.
			let resolveCreateA!: (w: { id: number }) => void
			windowsCreate.mockImplementationOnce(
				() =>
					new Promise((r) => {
						resolveCreateA = r
					}),
			)

			const pA = ensureOffscreenRunning().catch((e) => String(e))
			await vi.advanceTimersByTimeAsync(10_000)
			expect(await pA).toBe("Offscreen is not responding")

			// A's create resolves LATE (pass already superseded).
			resolveCreateA({ id: 100 })
			await vi.advanceTimersByTimeAsync(0)

			// Fenced: the orphan window is closed; no adoption broadcast for it.
			expect(windowsRemove).toHaveBeenCalledWith(100)
		} finally {
			vi.useRealTimers()
		}
	})
})
