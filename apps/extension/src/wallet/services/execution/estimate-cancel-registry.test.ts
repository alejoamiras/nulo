import { describe, expect, test, vi } from "vitest"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import {
	ESTIMATE_JOB_TTL_MS,
	EstimateCancelRegistry,
	MAX_ACTIVE_ESTIMATES_PER_PROFILE,
	SETTLED_STASH_TTL_MS,
} from "./estimate-cancel-registry"

const makeRegistry = () => {
	let clock = 1_000_000
	const evicted: string[] = []
	const registry = new EstimateCancelRegistry({
		evictStash: (id) => evicted.push(id),
		logDebug: vi.fn(),
		now: () => clock,
	})
	return { registry, evicted, advance: (ms: number) => (clock += ms) }
}

const N = MAX_ACTIVE_ESTIMATES_PER_PROFILE

describe("admission", () => {
	test("admits immediately under capacity and returns a live signal", async () => {
		const { registry } = makeRegistry()
		const signal = await registry.admit("t1", "p1", "send")
		expect(signal.aborted).toBe(false)
		expect(registry.unsettledCount("p1")).toBe(1)
	})

	test("duplicate active token is rejected loudly", async () => {
		const { registry } = makeRegistry()
		await registry.admit("t1", "p1", "send")
		expect(() => registry.admit("t1", "p1", "send")).toThrow("duplicate estimate token")
	})

	test("duplicate of a settled token is rejected too", async () => {
		const { registry } = makeRegistry()
		await registry.admit("t1", "p1", "send")
		registry.settle("t1", "stash-1")
		expect(() => registry.admit("t1", "p1", "send")).toThrow("duplicate estimate token")
	})

	test("profiles have independent capacity", async () => {
		const { registry } = makeRegistry()
		for (let i = 0; i < N; i++) await registry.admit(`a${i}`, "p1", `op:${i}`)
		// p2 is unaffected by p1 being at capacity.
		const signal = await registry.admit("b0", "p2", "send")
		expect(signal.aborted).toBe(false)
	})
})

describe("cap invariant — non-preemptible jobs", () => {
	test("unsettled count NEVER exceeds N even under repeated overflow admissions", async () => {
		const { registry } = makeRegistry()
		for (let i = 0; i < N; i++) await registry.admit(`t${i}`, "p1", `op:${i}`)
		expect(registry.unsettledCount("p1")).toBe(N)

		// A storm of newcomers: none may be admitted while N jobs are
		// unsettled — cancelled jobs are non-preemptible and keep their slot.
		const parked = registry.admit("late-1", "p1", "send")
		parked.catch(() => {})
		expect(registry.unsettledCount("p1")).toBe(N)

		const parked2 = registry.admit("late-2", "p1", "op:9")
		parked2.catch(() => {})
		expect(registry.unsettledCount("p1")).toBe(N)
	})

	test("overflow aborts the oldest still-live job but does not free its slot", async () => {
		const { registry, advance } = makeRegistry()
		const signals: AbortSignal[] = []
		for (let i = 0; i < N; i++) {
			signals.push(await registry.admit(`t${i}`, "p1", `op:${i}`))
			advance(10)
		}
		registry.admit("late", "p1", "send").catch(() => {})
		expect(signals[0]!.aborted).toBe(true)
		for (let i = 1; i < N; i++) expect(signals[i]!.aborted).toBe(false)
		expect(registry.unsettledCount("p1")).toBe(N)
	})

	test("parked newcomer is admitted only when a job actually settles", async () => {
		const { registry } = makeRegistry()
		for (let i = 0; i < N; i++) await registry.admit(`t${i}`, "p1", `op:${i}`)
		let admitted = false
		const parked = registry.admit("late", "p1", "send").then((signal) => {
			admitted = true
			return signal
		})
		await Promise.resolve()
		expect(admitted).toBe(false)

		registry.settle("t1")
		const signal = await parked
		expect(admitted).toBe(true)
		expect(signal.aborted).toBe(false)
		expect(registry.unsettledCount("p1")).toBe(N)
	})

	test("latest-wins coalescing: a newer same-slot arrival cancels the parked one", async () => {
		const { registry } = makeRegistry()
		for (let i = 0; i < N; i++) await registry.admit(`t${i}`, "p1", `op:${i}`)
		const first = registry.admit("late-1", "p1", "send")
		const firstRejection = first.catch((e) => e)
		registry.admit("late-2", "p1", "send").catch(() => {})
		expect(await firstRejection).toBeInstanceOf(JobCancelledSentinel)
	})
})

