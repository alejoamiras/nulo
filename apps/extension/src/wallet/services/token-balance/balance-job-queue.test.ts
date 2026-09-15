import { afterEach, beforeEach, describe, test, expect, vi } from "vitest"
import { FakeBackgroundTicker } from "@nulo/wallet-core/testing"
import type { TaskService } from "@/wallet/services/task/service"
import { BalanceJobQueue } from "./balance-job-queue"
import type { BalanceProjector, ProjectedBalance } from "./balance-projector"
import type { BalanceRepository } from "./balance-repository"
import type { TokenBalanceRaw } from "./spec"

const raw = (id: number, overrides: Partial<TokenBalanceRaw> = {}): TokenBalanceRaw => ({
	id,
	token: 1,
	account: "0xA",
	profileId: "p1",
	chainId: 1,
	contract: "0xc1",
	privateBalance: "0",
	publicBalance: "0",
	updatedAt: 0,
	...overrides,
})

type TaskMock = {
	service: TaskService
	createNewTask: ReturnType<typeof vi.fn>
	startNewTask: ReturnType<typeof vi.fn>
	startTask: ReturnType<typeof vi.fn>
	completeTask: ReturnType<typeof vi.fn>
	failTask: ReturnType<typeof vi.fn>
	getTaskSync: ReturnType<typeof vi.fn>
	hasTask: ReturnType<typeof vi.fn>
	cancelTask: ReturnType<typeof vi.fn>
}

function makeTaskService(): TaskMock {
	let nextId = 1
	const finishedAt = new Map<string, boolean>()
	const createNewTask = vi.fn().mockImplementation(() => {
		const id = `task-${nextId++}`
		return { id }
	})
	const startNewTask = vi.fn().mockImplementation(() => {
		const id = `task-${nextId++}`
		return { id }
	})
	const startTask = vi.fn()
	const completeTask = vi.fn().mockImplementation((id: string) => {
		finishedAt.set(id, true)
	})
	const failTask = vi.fn().mockImplementation((id: string) => {
		finishedAt.set(id, true)
	})
	const getTaskSync = vi.fn().mockImplementation((id: string) => ({
		id,
		finishedAt: finishedAt.get(id) ? Date.now() : undefined,
	}))
	// Real tasks exist by default; a profile-switch test flips this to model the
	// wiped map (the pre-registered ids no longer resolve).
	const hasTask = vi.fn().mockReturnValue(true)
	const cancelTask = vi.fn().mockImplementation((id: string) => {
		// Mirror the real TaskService: finishing an already-finished task throws.
		if (finishedAt.get(id)) throw new Error(`Cannot finish already finished task ${id}`)
		finishedAt.set(id, true)
	})
	return {
		service: {
			createNewTask,
			startNewTask,
			startTask,
			completeTask,
			failTask,
			getTaskSync,
			hasTask,
			cancelTask,
		} as unknown as TaskService,
		createNewTask,
		startNewTask,
		startTask,
		completeTask,
		failTask,
		getTaskSync,
		hasTask,
		cancelTask,
	}
}

function makeRepo(seeded: TokenBalanceRaw[] = []): BalanceRepository {
	const store = new Map<number, TokenBalanceRaw>(seeded.map((b) => [b.id, b]))
	return {
		get: async (id: number) => store.get(id),
		getAll: async () => Array.from(store.values()),
		set: async (b: TokenBalanceRaw) => {
			store.set(b.id, b)
		},
		delete: async (id: number) => {
			store.delete(id)
		},
		allocateId: async () => {
			const max = Array.from(store.keys()).reduce((m, k) => Math.max(m, k), 0)
			return max + 1
		},
	} as BalanceRepository
}

function makeProjector(results: ProjectedBalance[] | ((input: TokenBalanceRaw[]) => ProjectedBalance[])): {
	projector: BalanceProjector
	calls: TokenBalanceRaw[][]
} {
	const calls: TokenBalanceRaw[][] = []
	const projector = {
		project: async (balances: TokenBalanceRaw[]) => {
			calls.push([...balances])
			return typeof results === "function" ? results(balances) : results
		},
	} as BalanceProjector
	return { projector, calls }
}

