import { beforeEach, describe, expect, test, vi, type Mock } from "vitest"
import {
	ensureOffscreenRunning,
	OFFSCREEN_PING,
	OFFSCREEN_PONG,
	OFFSCREEN_READY_MESSAGE,
	offscreenUrl,
	shouldRespondPong,
} from "./offscreen"

const sw = { id: "nulo-ext-id" } as chrome.runtime.MessageSender
const OFFSCREEN_URL = "chrome-extension://test/src/offscreen/index.html"
const offscreenDoc = { id: "nulo-ext-id", url: OFFSCREEN_URL } as chrome.runtime.MessageSender
const popupDoc = { id: "nulo-ext-id", url: "chrome-extension://test/src/popup/index.html" } as chrome.runtime.MessageSender
const foreign = { id: "other-ext" } as chrome.runtime.MessageSender

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: ensure chrome.runtime.id without clobbering the shared stub
	const c = ((globalThis as any).chrome ??= {})
	c.runtime = { ...c.runtime, id: "nulo-ext-id" }
})

describe("shouldRespondPong (B-17 readiness gate)", () => {
	test("withholds PONG until services are ready", () => {
		expect(shouldRespondPong(OFFSCREEN_PING, false, sw)).toBe(false) // document loaded, PXE still initializing
		expect(shouldRespondPong(OFFSCREEN_PING, true, sw)).toBe(true) // PXE up → adoptable
	})

	test("only PING triggers a PONG, even once ready", () => {
		expect(shouldRespondPong(OFFSCREEN_READY_MESSAGE, true, sw)).toBe(false)
		expect(shouldRespondPong("SOMETHING_ELSE", true, sw)).toBe(false)
		expect(shouldRespondPong(null, true, sw)).toBe(false)
	})

	test("a PING from a foreign extension gets no PONG", () => {
		// biome-ignore lint/suspicious/noExplicitAny: the predicate reads getURL for the same-extension check
		;(globalThis as any).chrome.runtime.getURL = (p: string) => `chrome-extension://test/${p}`
		expect(shouldRespondPong(OFFSCREEN_PING, true, foreign)).toBe(false)
		expect(shouldRespondPong(OFFSCREEN_PING, true, undefined)).toBe(false)
	})
})

