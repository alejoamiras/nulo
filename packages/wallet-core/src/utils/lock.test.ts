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

	test("withLock: returns fn's value and releases (next caller enters immediately)", async () => {
		const lock = new Lock()
		const result = await lock.withLock(async () => 41 + 1)
		expect(result).toBe(42)
		let acquired = false
		await lock.withLock(() => {
			acquired = true
		})
		expect(acquired).toBe(true)
	})

	test("withLock: releases on throw and rethrows", async () => {
		const lock = new Lock()
		await expect(
			lock.withLock(async () => {
				throw new Error("boom")
			}),
		).rejects.toThrow("boom")
		// Released: an uncontended follow-up acquires without waiting.
		let acquired = false
		await lock.withLock(() => {
			acquired = true
		})
		expect(acquired).toBe(true)
	})

	test("withLock: supports a synchronous fn", async () => {
		const lock = new Lock()
		expect(await lock.withLock(() => "sync")).toBe("sync")
	})

	test("withLock: two concurrent sections serialize (no overlap)", async () => {
		const lock = new Lock()
		const events: string[] = []
		const gate = _deferred()
		const first = lock.withLock(async () => {
			events.push("first-in")
			await gate.promise
			events.push("first-out")
		})
		const second = lock.withLock(async () => {
			events.push("second-in")
		})
		await flush()
		expect(events).toEqual(["first-in"]) // second must not have entered
		gate.resolve()
		await Promise.all([first, second])
		expect(events).toEqual(["first-in", "first-out", "second-in"])
	})

	test("withLock: leave() is NOT called when enter() rejects (invariant pin)", async () => {
		// enter() never rejects in the real class today; this pins the wrapper's
		// contract so a future enter() failure mode can't leak a spurious leave()
		// — the exact guarantee token/service.ts's holdsLock boolean hand-built.
		class RejectingLock extends Lock {
			public leaveCalls = 0
			public override async enter(): Promise<void> {
				throw new Error("enter failed")
			}
			public override leave(): void {
				this.leaveCalls += 1
				super.leave()
			}
		}
		const lock = new RejectingLock()
		await expect(lock.withLock(async () => "unreachable")).rejects.toThrow("enter failed")
		expect(lock.leaveCalls).toBe(0)
	})

	test("withLock: synchronous throw inside fn rejects with it and releases", async () => {
		const lock = new Lock()
		await expect(
			lock.withLock(() => {
				throw new Error("sync boom")
			}),
		).rejects.toThrow("sync boom")
		let acquired = false
		await lock.withLock(() => {
			acquired = true
		})
		expect(acquired).toBe(true)
	})

	test("withLock: force-release interplay is identical to a hand-rolled frame", async () => {
		// fn outlives MAX_HOLD_MS → the safety timer force-releases → a second
		// holder enters → fn finally completes and withLock's finally performs
		// the same late leave() a hand-rolled finally would (releasing the
		// second holder — the pre-existing double-release hazard, pinned as
		// today's behavior, deliberately NOT fixed in this arc).
		vi.useFakeTimers()
		const lock = new Lock()
		const gate = _deferred()
		const events: string[] = []
		const long = lock.withLock(async () => {
			events.push("long-in")
			await gate.promise
			events.push("long-out")
		})
		await vi.advanceTimersByTimeAsync(0)
		expect(events).toEqual(["long-in"])
		vi.advanceTimersByTime(5 * 60_000 + 1) // force-release fires
		let secondAcquired = false
		const second = (async () => {
			await lock.enter()
			secondAcquired = true
		})()
		await vi.advanceTimersByTimeAsync(0)
		expect(secondAcquired).toBe(true) // second holder entered post-force-release
		gate.resolve()
		await long // late leave() runs — same as a hand-rolled finally would
		await second
		// The late leave released the second holder's lock: a third caller enters.
		let thirdAcquired = false
		const third = (async () => {
			await lock.enter()
			thirdAcquired = true
			lock.leave()
		})()
		await vi.advanceTimersByTimeAsync(0)
		expect(thirdAcquired).toBe(true)
		await third
	})

	test("mixed-mode FIFO: raw enter() waiters and withLock waiters keep enqueue order", async () => {
		const lock = new Lock()
		const order: string[] = []
		await lock.enter()
		const a = lock.withLock(() => {
			order.push("a-withLock")
		})
		const b = (async () => {
			await lock.enter()
			order.push("b-raw")
			lock.leave()
		})()
		const c = lock.withLock(() => {
			order.push("c-withLock")
		})
		await flush()
		lock.leave()
		await Promise.all([a, b, c])
		expect(order).toEqual(["a-withLock", "b-raw", "c-withLock"])
	})

	test("non-reentrancy pin: nested withLock on one lock deadlocks until force-release", async () => {
		// Documents the invariant the services' wrappers warn about: the mutex
		// is not reentrant; a nested acquisition waits behind the outer holder.
		vi.useFakeTimers()
		const lock = new Lock()
		let innerRan = false
		const outer = lock.withLock(async () => {
			const inner = lock.withLock(() => {
				innerRan = true
			})
			await vi.advanceTimersByTimeAsync(0)
			expect(innerRan).toBe(false) // deadlocked behind ourselves
			vi.advanceTimersByTime(5 * 60_000 + 1) // force-release breaks it
			await inner
			expect(innerRan).toBe(true)
		})
		await outer
	})

	test("(HARDENING) throwing logger never rejects enter(), never blocks the mutex, still arms the timer", async () => {
		vi.useFakeTimers()
		const throwingLogger: ILogger = {
			log: () => {
				throw new Error("logger exploded")
			},
		}
		const lock = new Lock("hardened", throwingLogger)
		// Post-acquisition throw point (acquired-log + timer arm): enter resolves.
		await expect(lock.enter()).resolves.toBeUndefined()
		// Pre-enqueue throw point (waiting-log): contended enter still enqueues and
		// acquires after release — a throw here used to reject BEFORE enqueue,
		// which under enter-inside-try frames released another holder's lock.
		let waiterAcquired = false
		const waiter = (async () => {
			await lock.enter()
			waiterAcquired = true
		})()
		await vi.advanceTimersByTimeAsync(0)
		expect(waiterAcquired).toBe(false)
		lock.leave()
		await vi.advanceTimersByTimeAsync(0)
		expect(waiterAcquired).toBe(true)
		// The waiter's own force-release timer was armed despite the throwing
		// logger: advancing time force-releases (a third caller can enter).
		vi.advanceTimersByTime(5 * 60_000 + 1)
		let thirdAcquired = false
		const third = (async () => {
			await lock.enter()
			thirdAcquired = true
			lock.leave()
		})()
		await vi.advanceTimersByTimeAsync(0)
		expect(thirdAcquired).toBe(true)
		await Promise.all([waiter, third])
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