describe("cancel", () => {
	test("aborts a running job and evicts its associated stash", async () => {
		const { registry, evicted } = makeRegistry()
		const signal = await registry.admit("t1", "p1", "send")
		registry.settle("t1", "stash-1")
		registry.cancel("t1", "p1")
		expect(evicted).toEqual(["stash-1"])
		// Signal of a settled job is irrelevant, but a pre-settle cancel aborts:
		const s2 = await registry.admit("t2", "p1", "send")
		registry.cancel("t2", "p1")
		expect(s2.aborted).toBe(true)
		void signal
	})

	test("foreign-profile cancel is a silent no-op (running AND settled)", async () => {
		const { registry, evicted } = makeRegistry()
		const signal = await registry.admit("t1", "p1", "send")
		registry.cancel("t1", "OTHER")
		expect(signal.aborted).toBe(false)
		registry.settle("t1", "stash-1")
		registry.cancel("t1", "OTHER")
		expect(evicted).toEqual([])
	})

	test("unknown token is a silent no-op", () => {
		const { registry } = makeRegistry()
		expect(() => registry.cancel("nope", "p1")).not.toThrow()
	})

	test("cancel of a parked newcomer rejects it out of the pending slot", async () => {
		const { registry } = makeRegistry()
		for (let i = 0; i < N; i++) await registry.admit(`t${i}`, "p1", `op:${i}`)
		const parked = registry.admit("late", "p1", "send")
		const rejection = parked.catch((e) => e)
		registry.cancel("late", "p1")
		expect(await rejection).toBeInstanceOf(JobCancelledSentinel)
	})

	test("post-settle cancel can only evict once", async () => {
		const { registry, evicted } = makeRegistry()
		await registry.admit("t1", "p1", "send")
		registry.settle("t1", "stash-1")
		registry.cancel("t1", "p1")
		registry.cancel("t1", "p1")
		expect(evicted).toEqual(["stash-1"])
	})
})

describe("settle", () => {
	test("cancel racing completion: settle after abort evicts instead of recording", async () => {
		const { registry, evicted } = makeRegistry()
		await registry.admit("t1", "p1", "send")
		// Abort lands while the runner is between its stash and its settle.
		registry.cancel("t1", "p1")
		registry.settle("t1", "stash-1")
		expect(evicted).toEqual(["stash-1"])
		// And nothing lingers for a second eviction.
		registry.cancel("t1", "p1")
		expect(evicted).toEqual(["stash-1"])
	})

	test("settle without estimateId records nothing and frees capacity", async () => {
		const { registry, evicted } = makeRegistry()
		await registry.admit("t1", "p1", "send")
		registry.settle("t1")
		expect(registry.unsettledCount("p1")).toBe(0)
		registry.cancel("t1", "p1")
		expect(evicted).toEqual([])
	})

	test("settle of an unknown token is a no-op", () => {
		const { registry } = makeRegistry()
		expect(() => registry.settle("nope", "x")).not.toThrow()
	})
})

describe("TTL sweeps", () => {
	test("a runner that never settles is reaped, freeing capacity", async () => {
		const { registry, advance } = makeRegistry()
		for (let i = 0; i < N; i++) await registry.admit(`t${i}`, "p1", `op:${i}`)
		advance(ESTIMATE_JOB_TTL_MS + 1)
		// Sweep runs on the next admit — capacity is available again.
		const signal = await registry.admit("fresh", "p1", "send")
		expect(signal.aborted).toBe(false)
		expect(registry.unsettledCount("p1")).toBe(1)
	})

	test("settled stash mappings expire after their TTL", async () => {
		const { registry, evicted, advance } = makeRegistry()
		await registry.admit("t1", "p1", "send")
		registry.settle("t1", "stash-1")
		advance(SETTLED_STASH_TTL_MS + 1)
		await registry.admit("t2", "p1", "send")
		registry.cancel("t1", "p1")
		expect(evicted).toEqual([])
	})
})