describe("BalanceJobQueue", () => {
	test("start subscribes to the ticker; stop cancels", () => {
		const ticker = new FakeBackgroundTicker()
		const queue = new BalanceJobQueue(ticker, makeRepo(), makeProjector([]).projector, makeTaskService().service, {
			getGeneration: () => 0,
			onBalanceUpdated: vi.fn(),
		})
		expect(ticker.activeSubscriptions).toBe(0)
		queue.start()
		expect(ticker.activeSubscriptions).toBe(1)
		queue.stop()
		expect(ticker.activeSubscriptions).toBe(0)
	})

	test("enqueue dedups via Queue.priorityPass — same id only once", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1)])
		const tasks = makeTaskService()
		const { projector, calls } = makeProjector([{ kind: "ok", id: 1, privateBalance: "100", publicBalance: "50" }])
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, { getGeneration: () => 0, onBalanceUpdated: vi.fn() })

		queue.enqueue(raw(1))
		queue.enqueue(raw(1)) // should dedup
		queue.enqueue(raw(1)) // should dedup

		await queue.tick()
		expect(calls).toHaveLength(1)
		expect(calls[0]).toHaveLength(1) // only one balance in the batch
	})

	test("enqueue creates a TaskService record only once per id (pendingTasks dedup)", () => {
		const ticker = new FakeBackgroundTicker()
		const tasks = makeTaskService()
		const queue = new BalanceJobQueue(ticker, makeRepo(), makeProjector([]).projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated: vi.fn(),
		})

		queue.enqueue(raw(1))
		queue.enqueue(raw(1))
		queue.enqueue(raw(1))
		expect(tasks.createNewTask).toHaveBeenCalledTimes(1)
	})

	test("(B-04 PIN) a stale task id (profile switch cleared TaskService) does not jam the sync — batch still projects", async () => {
		// enqueue mints a task + records pendingTasks[id]. A profile switch then
		// clears TaskService's map, so the next tick's startTask(staleId) throws
		// "Invalid task id" — which today escapes BEFORE the try/finally, dropping
		// the whole batch AND leaving the dead pendingTasks entry so every future
		// enqueue coalesces onto it (permanent jam). The fix mints a fresh task on
		// that failure so the balance still projects.
		const ticker = new FakeBackgroundTicker()
		const tasks = makeTaskService()
		const { projector, calls } = makeProjector([])
		const queue = new BalanceJobQueue(ticker, makeRepo(), projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated: vi.fn(),
		})

		queue.enqueue(raw(42))
		// Profile switch cleared the task map: the pre-registered id no longer
		// resolves, and calling startTask on it would throw "Invalid task id".
		tasks.hasTask.mockReturnValue(false)
		tasks.startTask.mockImplementation(() => {
			throw new Error("Invalid task id: cleared-on-profile-switch")
		})

		await queue.tick()

		// The balance must STILL have been projected (synced) despite the stale task.
		expect(calls.length).toBeGreaterThan(0)
		expect(calls[0]?.some((b) => b.id === 42)).toBe(true)
		// The fix detects the stale id via hasTask and mints fresh — it must NOT
		// call startTask on the cleared id (which throws and drops the batch).
		expect(tasks.startTask).not.toHaveBeenCalled()
	})

	test("(B-04 reset PIN) reset cancels the TaskService records it drops so none are orphaned", async () => {
		const ticker = new FakeBackgroundTicker()
		const tasks = makeTaskService()
		const queue = new BalanceJobQueue(ticker, makeRepo(), makeProjector([]).projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated: vi.fn(),
		})
		queue.enqueue(raw(1))
		queue.enqueue(raw(2))
		const droppedIds = [queue.getPendingTaskId(1), queue.getPendingTaskId(2)]

		// On lock, TaskService keeps its map — dropping only our pointer would strand
		// each record as a phantom "in-progress" task. reset must finish them.
		queue.reset()

		for (const id of droppedIds) expect(tasks.cancelTask).toHaveBeenCalledWith(id)
		expect(queue.hasPendingTask(1)).toBe(false)
		expect(queue.hasPendingTask(2)).toBe(false)
	})

	test("(B-04 cancel-race PIN) reset tolerates an already-finished task and still clears its pointer", () => {
		const ticker = new FakeBackgroundTicker()
		const tasks = makeTaskService()
		const queue = new BalanceJobQueue(ticker, makeRepo(), makeProjector([]).projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated: vi.fn(),
		})
		queue.enqueue(raw(1))
		const id = queue.getPendingTaskId(1)!
		// The task finished (completed/failed) between enqueue and reset — cancel now
		// throws "already finished". reset must swallow it AND still drop the pointer.
		tasks.service.completeTask(id)

		expect(() => queue.reset()).not.toThrow()
		expect(queue.hasPendingTask(1)).toBe(false)
	})

	test("hasPendingTask / getPendingTaskId reflect the freshly-minted task (D4 causal-ack seam)", () => {
		const ticker = new FakeBackgroundTicker()
		const tasks = makeTaskService()
		const queue = new BalanceJobQueue(ticker, makeRepo(), makeProjector([]).projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated: vi.fn(),
		})

		expect(queue.hasPendingTask(1)).toBe(false)
		expect(queue.getPendingTaskId(1)).toBeUndefined()

		queue.enqueue(raw(1))
		expect(queue.hasPendingTask(1)).toBe(true)
		expect(typeof queue.getPendingTaskId(1)).toBe("string")
		// A second enqueue COALESCES — the anchored task id is unchanged.
		const first = queue.getPendingTaskId(1)
		queue.enqueue(raw(1))
		expect(queue.getPendingTaskId(1)).toBe(first)
	})

	test("tick drains queue until empty (not one-batch-per-tick)", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo(Array.from({ length: 30 }, (_, i) => raw(i + 1)))
		const tasks = makeTaskService()
		const { projector, calls } = makeProjector((input) =>
			input.map((b) => ({ kind: "ok" as const, id: b.id, privateBalance: "1", publicBalance: "1" })),
		)
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, { getGeneration: () => 0, onBalanceUpdated: vi.fn() })

		for (let i = 1; i <= 30; i++) queue.enqueue(raw(i))

		await queue.tick()
		// All 30 balances processed in a single tick, but in 3 batches of 12+12+6
		// (batch-size ceiling preserved).
		expect(calls.length).toBe(3)
		expect(calls[0]!.length).toBe(12)
		expect(calls[1]!.length).toBe(12)
		expect(calls[2]!.length).toBe(6)
	})

	test("tick batches by FIRST account in FIFO order", async () => {
		// The outer drain picks the first queued balance's account,
		// batches consecutive same-account balances up to 12, then moves
		// on. Interleaved accounts produce separate batches. This test
		// pins that behavior verbatim.
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1, { account: "0xA" }), raw(2, { account: "0xA" }), raw(3, { account: "0xB" })])
		const tasks = makeTaskService()
		const { projector, calls } = makeProjector((input) =>
			input.map((b) => ({ kind: "ok" as const, id: b.id, privateBalance: "1", publicBalance: "1" })),
		)
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, { getGeneration: () => 0, onBalanceUpdated: vi.fn() })

		// Interleave: A, B, A. `Queue.priorityPass` pushes to the HEAD,
		// so the queue order is [A:2, B:3, A:1]. First batch drains
		// consecutive same-account from the head ([A:2]); then [B:3];
		// then [A:1].
		queue.enqueue(raw(1, { account: "0xA" }))
		queue.enqueue(raw(3, { account: "0xB" }))
		queue.enqueue(raw(2, { account: "0xA" }))

		await queue.tick()

		expect(calls.length).toBe(3)
		expect(calls[0]!.map((b) => b.id)).toEqual([2])
		expect(calls[1]!.map((b) => b.id)).toEqual([3])
		expect(calls[2]!.map((b) => b.id)).toEqual([1])
	})

	test("consecutive same-account balances coalesce into one batch", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1, { account: "0xA" }), raw(2, { account: "0xA" }), raw(3, { account: "0xA" })])
		const tasks = makeTaskService()
		const { projector, calls } = makeProjector((input) =>
			input.map((b) => ({ kind: "ok" as const, id: b.id, privateBalance: "1", publicBalance: "1" })),
		)
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, { getGeneration: () => 0, onBalanceUpdated: vi.fn() })

		queue.enqueue(raw(1, { account: "0xA" }))
		queue.enqueue(raw(2, { account: "0xA" }))
		queue.enqueue(raw(3, { account: "0xA" }))
		await queue.tick()

		expect(calls.length).toBe(1)
		expect(calls[0]!.map((b) => b.id).sort()).toEqual([1, 2, 3])
	})

	test("successful project writes updated balance via repo.set + completes task + fires callback", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1, { privateBalance: "0", publicBalance: "0" })])
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const { projector } = makeProjector([{ kind: "ok", id: 1, privateBalance: "100", publicBalance: "50" }])
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, { getGeneration: () => 0, onBalanceUpdated })

		queue.enqueue(raw(1))
		await queue.tick()

		const updated = await repo.get(1)
		expect(updated?.privateBalance).toBe("100")
		expect(updated?.publicBalance).toBe("50")
		expect(updated?.updatedAt).toBeGreaterThan(0)
		expect(tasks.completeTask).toHaveBeenCalledTimes(1)
		expect(onBalanceUpdated).toHaveBeenCalledTimes(1)
	})

	test("projector error persists a syncFailure record — balances/updatedAt untouched, listeners notified", async () => {
		// The pre-existing pin here was "no storage write on error", which made a
		// FAILED projection indistinguishable from a still-running one once the
		// in-memory task record died with the SW. Consciously replaced: failures
		// now write ONLY the failure record onto the live row.
		const ticker = new FakeBackgroundTicker()
		const original = raw(1, { privateBalance: "0", updatedAt: 77 })
		const repo = makeRepo([original])
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const { projector } = makeProjector([{ kind: "error", id: 1, error: "sim failed", transient: false }])
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, { getGeneration: () => 0, onBalanceUpdated })

		queue.enqueue(raw(1))
		await queue.tick()

		expect(tasks.failTask).toHaveBeenCalledWith(expect.any(String), "sim failed")
		expect(tasks.cancelTask).not.toHaveBeenCalled()
		const row = await repo.get(1)
		expect(row?.privateBalance).toBe("0") // unchanged
		expect(row?.updatedAt).toBe(77) // unchanged — the value is NOT fresher
		expect(row?.syncFailure?.message).toBe("sim failed")
		expect(row?.syncFailure?.at).toEqual(expect.any(Number))
		expect(onBalanceUpdated).toHaveBeenCalledTimes(1)
		expect(onBalanceUpdated).toHaveBeenCalledWith(
			expect.objectContaining({ syncFailure: expect.objectContaining({ message: "sim failed" }) }),
		)
	})

	test("the next SUCCESSFUL projection clears the syncFailure record", async () => {
		const ticker = new FakeBackgroundTicker()
		const original = raw(1, { privateBalance: "0", updatedAt: 77 })
		const repo = makeRepo([{ ...original, syncFailure: { at: 1, message: "old failure" } }])
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const { projector } = makeProjector([{ kind: "ok", id: 1, privateBalance: "9", publicBalance: "0" }])
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, { getGeneration: () => 0, onBalanceUpdated })

		queue.enqueue(raw(1))
		await queue.tick()

		const row = await repo.get(1)
		expect(row?.privateBalance).toBe("9")
		expect(row?.syncFailure).toBeUndefined()
	})

	test("a deleted row gets NO failure write (failures must not resurrect rows)", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([]) // row already deleted
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const { projector } = makeProjector([{ kind: "error", id: 1, error: "sim failed", transient: false }])
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, { getGeneration: () => 0, onBalanceUpdated })

		queue.enqueue(raw(1))
		await queue.tick()

		expect(await repo.get(1)).toBeUndefined()
		expect(onBalanceUpdated).not.toHaveBeenCalled()
	})

	test("deletion fence: a delete interleaving between the re-read and the write cannot resurrect the row (TOCTOU pin)", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1)])
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const invalidated = new Set<number>()
		// The projector resolves, then the SERVICE "deletes" the row exactly in
		// the window before the queue's write: fence added + row removed.
		const { projector } = makeProjector(() => {
			invalidated.add(1)
			void repo.delete(1)
			return [{ kind: "ok" as const, id: 1, privateBalance: "9", publicBalance: "0" }]
		})
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated,
			isBalanceInvalidated: (id) => invalidated.has(id),
		})

		queue.enqueue(raw(1))
		await queue.tick()

		expect(await repo.get(1)).toBeUndefined() // never resurrected
		expect(onBalanceUpdated).not.toHaveBeenCalled()
	})

	test("deletion fence guards the FAILURE write too", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1)])
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const invalidated = new Set<number>()
		const { projector } = makeProjector(() => {
			invalidated.add(1)
			return [{ kind: "error" as const, id: 1, error: "sim failed", transient: false }]
		})
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated,
			isBalanceInvalidated: (id) => invalidated.has(id),
		})

		queue.enqueue(raw(1))
		await queue.tick()

		expect((await repo.get(1))?.syncFailure).toBeUndefined()
		expect(onBalanceUpdated).not.toHaveBeenCalled()
	})

	test("a token deleted DURING the awaited success write is not emitted; healthy siblings survive", async () => {
		// The emit runs after an awaited repo.set — a deletion landing inside that
		// await used to throw through the service's token lookup into the batch
		// catch, falsely stamping syncFailure on every remaining healthy row.
		const ticker = new FakeBackgroundTicker()
		const emittable = new Set([1, 2])
		const base = makeRepo([raw(1, { token: 1 }), raw(2, { token: 2 })])
		const repo = {
			...base,
			set: async (b: TokenBalanceRaw) => {
				await base.set(b)
				if (b.token === 1) emittable.delete(1)
			},
		} as BalanceRepository
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const { projector } = makeProjector([
			{ kind: "ok", id: 1, privateBalance: "1", publicBalance: "0" },
			{ kind: "ok", id: 2, privateBalance: "9", publicBalance: "0" },
		])
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated,
			isRowEmittable: (row) => emittable.has(row.token),
		})

		queue.enqueue(raw(1, { token: 1 }))
		queue.enqueue(raw(2, { token: 2 }))
		await queue.tick()

		expect(onBalanceUpdated).toHaveBeenCalledTimes(1) // row 2 only
		expect(onBalanceUpdated.mock.calls[0][0].id).toBe(2)
		expect((await repo.get(2))?.privateBalance).toBe("9")
		expect((await repo.get(2))?.syncFailure).toBeUndefined() // no batch-wide false failure
	})

	test("a foreign-profile row (unknown token) gets NO failure record and cannot abort the batch", async () => {
		// Balances carry no profileId: a shared-address row from another profile
		// reaches the queue and the projector errors it as "Unknown token". The
		// failure write must skip it (the row isn't ours) AND the batch's healthy
		// rows must still process — the emit path would otherwise throw through
		// the service's token lookup and stamp bogus failures batch-wide.
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1, { token: 1 }), raw(2, { token: 2 })])
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const { projector } = makeProjector([
			{ kind: "error", id: 1, error: "Unknown token #1", transient: false },
			{ kind: "ok", id: 2, privateBalance: "9", publicBalance: "0" },
		])
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated,
			isRowEmittable: (row) => row.token !== 1,
		})

		queue.enqueue(raw(1, { token: 1 }))
		queue.enqueue(raw(2, { token: 2 }))
		await queue.tick()

		expect((await repo.get(1))?.syncFailure).toBeUndefined() // foreign row untouched
		expect((await repo.get(2))?.privateBalance).toBe("9") // healthy row still processed
		expect(onBalanceUpdated).toHaveBeenCalledTimes(1)
	})

	test("a hostile-length failure message is bounded before persisting", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1)])
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const { projector } = makeProjector([{ kind: "error", id: 1, error: "x".repeat(5000), transient: false }])
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, { getGeneration: () => 0, onBalanceUpdated })

		queue.enqueue(raw(1))
		await queue.tick()

		expect((await repo.get(1))?.syncFailure?.message.length).toBeLessThanOrEqual(200)
	})

	test("orphan balance (deleted mid-sync) fails task instead of writing", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([]) // balance NOT in storage
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const onOrphanDetected = vi.fn()
		const { projector } = makeProjector([{ kind: "ok", id: 1, privateBalance: "100", publicBalance: "50" }])
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated,
			onOrphanDetected,
		})

		queue.enqueue(raw(1))
		await queue.tick()

		expect(tasks.failTask).toHaveBeenCalledWith(expect.any(String), "Balance record not found")
		expect(onBalanceUpdated).not.toHaveBeenCalled()
		expect(onOrphanDetected).toHaveBeenCalledTimes(1)
	})

	test("empty queue — tick is a no-op", async () => {
		const ticker = new FakeBackgroundTicker()
		const tasks = makeTaskService()
		const { projector, calls } = makeProjector([])
		const queue = new BalanceJobQueue(ticker, makeRepo(), projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated: vi.fn(),
		})
		await queue.tick()
		expect(calls.length).toBe(0)
		expect(tasks.createNewTask).not.toHaveBeenCalled()
	})

	test("tick driven via ticker subscription", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1)])
		const tasks = makeTaskService()
		const { projector, calls } = makeProjector([{ kind: "ok", id: 1, privateBalance: "1", publicBalance: "1" }])
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, { getGeneration: () => 0, onBalanceUpdated: vi.fn() })

		queue.start()
		queue.enqueue(raw(1))

		// Queue never processes without a tick.
		expect(calls.length).toBe(0)

		await ticker.tick()
		expect(calls.length).toBe(1)
	})

	test("(N-10) generation fence: an A→B→A switch during the projector await drops the success write", async () => {
		// The tokens-map membership fence is DISARMED by a round-trip switch (the
		// map repopulates); only the generation distinguishes the departed context.
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1, { privateBalance: "0", publicBalance: "0" })])
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		let generation = 0
		const { projector } = makeProjector(() => {
			generation += 2 // A→B→A: two switches while the batch is in flight
			return [{ kind: "ok" as const, id: 1, privateBalance: "999", publicBalance: "0" }]
		})
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, {
			getGeneration: () => generation,
			onBalanceUpdated,
		})

		queue.enqueue(raw(1))
		await queue.tick()

		expect((await repo.get(1))?.privateBalance).toBe("0") // B-computed value never landed on A's row
		expect(onBalanceUpdated).not.toHaveBeenCalled()
		expect(tasks.failTask).toHaveBeenCalledWith(expect.any(String), "Profile changed mid-sync")
	})

	test("(N-10) generation fence guards the FAILURE write too", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1)])
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		let generation = 0
		const { projector } = makeProjector(() => {
			generation += 2
			return [{ kind: "error" as const, id: 1, error: "sim failed", transient: false }]
		})
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, {
			getGeneration: () => generation,
			onBalanceUpdated,
		})

		queue.enqueue(raw(1))
		await queue.tick()

		// The task still fails with the projector error, but no failure record is
		// stamped onto a row now owned by a different profile context.
		expect((await repo.get(1))?.syncFailure).toBeUndefined()
		expect(onBalanceUpdated).not.toHaveBeenCalled()
		expect(tasks.failTask).toHaveBeenCalledWith(expect.any(String), "sim failed")
	})

	test("(N-10) positive control: a stable generation writes and emits normally", async () => {
		const ticker = new FakeBackgroundTicker()
		const repo = makeRepo([raw(1, { privateBalance: "0", publicBalance: "0" })])
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const { projector } = makeProjector([{ kind: "ok" as const, id: 1, privateBalance: "100", publicBalance: "50" }])
		const queue = new BalanceJobQueue(ticker, repo, projector, tasks.service, {
			getGeneration: () => 7,
			onBalanceUpdated,
		})

		queue.enqueue(raw(1))
		await queue.tick()

		expect((await repo.get(1))?.privateBalance).toBe("100")
		expect(onBalanceUpdated).toHaveBeenCalledTimes(1)
	})
})

