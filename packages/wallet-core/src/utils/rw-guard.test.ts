import { describe, test, expect, vi, afterEach } from "vitest"
import { MAX_READER_DRAIN_MS, ReadWriteGuard } from "./rw-guard"
import type { ILogger } from "../logger/interfaces"

/** Creates a deferred promise for controlling async timing in tests. */
function deferred<T = void>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

/** Flush all pending microtasks by waiting for a macrotask. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe("ReadWriteGuard", () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	test("concurrent reads: two reads proceed simultaneously", async () => {
		const guard = new ReadWriteGuard()
		const order: string[] = []

		const d1 = deferred()
		const d2 = deferred()

		const r1 = guard.read(async () => {
			order.push("r1:start")
			await d1.promise
			order.push("r1:end")
			return "a"
		})
		const r2 = guard.read(async () => {
			order.push("r2:start")
			await d2.promise
			order.push("r2:end")
			return "b"
		})

		await flush()
		expect(order).toEqual(["r1:start", "r2:start"])

		d2.resolve()
		d1.resolve()
		const [v1, v2] = await Promise.all([r1, r2])

		expect(v1).toBe("a")
		expect(v2).toBe("b")
		expect(order).toContain("r1:end")
		expect(order).toContain("r2:end")
	})

	test("serialized writes: second write waits for first", async () => {
		const guard = new ReadWriteGuard()
		const order: string[] = []
		const d1 = deferred()

		const w1 = guard.write(async () => {
			order.push("w1:start")
			await d1.promise
			order.push("w1:end")
		})

		await flush()
		expect(order).toContain("w1:start")

		const w2 = guard.write(async () => {
			order.push("w2:start")
		})

		await flush()
		expect(order).not.toContain("w2:start")

		d1.resolve()
		await Promise.all([w1, w2])
		expect(order).toEqual(["w1:start", "w1:end", "w2:start"])
	})

	// Reads wait for active writes — they do not bypass the lock. Bypassing
	// readers allowed a profile-switch race where a stale snapshot returned
	// from inside a destructive mid-flight write.
	test("reads wait for active writes instead of bypassing", async () => {
		const guard = new ReadWriteGuard()
		const order: string[] = []
		const dWrite = deferred()

		const w = guard.write(async () => {
			order.push("w:start")
			await dWrite.promise
			order.push("w:end")
		})

		await flush()
		expect(order).toEqual(["w:start"])

		// Read starts while write holds — must be queued, not run.
		let readResult: number | undefined
		const r = guard
			.read(async () => {
				order.push("r:done")
				return 42
			})
			.then((v) => {
				readResult = v
			})

		await flush()
		expect(order).toEqual(["w:start"]) // read did not run yet
		expect(readResult).toBeUndefined()

		dWrite.resolve()
		await w
		await r
		expect(order).toEqual(["w:start", "w:end", "r:done"])
		expect(readResult).toBe(42)
	})

	test("enterWrite blocks subsequent writes", async () => {
		const guard = new ReadWriteGuard()
		const order: string[] = []

		await guard.enterWrite()
		order.push("lock:held")

		const w = guard.write(async () => {
			order.push("w:start")
		})

		await flush()
		expect(order).toEqual(["lock:held"])

		guard.leaveWrite()
		await w
		expect(order).toEqual(["lock:held", "w:start"])
	})

	test("leaveWrite unblocks queued writes", async () => {
		const guard = new ReadWriteGuard()
		let writeRan = false

		await guard.enterWrite()
		const w = guard.write(async () => {
			writeRan = true
		})

		await flush()
		expect(writeRan).toBe(false)

		guard.leaveWrite()
		await w
		expect(writeRan).toBe(true)
	})

	test("read returns fn result, write returns fn result", async () => {
		const guard = new ReadWriteGuard()

		const readResult = await guard.read(async () => "read-value")
		expect(readResult).toBe("read-value")

		const writeResult = await guard.write(async () => 123)
		expect(writeResult).toBe(123)
	})

	test("reader-arrives-after-writer-queued waits for writer", async () => {
		const guard = new ReadWriteGuard()
		const order: string[] = []
		const dRead1 = deferred()
		const dWrite = deferred()

		// R1 is in-flight
		const r1 = guard.read(async () => {
			order.push("r1:start")
			await dRead1.promise
			order.push("r1:end")
		})
		await flush()
		expect(order).toEqual(["r1:start"])

		// W1 queues (readers=1, so it waits)
		const w1 = guard.write(async () => {
			order.push("w1:start")
			await dWrite.promise
			order.push("w1:end")
		})
		await flush()
		expect(order).toEqual(["r1:start"]) // W1 not yet running

		// R2 arrives AFTER W1 is queued — must wait for W1 (writer FIFO)
		const r2 = guard.read(async () => {
			order.push("r2:start")
		})
		await flush()
		expect(order).toEqual(["r1:start"]) // R2 not running yet

		// Release R1 → W1 wakes and runs
		dRead1.resolve()
		await r1
		await flush()
		expect(order).toEqual(["r1:start", "r1:end", "w1:start"])
		// R2 still not running (W1 holds the write)
		expect(order).not.toContain("r2:start")

		// Release W1 → R2 finally wakes
		dWrite.resolve()
		await Promise.all([w1, r2])
		expect(order).toEqual(["r1:start", "r1:end", "w1:start", "w1:end", "r2:start"])
	})

	test("enterWrite drains active readers", async () => {
		const guard = new ReadWriteGuard()
		const order: string[] = []
		const dRead = deferred()

		// Two readers active
		const r1 = guard.read(async () => {
			order.push("r1:start")
			await dRead.promise
			order.push("r1:end")
		})
		const r2 = guard.read(async () => {
			order.push("r2:start")
			await dRead.promise
			order.push("r2:end")
		})
		await flush()
		expect(order).toEqual(["r1:start", "r2:start"])

		// enterWrite must wait for both readers to drain
		let enterResolved = false
		const enter = guard.enterWrite().then(() => {
			enterResolved = true
		})
		await flush()
		expect(enterResolved).toBe(false)

		dRead.resolve()
		await Promise.all([r1, r2])
		await enter
		expect(enterResolved).toBe(true)
		expect(order).toEqual(["r1:start", "r2:start", "r1:end", "r2:end"])

		guard.leaveWrite()
	})

	test("reader throw still decrements counter", async () => {
		const guard = new ReadWriteGuard()

		await expect(
			guard.read(async () => {
				throw new Error("boom")
			}),
		).rejects.toThrow("boom")

		// Writer should be able to acquire immediately — reader counter drained.
		let wRan = false
		await guard.write(async () => {
			wRan = true
		})
		expect(wRan).toBe(true)
	})

	test("writer throw still releases the lock for next waiter", async () => {
		const guard = new ReadWriteGuard()

		await expect(
			guard.write(async () => {
				throw new Error("boom")
			}),
		).rejects.toThrow("boom")

		// Next writer runs fine.
		let w2Ran = false
		await guard.write(async () => {
			w2Ran = true
		})
		expect(w2Ran).toBe(true)

		// And a reader can also acquire.
		const rResult = await guard.read(async () => 7)
		expect(rResult).toBe(7)
	})

	test("writer FIFO: multiple queued writers run in enqueue order", async () => {
		const guard = new ReadWriteGuard()
		const order: string[] = []
		const dW1 = deferred()

		const w1 = guard.write(async () => {
			order.push("w1:start")
			await dW1.promise
			order.push("w1:end")
		})
		await flush()

		const w2 = guard.write(async () => {
			order.push("w2")
		})
		const w3 = guard.write(async () => {
			order.push("w3")
		})
		const w4 = guard.write(async () => {
			order.push("w4")
		})
		await flush()
		expect(order).toEqual(["w1:start"])

		dW1.resolve()
		await Promise.all([w1, w2, w3, w4])
		expect(order).toEqual(["w1:start", "w1:end", "w2", "w3", "w4"])
	})

	test("queued readers all wake together when writer releases", async () => {
		const guard = new ReadWriteGuard()
		const order: string[] = []
		const dW = deferred()
		const dReads = deferred()

		const w = guard.write(async () => {
			order.push("w:start")
			await dW.promise
			order.push("w:end")
		})
		await flush()

		// Two readers queue up while W holds
		const r1 = guard.read(async () => {
			order.push("r1:start")
			await dReads.promise
		})
		const r2 = guard.read(async () => {
			order.push("r2:start")
			await dReads.promise
		})
		await flush()
		expect(order).toEqual(["w:start"])

		// Release W → both readers wake concurrently
		dW.resolve()
		await w
		await flush()
		expect(order).toEqual(["w:start", "w:end", "r1:start", "r2:start"])

		dReads.resolve()
		await Promise.all([r1, r2])
	})

	test("force-release unsticks writer after MAX_READER_DRAIN_MS when readers hang", async () => {
		vi.useFakeTimers()
		const logCalls: unknown[][] = []
		const logger: ILogger = {
			log: (_source: string, _level: number, ...data: unknown[]) => {
				logCalls.push(data)
			},
		}
		const guard = new ReadWriteGuard("test", logger)

		const dStuck = deferred()
		const r = guard.read(async () => {
			await dStuck.promise // never resolves during this test
		})

		// Flush microtasks so the read actually starts (readers++).
		await vi.advanceTimersByTimeAsync(0)

		// Writer queues
		let wRan = false
		const w = guard.write(async () => {
			wRan = true
		})

		await vi.advanceTimersByTimeAsync(0)
		expect(wRan).toBe(false)

		// Advance past the force-release ceiling
		await vi.advanceTimersByTimeAsync(MAX_READER_DRAIN_MS + 100)

		// Writer should have run by now via force-drain
		expect(wRan).toBe(true)
		expect(logCalls.some((args) => String(args[0]).includes("force-released"))).toBe(true)

		await w
		// Stuck read is still pending in the event loop; drop it.
		dStuck.resolve()
		await r
	})

	test("drain ceiling outlasts a 30-minute proof: no force-release fires for a legitimate long reader", async () => {
		// The longest legitimate reader is a proveTx (30 min). A drain ceiling
		// below that let profile deletion overlap live PXE work; the ceiling
		// must sit above the proving envelope.
		expect(MAX_READER_DRAIN_MS).toBeGreaterThan(30 * 60_000)

		vi.useFakeTimers()
		const logCalls: unknown[][] = []
		const logger: ILogger = {
			log: (_source: string, _level: number, ...data: unknown[]) => {
				logCalls.push(data)
			},
		}
		const guard = new ReadWriteGuard("test", logger)

		const dProof = deferred()
		const r = guard.read(async () => {
			await dProof.promise
		})
		await vi.advanceTimersByTimeAsync(0)

		let wRan = false
		const w = guard.write(async () => {
			wRan = true
		})

		// 30 minutes in: the proof is still legitimately holding the read.
		await vi.advanceTimersByTimeAsync(30 * 60_000)
		expect(wRan).toBe(false)
		expect(logCalls.length).toBe(0)

		dProof.resolve()
		await r
		await vi.advanceTimersByTimeAsync(0)
		expect(wRan).toBe(true)
		await w
	})

	test("a force-released reader's late finish cannot skew exclusion (no negative reader count)", async () => {
		// Regression for the counter-skew hazard: force-release zeroed a numeric
		// count, the outlived reader's finally decremented it to -1, and from
		// then on a writer could enter concurrently with one live reader.
		vi.useFakeTimers()
		const guard = new ReadWriteGuard("test", {
			log: () => {},
		})

		// Reader A outlives the drain ceiling.
		const dA = deferred()
		const rA = guard.read(async () => {
			await dA.promise
		})
		await vi.advanceTimersByTimeAsync(0)

		// Writer 1 queues, force-release lets it through.
		const w1 = guard.write(async () => {})
		await vi.advanceTimersByTimeAsync(MAX_READER_DRAIN_MS + 100)
		await w1

		// The orphaned reader finally finishes AFTER the force-release.
		dA.resolve()
		await rA
		await vi.advanceTimersByTimeAsync(0)

		// Post-skew probe: a NEW live reader must still exclude a writer.
		const dB = deferred()
		const order: string[] = []
		const rB = guard.read(async () => {
			order.push("rB:start")
			await dB.promise
			order.push("rB:end")
		})
		await vi.advanceTimersByTimeAsync(0)

		const w2 = guard.write(async () => {
			order.push("w2")
		})
		await vi.advanceTimersByTimeAsync(0)

		// With the skew, w2 would already have run here (readers === 0 while rB live).
		expect(order).toEqual(["rB:start"])

		dB.resolve()
		await Promise.all([rB, w2])
		expect(order).toEqual(["rB:start", "rB:end", "w2"])
	})

	test("read result still returned when writer queues behind it", async () => {
		// Regression: ensure our baton-pass / counter logic doesn't swallow results.
		const guard = new ReadWriteGuard()
		const dRead = deferred()

		const r = guard.read(async () => {
			await dRead.promise
			return "value"
		})

		const w = guard.write(async () => 99)

		await flush()
		dRead.resolve()
		const [rv, wv] = await Promise.all([r, w])
		expect(rv).toBe("value")
		expect(wv).toBe(99)
	})
})