describe("ensureOffscreenRunning (cold-start single-flight)", () => {
	let listeners: Array<(m: unknown, sender?: chrome.runtime.MessageSender) => void>
	let getContexts: Mock
	let createDocument: Mock
	let closeDocument: Mock
	let sendMessage: Mock

	const deliver = (message: unknown, sender: chrome.runtime.MessageSender = offscreenDoc) => {
		for (const l of [...listeners]) l(message, sender)
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

	test("READY from a foreign sender or a same-extension POPUP url does not resolve the pass; the offscreen document does", async () => {
		const p = ensureOffscreenRunning()
		await settleMicrotasks()
		let resolved = false
		p.then(() => (resolved = true))
		deliver(OFFSCREEN_READY_MESSAGE, foreign)
		deliver(OFFSCREEN_READY_MESSAGE, popupDoc)
		deliver(OFFSCREEN_READY_MESSAGE, sw)
		await settleMicrotasks()
		expect(resolved).toBe(false)
		// The exact document path is the discriminator: neither a query string nor a tab changes it.
		deliver(OFFSCREEN_READY_MESSAGE, { id: "nulo-ext-id", url: `${OFFSCREEN_URL}?instance=t`, tab: { id: 2 } } as never)
		await p
		expect(resolved).toBe(true)
	})

	test("PONG from a foreign sender or a popup url does not mark the document healthy (zombie path recreates)", async () => {
		getContexts.mockResolvedValue([{}])
		sendMessage.mockImplementation(async (m: unknown) => {
			if (m === OFFSCREEN_PING) {
				queueMicrotask(() => deliver(OFFSCREEN_PONG, foreign))
				queueMicrotask(() => deliver(OFFSCREEN_PONG, popupDoc))
			}
		})
		vi.useFakeTimers()
		try {
			const p = ensureOffscreenRunning()
			await vi.advanceTimersByTimeAsync(3_100)
			// Health check timed out → zombie close → create; READY from the document completes it.
			expect(closeDocument).toHaveBeenCalledTimes(1)
			expect(createDocument).toHaveBeenCalledTimes(1)
			deliver(OFFSCREEN_READY_MESSAGE)
			await p
		} finally {
			vi.useRealTimers()
		}
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

describe("ensureOffscreenRunning — Firefox background-page frame", () => {
	let listeners: Array<(m: unknown, sender?: chrome.runtime.MessageSender) => void>
	let sendMessage: Mock
	// `offscreenUrl()` memoizes the first getURL it saw (the Chrome suite's scheme); the path
	// equality and the generation are what these cases test, not the scheme.
	const frameUrl = () => offscreenUrl()

	const frames = () => [...document.querySelectorAll("iframe")]
	const liveGeneration = () => {
		const src = frames().at(-1)?.src
		if (!src) throw new Error("no frame attached")
		return new URL(src).searchParams.get("instance") ?? ""
	}
	// The sender shape Firefox delivers for a message from the frame: no `tab`, no `frameId`.
	const frameSender = (generation: string) =>
		({
			contextId: "c",
			documentId: "d",
			envType: "addon_child",
			id: "nulo-ext-id",
			origin: "moz-extension://test",
			url: `${frameUrl()}?instance=${generation}`,
		}) as never
	const deliver = (message: unknown, sender: chrome.runtime.MessageSender) => {
		for (const l of [...listeners]) l(message, sender)
	}
	const settleMicrotasks = () => new Promise((r) => setTimeout(r, 0))
	const readyAndAwait = async (p: Promise<void>) => {
		deliver(OFFSCREEN_READY_MESSAGE, frameSender(liveGeneration()))
		await p
	}

	beforeEach(() => {
		listeners = []
		// A previous test's frame is detached with the body, which is exactly what the tracker
		// must notice: every test starts from "no live frame" without reaching into module state.
		document.body.innerHTML = ""
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
		sendMessage = vi.fn(async () => {})
		c.runtime.sendMessage = sendMessage
		// Firefox MV3 ships NO chrome.offscreen → hasOffscreenApi() is false and the frame branch runs.
		c.offscreen = undefined
		c.windows = { create: vi.fn(), remove: vi.fn() }
	})

	test("creates exactly one frame of the offscreen page and no window; READY from that frame opens the gate", async () => {
		const p = ensureOffscreenRunning()
		await settleMicrotasks()
		expect(frames()).toHaveLength(1)
		expect(frames()[0]?.src).toBe(`${frameUrl()}?instance=${liveGeneration()}`)
		expect(chrome.windows.create).not.toHaveBeenCalled()
		await readyAndAwait(p)
		expect(frames()).toHaveLength(1)
	})

	test("a frame whose page never sends READY (404, init failure) is removed at the gate; the next pass creates a fresh one", async () => {
		vi.useFakeTimers()
		try {
			const pA = ensureOffscreenRunning().catch((e) => String(e))
			await vi.advanceTimersByTimeAsync(0)
			const first = liveGeneration()
			await vi.advanceTimersByTimeAsync(10_000)
			expect(await pA).toBe("Offscreen is not responding")
			expect(frames()).toHaveLength(0)

			const pB = ensureOffscreenRunning()
			await vi.advanceTimersByTimeAsync(0)
			expect(frames()).toHaveLength(1)
			expect(liveGeneration()).not.toBe(first)
			await readyAndAwait(pB)
		} finally {
			vi.useRealTimers()
		}
	})

	test("a frame detached behind the tracker's back is not running: no health ping, a new frame is created", async () => {
		const p1 = ensureOffscreenRunning()
		await settleMicrotasks()
		await readyAndAwait(p1)
		frames()[0]?.remove()

		const p2 = ensureOffscreenRunning()
		await settleMicrotasks()
		expect(sendMessage).not.toHaveBeenCalledWith(OFFSCREEN_PING)
		expect(frames()).toHaveLength(1)
		await readyAndAwait(p2)
	})

	test("a connected frame that fails its health PING is removed and recreated", async () => {
		vi.useFakeTimers()
		try {
			const p1 = ensureOffscreenRunning()
			await vi.advanceTimersByTimeAsync(0)
			const first = liveGeneration()
			await readyAndAwait(p1)

			const p2 = ensureOffscreenRunning()
			await vi.advanceTimersByTimeAsync(3_100)
			expect(sendMessage).toHaveBeenCalledWith(OFFSCREEN_PING)
			expect(frames()).toHaveLength(1)
			expect(liveGeneration()).not.toBe(first)
			await readyAndAwait(p2)
		} finally {
			vi.useRealTimers()
		}
	})

	test("a healthy frame is reused: PONG carrying the live generation short-circuits without a new frame", async () => {
		const p1 = ensureOffscreenRunning()
		await settleMicrotasks()
		const generation = liveGeneration()
		await readyAndAwait(p1)
		sendMessage.mockImplementation(async (m: unknown) => {
			if (m === OFFSCREEN_PING) queueMicrotask(() => deliver(OFFSCREEN_PONG, frameSender(generation)))
		})

		await ensureOffscreenRunning()
		expect(frames()).toHaveLength(1)
		expect(liveGeneration()).toBe(generation)
	})

	test("READY carrying a PREVIOUS generation does not open the live gate", async () => {
		vi.useFakeTimers()
		try {
			const pA = ensureOffscreenRunning().catch((e) => String(e))
			await vi.advanceTimersByTimeAsync(0)
			const stale = liveGeneration()
			await vi.advanceTimersByTimeAsync(10_000)
			expect(await pA).toBe("Offscreen is not responding")

			const pB = ensureOffscreenRunning()
			await vi.advanceTimersByTimeAsync(0)
			let resolved = false
			pB.then(() => (resolved = true))
			// The removed frame's READY lands late: by URL alone a legitimate offscreen sender.
			deliver(OFFSCREEN_READY_MESSAGE, frameSender(stale))
			await vi.advanceTimersByTimeAsync(0)
			expect(resolved).toBe(false)
			await readyAndAwait(pB)
			expect(resolved).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})

	test("PONG carrying a PREVIOUS generation does not pass the health check: the frame is replaced", async () => {
		vi.useFakeTimers()
		try {
			const p1 = ensureOffscreenRunning()
			await vi.advanceTimersByTimeAsync(0)
			const generation = liveGeneration()
			await readyAndAwait(p1)
			sendMessage.mockImplementation(async (m: unknown) => {
				if (m === OFFSCREEN_PING) queueMicrotask(() => deliver(OFFSCREEN_PONG, frameSender("a-generation-that-was-removed")))
			})

			const p2 = ensureOffscreenRunning()
			await vi.advanceTimersByTimeAsync(3_100)
			expect(liveGeneration()).not.toBe(generation)
			await readyAndAwait(p2)
		} finally {
			vi.useRealTimers()
		}
	})

	test("a READY with no URL, a generation-less copy of the page or a foreign sender is refused without throwing", async () => {
		const p = ensureOffscreenRunning()
		await settleMicrotasks()
		let resolved = false
		p.then(() => (resolved = true))
		deliver(OFFSCREEN_READY_MESSAGE, { id: "nulo-ext-id" } as chrome.runtime.MessageSender)
		deliver(OFFSCREEN_READY_MESSAGE, { id: "nulo-ext-id", url: "not a url" } as chrome.runtime.MessageSender)
		// The page opened in a tab by hand carries no generation: refused on Firefox even at the exact path.
		deliver(OFFSCREEN_READY_MESSAGE, { id: "nulo-ext-id", url: frameUrl(), tab: { id: 3 } } as never)
		deliver(OFFSCREEN_READY_MESSAGE, {
			id: "other-ext",
			url: `${frameUrl()}?instance=${liveGeneration()}`,
		} as chrome.runtime.MessageSender)
		await settleMicrotasks()
		expect(resolved).toBe(false)
		await readyAndAwait(p)
		expect(resolved).toBe(true)
	})

	test("a PING from the Firefox background page (no tab, page URL) gets a PONG; one relayed through a web page does not", () => {
		const backgroundPage = {
			id: "nulo-ext-id",
			url: "moz-extension://test/_generated_background_page.html",
		} as chrome.runtime.MessageSender
		expect(shouldRespondPong(OFFSCREEN_PING, true, backgroundPage)).toBe(true)
		expect(shouldRespondPong(OFFSCREEN_PING, true, { id: "nulo-ext-id", url: "https://dapp.example/", tab: { id: 1 } } as never)).toBe(
			false,
		)
	})
})
