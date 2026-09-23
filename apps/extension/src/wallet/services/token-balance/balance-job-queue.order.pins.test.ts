/**
 * Pre-extraction pin (codex seam condition, round-2 plan 4): a successful
 * projection lands in the frozen order `repo.set → tasks.completeTask →
 * onBalanceUpdated`, and the emit is gated by a post-write `isRowEmittable`
 * re-check that reads the row AFTER the awaited write. A refactor that
 * reordered the write and the task completion, or emitted before the write
 * settled, changes what a crash between the steps leaves behind.
 */
import { describe, expect, test, vi } from "vitest"
import { FakeBackgroundTicker } from "@nulo/wallet-core/testing"
import type { TaskService } from "@/wallet/services/task/service"
import { BalanceJobQueue } from "./balance-job-queue"
import type { BalanceProjector } from "./balance-projector"
import type { BalanceRepository } from "./balance-repository"
import type { TokenBalanceRaw } from "./spec"

const raw = (id: number): TokenBalanceRaw => ({
	id,
	token: 1,
	account: "0xA",
	profileId: "p1",
	chainId: 1,
	contract: "0xc1",
	privateBalance: "0",
	publicBalance: "0",
	updatedAt: 0,
})

function makeHarness() {
	const log: string[] = []
	const store = new Map<number, TokenBalanceRaw>([[1, raw(1)]])
	const repo = {
		get: async (id: number) => store.get(id),
		getAll: async () => Array.from(store.values()),
		set: async (b: TokenBalanceRaw) => {
			log.push("repo.set")
			store.set(b.id, b)
		},
		delete: async () => {},
		allocateId: async () => 2,
	} as unknown as BalanceRepository
	let nextId = 1
	const tasks = {
		createNewTask: vi.fn(() => ({ id: `task-${nextId++}` })),
		startNewTask: vi.fn(() => ({ id: `task-${nextId++}` })),
		startTask: vi.fn(),
		completeTask: vi.fn(() => {
			log.push("completeTask")
		}),
		failTask: vi.fn(() => {
			log.push("failTask")
		}),
		getTaskSync: vi.fn(() => ({ finishedAt: undefined })),
		hasTask: vi.fn(() => true),
		cancelTask: vi.fn(),
	} as unknown as TaskService
	const projector = {
		project: async (balances: TokenBalanceRaw[]) =>
			balances.map((b) => ({ kind: "ok" as const, id: b.id, privateBalance: "7", publicBalance: "9" })),
	} as unknown as BalanceProjector
	return { log, store, repo, tasks, projector }
}

describe("BalanceJobQueue — success commit order", () => {
	test("repo.set → completeTask → onBalanceUpdated, with the emit reading the row post-write", async () => {
		const h = makeHarness()
		const emittable: string[] = []
		const queue = new BalanceJobQueue(new FakeBackgroundTicker(), h.repo, h.projector, h.tasks, {
			getGeneration: () => 0,
			onBalanceUpdated: (b) => {
				h.log.push("emit")
				emittable.push(`${b.privateBalance}/${b.publicBalance}`)
			},
			isRowEmittable: () => {
				h.log.push("isRowEmittable")
				return true
			},
		})
		queue.enqueue(raw(1))
		await queue.tick()
		// Pre-write ownership check, the write, task completion, the post-write
		// re-check, then the emit — nothing emits before the row is durable.
		expect(h.log).toEqual(["isRowEmittable", "repo.set", "completeTask", "isRowEmittable", "emit"])
		expect(emittable).toEqual(["7/9"])
		expect(h.store.get(1)?.privateBalance).toBe("7")
	})

	test("a row that stops being emittable DURING the write is completed but NOT emitted", async () => {
		const h = makeHarness()
		let checks = 0
		const onBalanceUpdated = vi.fn()
		const queue = new BalanceJobQueue(new FakeBackgroundTicker(), h.repo, h.projector, h.tasks, {
			getGeneration: () => 0,
			onBalanceUpdated,
			// First check (pre-write) passes; the post-write re-check sees the token gone.
			isRowEmittable: () => ++checks === 1,
		})
		queue.enqueue(raw(1))
		await queue.tick()
		expect(h.log).toEqual(["repo.set", "completeTask"])
		expect(onBalanceUpdated).not.toHaveBeenCalled()
	})
})
