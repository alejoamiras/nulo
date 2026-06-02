import { describe, expect, test } from "vitest"
import { ExecutionMutex, ExecutionMutexAbortError, ExecutionMutexCapacityError } from "./execution-mutex"

/** Microtask flush helper — lets queued `.then` callbacks run. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe("ExecutionMutex", () => {
	test("single acquire resolves immediately and release frees the key", async () => {
		const m = new ExecutionMutex()
		const release = await m.acquire("k")
		expect(m.isLocked("k")).toBe(true)
		release()
		expect(m.isLocked("k")).toBe(false)
	})

	test("second acquirer waits until the first releases (FIFO)", async () => {
		const m = new ExecutionMutex()
		const order: string[] = []

		const r1 = await m.acquire("k")
		order.push("a1")

		let r2!: () => void
		const p2 = m.acquire("k").then((rel) => {
			r2 = rel
			order.push("a2")
		})

		await tick()
		// B must NOT have acquired yet — A still holds.
		expect(order).toEqual(["a1"])

		r1()
		await p2
		expect(order).toEqual(["a1", "a2"])
		r2()
		expect(m.isLocked("k")).toBe(false)
	})

	test("three acquirers grant strictly in FIFO order", async () => {
		const m = new ExecutionMutex()
		const order: number[] = []
		const releases: Array<() => void> = []

		const acq = (n: number) =>
			m.acquire("k").then((rel) => {
				order.push(n)
				releases.push(rel)
			})

		const r1 = await m.acquire("k")
		order.push(0)
		const p1 = acq(1)
		const p2 = acq(2)

		await tick()
		expect(order).toEqual([0]) // only the holder

		r1()
		await p1
		expect(order).toEqual([0, 1])
		releases[0]() // release waiter 1's slot
		await p2
		expect(order).toEqual([0, 1, 2])
		releases[1]()
	})

	test("different keys are independent (no cross-blocking)", async () => {
		const m = new ExecutionMutex()
		const rA = await m.acquire("A")
		// B on a different key resolves immediately despite A being held.
		const rB = await m.acquire("B")
		expect(m.isLocked("A")).toBe(true)
		expect(m.isLocked("B")).toBe(true)
		rA()
		rB()
	})

	test("abort before enqueue rejects immediately", async () => {
		const m = new ExecutionMutex()
		const ac = new AbortController()
		ac.abort()
		await expect(m.acquire("k", ac.signal)).rejects.toBeInstanceOf(ExecutionMutexAbortError)
		// Key was never locked.
		expect(m.isLocked("k")).toBe(false)
	})

	test("abort while waiting rejects with ExecutionMutexAbortError", async () => {
		const m = new ExecutionMutex()
		const r1 = await m.acquire("k")

		const ac = new AbortController()
		const p2 = m.acquire("k", ac.signal)

		await tick()
		ac.abort()
		await expect(p2).rejects.toBeInstanceOf(ExecutionMutexAbortError)

		r1()
		// Key GC after an aborted waiter is async: the aborted waiter's release
		// is chained to the holder's release via `prior.finally`, so it runs a
		// microtask after r1(). Tick before asserting the key is free.
		await tick()
		expect(m.isLocked("k")).toBe(false)
	})

	test("aborting a MIDDLE waiter does not strand the waiter behind it, and that waiter still serializes after the real holder", async () => {
		// The subtle one. A holds. B waits then aborts. C waits.
		// C must (1) still eventually acquire, and (2) NOT acquire before A releases.
		const m = new ExecutionMutex()
		const events: string[] = []

		const rA = await m.acquire("k")
		events.push("A-hold")

		const acB = new AbortController()
		const pB = m.acquire("k", acB.signal).then(
			() => events.push("B-acquired"),
			(e) => events.push(`B-${(e as Error).name}`),
		)

		let rC!: () => void
		const pC = m.acquire("k").then((rel) => {
			rC = rel
			events.push("C-acquired")
		})

		await tick()
		// Neither B nor C acquired; A holds.
		expect(events).toEqual(["A-hold"])

		// Abort B while it waits.
		acB.abort()
		await pB
		expect(events).toContain("B-ExecutionMutexAbortError")
		// C must NOT have jumped ahead of A despite B aborting.
		expect(events).not.toContain("C-acquired")

		// A releases — C should now acquire (B was spliced out cleanly).
		rA()
		await pC
		expect(events).toEqual(["A-hold", "B-ExecutionMutexAbortError", "C-acquired"])
		rC()
		expect(m.isLocked("k")).toBe(false)
	})

	test("aborting the SOLE waiter releases the key once the holder releases", async () => {
		const m = new ExecutionMutex()
		const rA = await m.acquire("k")
		const acB = new AbortController()
		const pB = m.acquire("k", acB.signal)
		await tick()
		acB.abort()
		await expect(pB).rejects.toBeInstanceOf(ExecutionMutexAbortError)
		// Holder still holds until it releases.
		expect(m.isLocked("k")).toBe(true)
		rA()
		// After the holder releases and the aborted waiter's chained release
		// fires, the key is GC'd.
		await tick()
		expect(m.isLocked("k")).toBe(false)
	})

	test("release is idempotent", async () => {
		const m = new ExecutionMutex()
		const r1 = await m.acquire("k")
		let r2Acquired = false
		const p2 = m.acquire("k").then((rel) => {
			r2Acquired = true
			return rel
		})
		r1()
		r1() // second call is a no-op
		await p2
		expect(r2Acquired).toBe(true)
		const r2 = await p2
		r2()
	})

	test("aborting AFTER acquisition does not affect the holder", async () => {
		// Signal fires after the slot was already granted — must be a no-op.
		const m = new ExecutionMutex()
		const ac = new AbortController()
		const release = await m.acquire("k", ac.signal)
		ac.abort() // too late — we already hold it
		expect(m.isLocked("k")).toBe(true)
		release()
		expect(m.isLocked("k")).toBe(false)
	})

	test("a fresh acquire after full drain starts clean", async () => {
		const m = new ExecutionMutex()
		const r1 = await m.acquire("k")
		r1()
		expect(m.isLocked("k")).toBe(false)
		// Re-acquire same key — should resolve immediately (prior chain GC'd).
		const r2 = await m.acquire("k")
		expect(m.isLocked("k")).toBe(true)
		r2()
	})
})

describe("ExecutionMutex — backpressure cap (P1)", () => {
	test("per-origin cap rejects at the limit and frees one slot per release", async () => {
		const m = new ExecutionMutex()
		const caps = { originKey: "https://a.example", maxOriginDepth: 2, maxLaneDepth: 99 }
		const rA = await m.acquire("L", undefined, caps) // holds; origin depth 1
		const pB = m.acquire("L", undefined, caps) // queued; origin depth 2
		await tick()
		// 3rd for the same origin exceeds maxOriginDepth=2 — rejects, mutates nothing.
		await expect(m.acquire("L", undefined, caps)).rejects.toBeInstanceOf(ExecutionMutexCapacityError)
		rA() // release holder → frees a slot; B acquires
		const rB = await pB
		// A slot is free again: a NEW acquire is accepted (queues behind B), not rejected.
		const pC = m.acquire("L", undefined, caps)
		await tick()
		rB() // release B → C acquires
		const rC = await pC
		rC()
		// Full drain leaves no phantom depth — a fresh capped acquire still works.
		const rD = await m.acquire("L", undefined, caps)
		rD()
		expect(m.isLocked("L")).toBe(false)
	})

	test("total-lane cap rejects across origins even when each origin is under its cap", async () => {
		const m = new ExecutionMutex()
		const mk = (o: string) => ({ originKey: o, maxOriginDepth: 99, maxLaneDepth: 2 })
		const rA = await m.acquire("L", undefined, mk("a")) // lane depth 1
		const pB = m.acquire("L", undefined, mk("b")) // lane depth 2 (different origin)
		await tick()
		// A third origin is under its own cap but the lane is full.
		await expect(m.acquire("L", undefined, mk("c"))).rejects.toBeInstanceOf(ExecutionMutexCapacityError)
		rA()
		const rB = await pB
		rB()
	})

	test("aborted waiter's depth frees only when the holder releases (conservative over-count)", async () => {
		const m = new ExecutionMutex()
		const caps = { originKey: "o", maxOriginDepth: 2, maxLaneDepth: 99 }
		const rA = await m.acquire("L", undefined, caps) // holds; depth 1
		const ac = new AbortController()
		const pB = m.acquire("L", ac.signal, caps) // queued; depth 2
		await tick()
		ac.abort()
		await expect(pB).rejects.toBeInstanceOf(ExecutionMutexAbortError)
		// Conservative: B's slot is NOT freed yet (its release is chained to A's),
		// so the lane still reads full — a new acquire hits the cap.
		await expect(m.acquire("L", undefined, caps)).rejects.toBeInstanceOf(ExecutionMutexCapacityError)
		// A releases → B's chained release fires → both slots free → new acquire fits.
		rA()
		await tick()
		const rC = await m.acquire("L", undefined, caps)
		rC()
		expect(m.isLocked("L")).toBe(false)
	})

	test("uncapped acquire never hits the capacity cap (depth tracking is cap-only)", async () => {
		const m = new ExecutionMutex()
		const r0 = await m.acquire("L")
		const ps = [m.acquire("L"), m.acquire("L"), m.acquire("L")]
		r0()
		for (const p of ps) (await p)()
		expect(m.isLocked("L")).toBe(false)
	})
})