describe("BalanceJobQueue — bounded transient retry", () => {
	const TRANSIENT: ProjectedBalance = { kind: "error", id: 1, error: "stale chain anchor persisted after a resync", transient: true }
	const OK: ProjectedBalance = { kind: "ok", id: 1, privateBalance: "100", publicBalance: "50" }
	const RETRY_DELAY_MS = 5_000

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] })
		vi.setSystemTime(1_000_000)
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	function elapse(ms: number) {
		vi.setSystemTime(Date.now() + ms)
	}

	/** A projector that answers each call from `script` in order, repeating the last entry. */
	function scripted(script: ProjectedBalance[][]) {
		let i = 0
		return makeProjector(() => script[Math.min(i++, script.length - 1)])
	}

	function setup(
		script: ProjectedBalance[][],
		callbacks: Partial<ConstructorParameters<typeof BalanceJobQueue>[4]> = {},
		seeded: TokenBalanceRaw[] = [raw(1, { privateBalance: "0", updatedAt: 77 })],
	) {
		const repo = makeRepo(seeded)
		const tasks = makeTaskService()
		const onBalanceUpdated = vi.fn()
		const { projector, calls } = scripted(script)
		const queue = new BalanceJobQueue(new FakeBackgroundTicker(), repo, projector, tasks.service, {
			getGeneration: () => 0,
			onBalanceUpdated,
			...callbacks,
		})
		return { repo, tasks, onBalanceUpdated, calls, queue }
	}

	test("a transient failure is cancelled (no failure record), retried once the delay elapses, and a success clears the budget", async () => {
		const { repo, tasks, onBalanceUpdated, calls, queue } = setup([[TRANSIENT], [OK], [TRANSIENT]])

		queue.enqueue(raw(1))
		await queue.tick()

		expect(tasks.cancelTask).toHaveBeenCalledTimes(1)
		expect(tasks.failTask).not.toHaveBeenCalled()
		expect((await repo.get(1))?.syncFailure).toBeUndefined()
		expect(onBalanceUpdated).not.toHaveBeenCalled()
		expect(queue.hasPendingTask(1)).toBe(false)

		// Not due yet: a tick inside the delay does nothing.
		elapse(RETRY_DELAY_MS - 1)
		await queue.tick()
		expect(calls).toHaveLength(1)

		elapse(1)
		await queue.tick()
		expect(calls).toHaveLength(2)
		expect((await repo.get(1))?.privateBalance).toBe("100")
		expect(tasks.completeTask).toHaveBeenCalledTimes(1)
		expect(onBalanceUpdated).toHaveBeenCalledTimes(1)

		// The success reset the budget: a later transient failure is retried again, not persisted.
		queue.enqueue(raw(1))
		await queue.tick()
		expect(tasks.cancelTask).toHaveBeenCalledTimes(2)
		expect(tasks.failTask).not.toHaveBeenCalled()
	})

	test("the budget is two retries: the third transient failure persists a syncFailure like any other", async () => {
		const { repo, tasks, onBalanceUpdated, calls, queue } = setup([[TRANSIENT]])

		queue.enqueue(raw(1))
		await queue.tick()
		elapse(RETRY_DELAY_MS)
		await queue.tick()
		elapse(RETRY_DELAY_MS)
		await queue.tick()

		expect(calls).toHaveLength(3)
		expect(tasks.cancelTask).toHaveBeenCalledTimes(2)
		expect(tasks.failTask).toHaveBeenCalledTimes(1)
		const row = await repo.get(1)
		expect(row?.syncFailure?.message).toBe(TRANSIENT.kind === "error" ? TRANSIENT.error : "")
		expect(row?.updatedAt).toBe(77)
		expect(onBalanceUpdated).toHaveBeenCalledTimes(1)

		// Terminal: nothing is scheduled behind the persisted failure.
		elapse(RETRY_DELAY_MS)
		await queue.tick()
		expect(calls).toHaveLength(3)
	})

	test("an explicit enqueue during the delay supersedes the retry: one attempt, and nothing runs when the delay elapses", async () => {
		const { tasks, calls, queue } = setup([[TRANSIENT], [OK]])

		queue.enqueue(raw(1))
		await queue.tick()
		queue.enqueue(raw(1))
		await queue.tick()
		expect(calls).toHaveLength(2)
		expect(tasks.completeTask).toHaveBeenCalledTimes(1)

		elapse(RETRY_DELAY_MS)
		await queue.tick()
		expect(calls).toHaveLength(2)
	})

	test("reset() drops a pending retry with its budget", async () => {
		const { calls, queue } = setup([[TRANSIENT]])

		queue.enqueue(raw(1))
		await queue.tick()
		queue.reset()
		elapse(RETRY_DELAY_MS)
		await queue.tick()
		expect(calls).toHaveLength(1)
	})

	test("a due retry from an older profile generation is dropped", async () => {
		let generation = 0
		const { calls, queue } = setup([[TRANSIENT]], { getGeneration: () => generation })

		queue.enqueue(raw(1))
		await queue.tick()
		generation = 1
		elapse(RETRY_DELAY_MS)
		await queue.tick()
		expect(calls).toHaveLength(1)
	})

	test("a stale transient completion (generation moved mid-flight) fails its task and schedules nothing", async () => {
		let generation = 0
		const repo = makeRepo([raw(1)])
		const tasks = makeTaskService()
		const { projector, calls } = makeProjector(() => {
			generation += 2
			return [TRANSIENT]
		})
		const queue = new BalanceJobQueue(new FakeBackgroundTicker(), repo, projector, tasks.service, {
			getGeneration: () => generation,
			onBalanceUpdated: vi.fn(),
		})

		queue.enqueue(raw(1))
		await queue.tick()
		expect(tasks.cancelTask).not.toHaveBeenCalled()
		expect(tasks.failTask).toHaveBeenCalledTimes(1)
		expect((await repo.get(1))?.syncFailure).toBeUndefined()

		elapse(RETRY_DELAY_MS)
		await queue.tick()
		expect(calls).toHaveLength(1)
	})

	test("an invalidated row is dropped at scheduling time and at drain time", async () => {
		const invalidated = new Set<number>()
		const { tasks, calls, queue } = setup([[TRANSIENT]], { isBalanceInvalidated: (id) => invalidated.has(id) })

		// Drain time: invalidated while the retry waits.
		queue.enqueue(raw(1))
		await queue.tick()
		expect(tasks.cancelTask).toHaveBeenCalledTimes(1)
		invalidated.add(1)
		elapse(RETRY_DELAY_MS)
		await queue.tick()
		expect(calls).toHaveLength(1)

		// Scheduling time: already invalidated when the transient result lands — no retry, and the
		// failure write is fenced like any other.
		queue.enqueue(raw(1))
		await queue.tick()
		expect(calls).toHaveLength(2)
		expect(tasks.cancelTask).toHaveBeenCalledTimes(1)
		expect(tasks.failTask).toHaveBeenCalledTimes(1)
		elapse(RETRY_DELAY_MS)
		await queue.tick()
		expect(calls).toHaveLength(2)
	})
})
