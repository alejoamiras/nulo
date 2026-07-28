import { afterEach, describe, expect, test, vi } from "vitest"
import { LogLevel } from "../logger/interfaces"
import type { ILogger } from "../logger/interfaces"
import { Lock } from "./lock"

function _deferred<T = void>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe("Lock", () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	test("FIFO ordering: queued waiters run in enqueue order", async () => {
		const lock = new Lock()
		const order: string[] = []

		await lock.enter()
		const a = (async () => {
			await lock.enter()
			order.push("a")
			lock.leave()
		})()
		const b = (async () => {
			await lock.enter()
			order.push("b")
			lock.leave()
		})()
		const c = (async () => {
			await lock.enter()
			order.push("c")
			lock.leave()
		})()
		await flush()
		lock.leave()
		await Promise.all([a, b, c])
		expect(order).toEqual(["a", "b", "c"])
	})

	test("contended acquire: second enter waits until first leave", async () => {
		const lock = new Lock()
		await lock.enter()
		let secondAcquired = false
		const second = (async () => {
			await lock.enter()
			secondAcquired = true
			lock.leave()
		})()
		await flush()
		expect(secondAcquired).toBe(false)
		lock.leave()
		await second
		expect(secondAcquired).toBe(true)
	})

	test("force-release after MAX_HOLD_MS: holder never called leave", async () => {
		vi.useFakeTimers()
		const lock = new Lock()
		await lock.enter()
		// Holder forgets to leave. Advance time past 5 minutes.
		vi.advanceTimersByTime(5 * 60_000 + 1)
		// The force-release synchronously calls leave(); next caller can enter.
		let secondAcquired = false
		const _second = (async () => {
			await lock.enter()
			secondAcquired = true
			lock.leave()
		})()
		await vi.advanceTimersByTimeAsync(0)
		expect(secondAcquired).toBe(true)
	})

	test("double leave: idempotent, no throw", async () => {
		const lock = new Lock()
		await lock.enter()
		lock.leave()
		expect(() => lock.leave()).not.toThrow()
	})

	test("finally release after async throw: next caller can enter", async () => {
		const lock = new Lock()
		await expect(async () => {
			await lock.enter()
			try {
				throw new Error("boom")
			} finally {
				lock.leave()
			}
		}).rejects.toThrow("boom")
		// Lock should be released; next caller succeeds.
		let acquired = false
		await lock.enter()
		acquired = true
		lock.leave()
		expect(acquired).toBe(true)
	})

	test("named lock with logger: emits debug log on contended acquire", async () => {
		const logger: ILogger = {
			log: vi.fn(),
		}
		const lock = new Lock("test-lock", logger)
		await lock.enter()
		const waiter = (async () => {
			await lock.enter()
			lock.leave()
		})()
		await flush()
		// Waiting log fires synchronously when enqueueing behind the holder.
		const calls = (logger.log as ReturnType<typeof vi.fn>).mock.calls
		const waitingCall = calls.find(
			(c) => c[0] === "test-lock" && c[1] === LogLevel.Debug && typeof c[2] === "string" && c[2].includes("waiting"),
		)
		expect(waitingCall).toBeDefined()
		lock.leave()
		await waiter
	})

	test("named lock with logger: emits force-release error log", async () => {
		vi.useFakeTimers()
		const logger: ILogger = {
			log: vi.fn(),
		}
		const lock = new Lock("test-lock", logger)
		await lock.enter()
		vi.advanceTimersByTime(5 * 60_000 + 1)
		const calls = (logger.log as ReturnType<typeof vi.fn>).mock.calls
		const forceReleaseCall = calls.find(
			(c) => c[0] === "test-lock" && c[1] === LogLevel.Error && typeof c[2] === "string" && c[2].includes("force-released"),
		)
		expect(forceReleaseCall).toBeDefined()
	})

	test("leave() before any enter(): safe no-op", () => {
		const lock = new Lock()
		expect(() => lock.leave()).not.toThrow()
	})

	test("two-deep contention: second waiter sees the first run before it", async () => {
		const lock = new Lock()
		const order: string[] = []
		await lock.enter()
		const first = (async () => {
			await lock.enter()
			order.push("first")
			lock.leave()
		})()
		const second = (async () => {
			await lock.enter()
			order.push("second")
			lock.leave()
		})()
		await flush()
		lock.leave()
		await Promise.all([first, second])
		expect(order).toEqual(["first", "second"])
	})
})
