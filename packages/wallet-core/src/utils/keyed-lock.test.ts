import { describe, expect, test, vi } from "vitest"
import { KeyedLock } from "./keyed-lock"

const deferred = <T = void>() => {
	let resolve!: (v: T) => void
	let reject!: (e: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe("KeyedLock (Q-08)", () => {
	test("serializes ops for the SAME key in FIFO order", async () => {
		const kl = new KeyedLock()
		const order: string[] = []
		const a = deferred()
		const p1 = kl.withLock("k", async () => {
			await a.promise
			order.push("a")
		})
		const p2 = kl.withLock("k", async () => {
			order.push("b")
		})
		// b is queued behind a; nothing has run past a's await yet.
		await Promise.resolve()
		expect(order).toEqual([])
		a.resolve()
		await Promise.all([p1, p2])
		expect(order).toEqual(["a", "b"]) // strict FIFO
	})

	test("different keys run concurrently (independent locks)", async () => {
		const kl = new KeyedLock()
		const order: string[] = []
		const a = deferred()
		const p1 = kl.withLock("k1", async () => {
			await a.promise
			order.push("k1")
		})
		const p2 = kl.withLock("k2", async () => {
			order.push("k2") // must NOT wait on k1
		})
		await p2
		expect(order).toEqual(["k2"]) // k2 finished while k1 is still blocked
		a.resolve()
		await p1
		expect(order).toEqual(["k2", "k1"])
	})

	test("a throwing op still advances the key's queue AND rejects its own caller", async () => {
		const kl = new KeyedLock()
		const boom = kl.withLock("k", async () => {
			throw new Error("boom")
		})
		await expect(boom).rejects.toThrow("boom")
		// the next op on the same key must still run (queue advanced past the throw)
		await expect(kl.withLock("k", async () => 42)).resolves.toBe(42)
	})

	test("withLock returns the op's resolved value", async () => {
		const kl = new KeyedLock()
		await expect(kl.withLock("k", () => "sync-value")).resolves.toBe("sync-value")
		await expect(kl.withLock("k", async () => 7)).resolves.toBe(7)
	})

	test("delete(key) drops the lock; a later withLock mints a fresh one (in-flight op unaffected)", async () => {
		const kl = new KeyedLock()
		const a = deferred()
		const inFlight = kl.withLock("k", async () => {
			await a.promise
			return "first"
		})
		kl.delete("k") // drop while op is in-flight
		// A new op on the same key uses a fresh lock and can run immediately.
		await expect(kl.withLock("k", async () => "second")).resolves.toBe("second")
		a.resolve()
		await expect(inFlight).resolves.toBe("first") // the in-flight op still completed
	})

	test("delete of an absent key is a no-op", () => {
		const kl = new KeyedLock()
		expect(() => kl.delete("never-seen")).not.toThrow()
	})

	test("maxHoldMs: null disables the per-key watchdog (a held key never force-releases)", async () => {
		vi.useFakeTimers()
		try {
			const kl = new KeyedLock({ maxHoldMs: null })
			const held = deferred()
			void kl.withLock("k", () => held.promise) // holds "k", never resolves
			let secondRan = false
			void kl.withLock("k", async () => {
				secondRan = true
			})
			await vi.advanceTimersByTimeAsync(10 * 60_000) // past the default 5-min watchdog
			expect(secondRan).toBe(false) // no watchdog → still queued behind the held op
			held.resolve()
			await vi.advanceTimersByTimeAsync(0)
			expect(secondRan).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})
})
