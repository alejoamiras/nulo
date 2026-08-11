import { beforeEach, describe, expect, test, vi, type Mock } from "vitest"
import {
	ensureOffscreenRunning,
	isSupersededByAdopt,
	OFFSCREEN_ADOPT_INSTANCE,
	OFFSCREEN_PING,
	OFFSCREEN_PONG,
	OFFSCREEN_READY_MESSAGE,
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
})
