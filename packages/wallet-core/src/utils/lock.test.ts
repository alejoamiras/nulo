import { afterEach, describe, expect, test, vi } from "vitest"
import { LogLevel } from "../logger/interfaces"
import type { ILogger } from "../logger/interfaces"
import { Lock, type LockTicket } from "./lock"

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

		const t0 = await lock.enter()
		const a = (async () => {
			const t = await lock.enter()
			order.push("a")
			lock.leave(t)
		})()
		const b = (async () => {
			const t = await lock.enter()
			order.push("b")
			lock.leave(t)
		})()
		const c = (async () => {
			const t = await lock.enter()
			order.push("c")
			lock.leave(t)
		})()
		await flush()
		lock.leave(t0)
		await Promise.all([a, b, c])
		expect(order).toEqual(["a", "b", "c"])
	})

	test("contended acquire: second enter waits until first leave", async () => {
		const lock = new Lock()
		const t0 = await lock.enter()
		let secondAcquired = false
		const second = (async () => {
			const t = await lock.enter()
			secondAcquired = true
			lock.leave(t)
		})()
		await flush()
		expect(secondAcquired).toBe(false)
		lock.leave(t0)
		await second
		expect(secondAcquired).toBe(true)
	})

	test("force-release after MAX_HOLD_MS: holder never called leave", async () => {
		vi.useFakeTimers()
		const lock = new Lock()
		await lock.enter()
		// Holder forgets to leave. Advance time past 5 minutes.
		vi.advanceTimersByTime(5 * 60_000 + 1)
		// The force-release synchronously frees the lock; next caller can enter.
		let secondAcquired = false
		const _second = (async () => {
			const t = await lock.enter()
			secondAcquired = true
			lock.leave(t)
		})()
		await vi.advanceTimersByTimeAsync(0)
		expect(secondAcquired).toBe(true)
	})

	test("maxHoldMs: null disables the watchdog — a held lock never force-releases", async () => {
		vi.useFakeTimers()
		const lock = new Lock(undefined, undefined, null)
		const t0 = await lock.enter()
		// Holder forgets to leave. Advance well past the default 5-minute watchdog.
		let secondAcquired = false
		void lock.enter().then(() => {
			secondAcquired = true
		})
		await vi.advanceTimersByTimeAsync(10 * 60_000)
		// No watchdog armed → the waiter is still blocked (matches a hand-rolled
		// watchdog-less chain).
		expect(secondAcquired).toBe(false)
		lock.leave(t0) // now it can proceed
		await vi.advanceTimersByTimeAsync(0)
		expect(secondAcquired).toBe(true)
	})

	test("double leave with the same ticket: second call is a no-op, no throw", async () => {
		const lock = new Lock()
		const t = await lock.enter()
		lock.leave(t)
		expect(() => lock.leave(t)).not.toThrow()
	})

	test("leave() with a foreign ticket: safe no-op (never held, never released)", async () => {
		const lock = new Lock()
		expect(() => lock.leave(Symbol("foreign") as LockTicket)).not.toThrow()
		// The lock is untouched: an acquire still works normally.
		const t = await lock.enter()
		lock.leave(t)
	})

	test("finally release after async throw: next caller can enter", async () => {
		const lock = new Lock()
		await expect(async () => {
			const t = await lock.enter()
			try {
				throw new Error("boom")
			} finally {
				lock.leave(t)
			}
		}).rejects.toThrow("boom")
		// Lock should be released; next caller succeeds.
		let acquired = false
		const t = await lock.enter()
		acquired = true
		lock.leave(t)
		expect(acquired).toBe(true)
	})

	test("named lock with logger: emits debug log on contended acquire", async () => {
		const logger: ILogger = {
			log: vi.fn(),
		}
		const lock = new Lock("test-lock", logger)
		const t0 = await lock.enter()
		const waiter = (async () => {
			const t = await lock.enter()
			lock.leave(t)
		})()
		await flush()
		// Waiting log fires synchronously when enqueueing behind the holder.
		const calls = (logger.log as ReturnType<typeof vi.fn>).mock.calls
		const waitingCall = calls.find(
			(c) => c[0] === "test-lock" && c[1] === LogLevel.Debug && typeof c[2] === "string" && c[2].includes("waiting"),
		)
		expect(waitingCall).toBeDefined()
		lock.leave(t0)
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

	test("named lock with logger: a stale leave emits a warn log", async () => {
		vi.useFakeTimers()
		const logger: ILogger = {
			log: vi.fn(),
		}
		const lock = new Lock("test-lock", logger)
		const t0 = await lock.enter()
		vi.advanceTimersByTime(5 * 60_000 + 1) // force-released; t0 is now stale
		lock.leave(t0)
		const calls = (logger.log as ReturnType<typeof vi.fn>).mock.calls
		const staleCall = calls.find(
			(c) => c[0] === "test-lock" && c[1] === LogLevel.Warn && typeof c[2] === "string" && c[2].includes("stale leave"),
		)
		expect(staleCall).toBeDefined()
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
		// — the guarantee callers that assume-they-hold (e.g. token/service.ts's
		// `_deleteTokenByIdHoldingLock` convention) implicitly depend on.
		class RejectingLock extends Lock {
			public leaveCalls = 0
			public override async enter(): Promise<LockTicket> {
				throw new Error("enter failed")
			}
			public override leave(ticket: LockTicket): void {
				this.leaveCalls += 1
				super.leave(ticket)
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

	test("(N-11 / p1-1) a force-released holder's late leave cannot release the successor", async () => {
		// H1 outlives the watchdog → force-release grants W2 → H1's fn finally
		// completes and withLock's finally performs the late leave(staleTicket).
		// PRE-FIX this released W2's acquisition and admitted W3 into W2's
		// still-running critical section (the double-release hazard, previously
		// pinned as deferred behavior). NOW: the stale leave is a no-op — W3
		// enters only when W2's OWN leave runs.
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
		let w2Ticket: LockTicket | undefined
		const w2 = (async () => {
			w2Ticket = await lock.enter()
		})()
		await vi.advanceTimersByTimeAsync(0)
		expect(w2Ticket).toBeDefined() // W2 entered post-force-release
		gate.resolve()
		await long // H1's late leave(stale) runs — must be a no-op
		let w3Acquired = false
		const w3 = (async () => {
			const t = await lock.enter()
			w3Acquired = true
			lock.leave(t)
		})()
		await vi.advanceTimersByTimeAsync(0)
		expect(w3Acquired).toBe(false) // W2 is still the exclusive owner
		lock.leave(w2Ticket!) // only W2's own leave hands over
		await vi.advanceTimersByTimeAsync(0)
		expect(w3Acquired).toBe(true)
		await Promise.all([w2, w3])
	})

	test("(N-11) a stale leave does not disarm the successor's watchdog", async () => {
		// The ticket check must precede the timer-clear in leave(): an
		// implementation that clears first passes every ownership assertion yet
		// silently strips W2's liveness net. Here W2 wedges; after H1's stale
		// leave lands, W2's OWN watchdog must still fire and admit W3.
		vi.useFakeTimers()
		const lock = new Lock()
		const gate = _deferred()
		const long = lock.withLock(async () => {
			await gate.promise
		})
		await vi.advanceTimersByTimeAsync(0)
		vi.advanceTimersByTime(5 * 60_000 + 1) // H1 displaced
		const w2Entered = _deferred()
		void (async () => {
			await lock.enter()
			w2Entered.resolve()
			await new Promise(() => {}) // W2 wedges forever, never leaves
		})()
		await vi.advanceTimersByTimeAsync(0)
		await w2Entered.promise
		gate.resolve()
		await long // H1's stale leave lands now
		let w3Acquired = false
		const w3 = (async () => {
			const t = await lock.enter()
			w3Acquired = true
			lock.leave(t)
		})()
		await vi.advanceTimersByTimeAsync(0)
		expect(w3Acquired).toBe(false)
		await vi.advanceTimersByTimeAsync(5 * 60_000 + 1) // W2's own watchdog
		expect(w3Acquired).toBe(true)
		await w3
	})

	test("(N-11) a superseded grant's watchdog callback cannot force-release the successor", async () => {
		// Belt over clearTimeout semantics: even if a grant's timer callback
		// fired late (after the grant was released and the lock moved on), its
		// own-ticket guard must make it inert.
		const timerCallbacks: Array<() => void> = []
		const st = vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void) => {
			timerCallbacks.push(cb)
			return 0 as never
		}) as never)
		const ct = vi.spyOn(globalThis, "clearTimeout").mockImplementation((() => {}) as never)
		const micro = async () => {
			await Promise.resolve()
			await Promise.resolve()
		}
		try {
			const lock = new Lock()
			const t1 = await lock.enter() // grant 1: its callback is captured, never auto-fires
			lock.leave(t1)
			const t2 = await lock.enter() // grant 2 is current
			timerCallbacks[0]!() // grant 1's callback fires late — must be inert
			let w3Acquired = false
			const w3 = (async () => {
				const t = await lock.enter()
				w3Acquired = true
				lock.leave(t)
			})()
			await micro()
			expect(w3Acquired).toBe(false) // grant 2 still owns the lock
			lock.leave(t2)
			await w3
			expect(w3Acquired).toBe(true)
		} finally {
			st.mockRestore()
			ct.mockRestore()
		}
	})

	test("mixed-mode FIFO: raw enter() waiters and withLock waiters keep enqueue order", async () => {
		const lock = new Lock()
		const order: string[] = []
		const t0 = await lock.enter()
		const a = lock.withLock(() => {
			order.push("a-withLock")
		})
		const b = (async () => {
			const t = await lock.enter()
			order.push("b-raw")
			lock.leave(t)
		})()
		const c = lock.withLock(() => {
			order.push("c-withLock")
		})
		await flush()
		lock.leave(t0)
		await Promise.all([a, b, c])
		expect(order).toEqual(["a-withLock", "b-raw", "c-withLock"])
	})

	test("non-reentrancy pin: nested withLock on one lock deadlocks until force-release", async () => {
		// Documents the invariant the services' wrappers warn about: the mutex
		// is not reentrant; a nested acquisition waits behind the outer holder.
		// Post-N-11 the force-release displaces the outer holder, whose finally
		// leave(stale) is then a no-op — the inner section still runs and its
		// own leave hands the lock over cleanly.
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
		await expect(lock.enter()).resolves.toBeTypeOf("symbol")
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
		// The holder never calls leave (its ticket scrolled out in the assertion
		// above) — the watchdog frees it for the waiter.
		vi.advanceTimersByTime(5 * 60_000 + 1)
		await vi.advanceTimersByTimeAsync(0)
		expect(waiterAcquired).toBe(true)
		// The waiter's own force-release timer was armed despite the throwing
		// logger: advancing time force-releases (a third caller can enter).
		vi.advanceTimersByTime(5 * 60_000 + 1)
		let thirdAcquired = false
		const third = (async () => {
			const t = await lock.enter()
			thirdAcquired = true
			lock.leave(t)
		})()
		await vi.advanceTimersByTimeAsync(0)
		expect(thirdAcquired).toBe(true)
		await Promise.all([waiter, third])
	})

	test("(HARDENING) contended >50ms wait: the acquired-log throw point is exercised and enter() still resolves", async () => {
		// The previous characterization never advanced time past 50ms, so the
		// post-acquisition "acquired" tryLog branch was dead in the test. This
		// drives it: waiter waits >50ms, the acquired log throws, enter resolves.
		vi.useFakeTimers()
		const throwingLogger: ILogger = {
			log: () => {
				throw new Error("logger exploded")
			},
		}
		const lock = new Lock("hardened", throwingLogger)
		const t0 = await lock.enter()
		let waiterAcquired = false
		const waiter = (async () => {
			const t = await lock.enter()
			waiterAcquired = true
			lock.leave(t)
		})()
		await vi.advanceTimersByTimeAsync(60) // waited > 50ms → acquired-log path
		lock.leave(t0)
		await vi.advanceTimersByTimeAsync(0)
		expect(waiterAcquired).toBe(true)
		await waiter
	})

	test("(HARDENING) throwing setTimeout: enter() still resolves; lock is untimed but releasable", async () => {
		const spy = vi.spyOn(globalThis, "setTimeout").mockImplementationOnce(() => {
			throw new Error("setTimeout exploded")
		})
		try {
			const lock = new Lock()
			const entered = lock.enter()
			await expect(entered).resolves.toBeTypeOf("symbol")
			lock.leave(await entered)
			// Releasable: a follow-up acquire succeeds (with a normal timer).
			let acquired = false
			await lock.withLock(() => {
				acquired = true
			})
			expect(acquired).toBe(true)
		} finally {
			spy.mockRestore()
		}
	})

	test("two-deep contention: second waiter sees the first run before it", async () => {
		const lock = new Lock()
		const order: string[] = []
		const t0 = await lock.enter()
		const first = (async () => {
			const t = await lock.enter()
			order.push("first")
			lock.leave(t)
		})()
		const second = (async () => {
			const t = await lock.enter()
			order.push("second")
			lock.leave(t)
		})()
		await flush()
		lock.leave(t0)
		await Promise.all([first, second])
		expect(order).toEqual(["first", "second"])
	})
})
