/**
 * Pins for the cold-wake content-message relay: pre-attach admission (only a
 * validated top-frame discovery-request occupies a slot), FIFO exactly-once
 * flush on attach, TTL drop, F-04-mirrored caps (reject-new), idempotent
 * re-attach, and the non-content passthrough. Module state is realm-scoped, so
 * every case re-imports a fresh module via vi.resetModules().
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

type Listener = (message: unknown, sender: unknown) => undefined
let chromeListeners: Listener[]

beforeEach(() => {
	vi.resetModules()
	vi.useRealTimers()
	chromeListeners = []
	vi.stubGlobal("chrome", {
		// biome-ignore lint/suspicious/noExplicitAny: minimal chrome stub
		...(globalThis as any).chrome,
		runtime: { onMessage: { addListener: (fn: Listener) => chromeListeners.push(fn) } },
	})
})

async function freshRelay() {
	const mod = await import("./content-message-relay")
	mod.registerContentMessageRelay()
	expect(chromeListeners).toHaveLength(1)
	return { ...mod, dispatch: chromeListeners[0] }
}

const topFrameSender = (origin = "https://dapp.example") => ({ frameId: 0, origin, tab: { id: 7, url: origin } })
const discovery = (requestId = "r1") => ({
	origin: "content-script",
	type: "discovery-request",
	requestId,
	appId: "app",
	chainInfo: { chainId: "1" },
})

describe("content-message-relay", () => {
	test("post-attach: content messages forward synchronously; exactly once", async () => {
		const { attachContentListener, dispatch } = await freshRelay()
		const seen: unknown[] = []
		attachContentListener((m) => {
			seen.push(m)
		})

		dispatch(discovery(), topFrameSender())

		expect(seen).toHaveLength(1)
	})

	test("pre-attach: a validated top-frame discovery buffers and flushes FIFO on attach, exactly once", async () => {
		const { attachContentListener, dispatch } = await freshRelay()
		dispatch(discovery("a"), topFrameSender())
		dispatch(discovery("b"), topFrameSender("https://other.example"))

		const seen: Array<{ requestId?: string }> = []
		attachContentListener((m) => {
			seen.push(m as { requestId?: string })
		})

		expect(seen.map((m) => m.requestId)).toEqual(["a", "b"])
		// A second attach must not replay (snapshot-and-clear semantics).
		const seen2: unknown[] = []
		attachContentListener((m) => {
			seen2.push(m)
		})
		expect(seen2).toHaveLength(0)
	})

	test("non-content messages are never buffered and never consumed", async () => {
		const { attachContentListener, dispatch } = await freshRelay()
		dispatch({ type: "nulo:open-toolbar-popup" }, topFrameSender())
		dispatch({ origin: "background", type: "x" }, topFrameSender())

		const seen: unknown[] = []
		attachContentListener((m) => {
			seen.push(m)
		})
		expect(seen).toHaveLength(0)
	})

	test("pre-attach admission: subframe, malformed, and non-discovery content messages take no slot", async () => {
		const { attachContentListener, dispatch } = await freshRelay()
		dispatch(discovery("iframe"), { frameId: 3, origin: "https://evil.example", tab: { id: 7 } })
		// Malformed per the envelope schema: sessionId must be a string when present.
		dispatch({ origin: "content-script", type: "discovery-request", sessionId: 42 }, topFrameSender())
		dispatch({ origin: "content-script", type: "secure-message", sessionId: "s", payload: "x" }, topFrameSender())
		dispatch({ origin: "content-script", type: "ping", sessionId: "s" }, topFrameSender())

		const seen: unknown[] = []
		attachContentListener((m) => {
			seen.push(m)
		})
		expect(seen).toHaveLength(0)
	})

	test("caps mirror F-04: 4 per origin, 32 global, reject-new", async () => {
		const { attachContentListener, dispatch, CONTENT_RELAY_GLOBAL_CAP, CONTENT_RELAY_PER_ORIGIN_CAP } = await freshRelay()
		// Per-origin: 6 from one origin → only 4 admitted.
		for (let i = 0; i < 6; i++) dispatch(discovery(`same-${i}`), topFrameSender("https://one.example"))
		// Fill toward the global cap from distinct origins.
		for (let i = 0; i < 40; i++) dispatch(discovery(`spread-${i}`), topFrameSender(`https://o${i}.example`))

		const seen: Array<{ requestId?: string }> = []
		attachContentListener((m) => {
			seen.push(m as { requestId?: string })
		})

		expect(seen.filter((m) => m.requestId?.startsWith("same-"))).toHaveLength(CONTENT_RELAY_PER_ORIGIN_CAP)
		expect(seen).toHaveLength(CONTENT_RELAY_GLOBAL_CAP)
	})

	test("TTL: entries older than the freshness window are dropped at flush (the B-16 clock is never laundered)", async () => {
		vi.useFakeTimers()
		const { attachContentListener, dispatch, CONTENT_RELAY_MAX_AGE_MS } = await freshRelay()
		dispatch(discovery("stale"), topFrameSender())
		vi.advanceTimersByTime(CONTENT_RELAY_MAX_AGE_MS + 1_000)
		dispatch(discovery("fresh"), topFrameSender("https://other.example"))

		const seen: Array<{ requestId?: string }> = []
		attachContentListener((m) => {
			seen.push(m as { requestId?: string })
		})

		expect(seen.map((m) => m.requestId)).toEqual(["fresh"])
	})

	test("idempotent re-attach: the newest listener wins for live traffic", async () => {
		const { attachContentListener, dispatch } = await freshRelay()
		const first: unknown[] = []
		const second: unknown[] = []
		attachContentListener((m) => {
			first.push(m)
		})
		attachContentListener((m) => {
			second.push(m)
		})

		dispatch(discovery(), topFrameSender())

		expect(first).toHaveLength(0)
		expect(second).toHaveLength(1)
	})
})
