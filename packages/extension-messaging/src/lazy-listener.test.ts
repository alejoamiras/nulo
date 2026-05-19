import { describe, expect, test, vi } from "vitest"

import { type LazyListenerLogger, makeLazyListener } from "./lazy-listener"

/** Wait for all pending microtasks/timers to flush. */
async function flush(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
}

function makeFakeLogger(): LazyListenerLogger & { warnings: unknown[][] } {
	const warnings: unknown[][] = []
	return {
		warnings,
		warn: (...args: unknown[]) => {
			warnings.push(args)
		},
	}
}

describe("LazyListener", () => {
	test("buffers events before ready then flushes them in arrival order", async () => {
		const received: string[] = []
		let underlyingHandler: ((msg: string) => void) | undefined
		let readyResolve: () => void = () => undefined
		const ready = new Promise<void>((r) => {
			readyResolve = r
		})

		makeLazyListener<string, undefined>(
			(msg) => {
				received.push(msg)
			},
			{
				attach: (h) => {
					underlyingHandler = (msg) => h(msg, undefined)
					return () => {
						underlyingHandler = undefined
					}
				},
				ready,
			},
		)

		// Pre-ready messages — should be buffered.
		underlyingHandler?.("a")
		underlyingHandler?.("b")
		underlyingHandler?.("c")
		expect(received).toEqual([])

		readyResolve()
		await flush()

		expect(received).toEqual(["a", "b", "c"])
	})

	test("events arriving after ready are dispatched immediately", async () => {
		const received: string[] = []
		let underlyingHandler: ((msg: string) => void) | undefined

		makeLazyListener<string, undefined>(
			(msg) => {
				received.push(msg)
			},
			{
				attach: (h) => {
					underlyingHandler = (msg) => h(msg, undefined)
					return () => {
						underlyingHandler = undefined
					}
				},
				ready: Promise.resolve(),
			},
		)

		await flush()
		underlyingHandler?.("late")
		expect(received).toEqual(["late"])
	})

	test("overflow drops oldest and warns; warn count tracks total drops", () => {
		const logger = makeFakeLogger()
		const received: string[] = []
		let underlyingHandler: ((msg: string) => void) | undefined
		let readyResolve: () => void = () => undefined
		const ready = new Promise<void>((r) => {
			readyResolve = r
		})

		makeLazyListener<string, undefined>(
			(msg) => {
				received.push(msg)
			},
			{
				attach: (h) => {
					underlyingHandler = (msg) => h(msg, undefined)
					return () => {
						underlyingHandler = undefined
					}
				},
				ready,
				maxBuffered: 3,
				logger,
			},
		)

		underlyingHandler?.("a")
		underlyingHandler?.("b")
		underlyingHandler?.("c")
		expect(logger.warnings).toHaveLength(0)

		underlyingHandler?.("d") // overflow — drops "a"
		underlyingHandler?.("e") // overflow — drops "b"

		expect(logger.warnings).toHaveLength(2)
		expect(String(logger.warnings[0][0])).toMatch(/dropped oldest/)
		expect(String(logger.warnings[1][0])).toMatch(/total dropped: 2/)

		// Once ready resolves, the surviving 3 most-recent events flush in order.
		readyResolve()
		return flush().then(() => {
			expect(received).toEqual(["c", "d", "e"])
			void readyResolve
		})
	})

	test("after detach, no further events reach the real handler — even after ready", async () => {
		const received: string[] = []
		let underlyingHandler: ((msg: string) => void) | undefined
		let underlyingDetached = false
		let readyResolve: () => void = () => undefined
		const ready = new Promise<void>((r) => {
			readyResolve = r
		})

		const lazy = makeLazyListener<string, undefined>(
			(msg) => {
				received.push(msg)
			},
			{
				attach: (h) => {
					underlyingHandler = (msg) => h(msg, undefined)
					return () => {
						underlyingDetached = true
					}
				},
				ready,
			},
		)

		underlyingHandler?.("before-detach")

		lazy.detach()
		expect(underlyingDetached).toBe(true)

		// Second detach is idempotent.
		lazy.detach()

		// Buffered events do NOT flush after detach.
		readyResolve()
		await flush()
		expect(received).toEqual([])

		// New incoming messages after detach are ignored.
		underlyingHandler?.("after-detach")
		expect(received).toEqual([])
	})

	test("errors thrown by realHandler don't break the listener; subsequent events still dispatch", async () => {
		const logger = makeFakeLogger()
		const received: string[] = []
		let underlyingHandler: ((msg: string) => void) | undefined

		makeLazyListener<string, undefined>(
			(msg) => {
				if (msg === "boom") throw new Error("handler explosion")
				received.push(msg)
			},
			{
				attach: (h) => {
					underlyingHandler = (msg) => h(msg, undefined)
					return () => {
						underlyingHandler = undefined
					}
				},
				ready: Promise.resolve(),
				logger,
			},
		)

		await flush()

		underlyingHandler?.("ok1")
		underlyingHandler?.("boom")
		underlyingHandler?.("ok2")

		expect(received).toEqual(["ok1", "ok2"])
		expect(logger.warnings).toHaveLength(1)
		expect(String(logger.warnings[0][0])).toMatch(/realHandler threw/)
		// Silence unused-import lint for vi (kept for future spy support).
		void vi
	})
})
