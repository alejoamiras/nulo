/**
 * Background work scheduling for `TokenBalanceService`. Wraps:
 * - `Queue<number, TokenBalanceRaw>` (dedup by id via `priorityPass`)
 * - `pendingTasks: Map<number, string>` (per-id → TaskService id)
 * - `BackgroundTickerPort` subscription
 * - Projection + storage-write fan-out
 *
 * Two dedup layers:
 * - `Queue.priorityPass(balance)` prevents double-sync of an already-
 *   queued balance (keyed by `x => x.id`).
 * - `pendingTasks` per-id map prevents double-creation of a TaskService
 *   record when a balance is enqueued from multiple triggers in quick
 *   succession.
 *
 * Tick semantics — preserved verbatim from the previous `startWorker`
 * loop:
 * - On each tick: if the queue is non-empty, drain it UNTIL EMPTY,
 *   batching into up-to-12 items grouped by the first-queued account,
 *   calling the projector for each batch.
 * - Not "one batch per tick."
 * - If any async work in the tick throws, the error is logged and the
 *   tick ends (the port's error-containment contract keeps future
 *   ticks firing).
 */

import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@/wallet/logger"
import type { BackgroundTickerPort, TickerHandle } from "@nulo/wallet-core/ports"
import { Queue } from "@nulo/wallet-core/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { BalanceUpdateContent, type TaskService } from "@/wallet/services/task/service"
import type { BalanceProjector } from "./balance-projector"
import type { BalanceRepository } from "./balance-repository"
import type { TokenBalanceRaw } from "./spec"

const TICK_INTERVAL_MS = 1000
const BATCH_SIZE = 12
/** Failure messages persist onto the row — bound them (hostile RPC text). */
const MAX_FAILURE_MESSAGE_LENGTH = 200

function boundedFailureMessage(message: string): string {
	return message.length <= MAX_FAILURE_MESSAGE_LENGTH ? message : `${message.slice(0, MAX_FAILURE_MESSAGE_LENGTH - 1)}…`
}

export type BalanceJobQueueCallbacks = {
	/** Called after a successful projection writes a balance to storage. */
	onBalanceUpdated: (balance: TokenBalanceRaw) => void
	/** Called when a balance is projected but its storage record has
	 *  been deleted mid-sync (mirrors service.ts:395-401). */
	onOrphanDetected?: (balance: TokenBalanceRaw) => void
}

export class BalanceJobQueue {
	private readonly queue = new Queue<number, TokenBalanceRaw>((x) => x.id)
	private readonly pendingTasks = new Map<number, string>()
	private tickerHandle?: TickerHandle

	public constructor(
		private readonly ticker: BackgroundTickerPort,
		private readonly repo: BalanceRepository,
		private readonly projector: BalanceProjector,
		private readonly tasks: TaskService,
		private readonly callbacks: BalanceJobQueueCallbacks,
		private readonly logger?: ILogger,
		private readonly logSource: string = "balance-job-queue",
	) {}

	/** Subscribe to the ticker. First tick fires after `intervalMs`,
	 *  not immediately (see port contract). */
	public start(): void {
		if (this.tickerHandle) return
		this.tickerHandle = this.ticker.subscribe(TICK_INTERVAL_MS, () => this.tick())
	}

	/** Cancel the ticker subscription. Any in-flight tick completes;
	 *  any coalesced pending tick is dropped. */
	public stop(): void {
		this.tickerHandle?.cancel()
		this.tickerHandle = undefined
	}

	/** Enqueue a balance for refresh. Creates a TaskService record if
	 *  no pending one exists for this id. Dedups via `priorityPass`. */
	public enqueue(balance: TokenBalanceRaw): void {
		if (!this.pendingTasks.has(balance.id)) {
			const task = this.tasks.createNewTask(new BalanceUpdateContent(balance.id, balance.account))
			this.pendingTasks.set(balance.id, task.id)
		}
		this.queue.priorityPass(balance)
	}

	/** Whether a task is already pending/processing for this balance id (i.e. an `enqueue` would
	 *  COALESCE rather than mint a fresh task). Used by the causal balance-refresh ack (D4). */
	public hasPendingTask(id: number): boolean {
		return this.pendingTasks.has(id)
	}

	/** The current TaskService id anchored to this balance id, or `undefined` if none is pending. */
	public getPendingTaskId(id: number): string | undefined {
		return this.pendingTasks.get(id)
	}

	/** Run a single tick: drain the queue until empty, batching by the
	 *  first-queued account's chain, max 12 per batch. Public for tests
	 *  (the production adapter invokes it via the ticker subscription). */
	public async tick(): Promise<void> {
		if (this.queue.length === 0) return
		this.logger?.log(this.logSource, LogLevel.Debug, `Syncing ${this.queue.length} token balances`)
		const start = Date.now()
		try {
			while (this.queue.length) {
				const firstAccount = this.queue.peek()!.account
				const batch: TokenBalanceRaw[] = []
				while (this.queue.peek()?.account === firstAccount && batch.length < BATCH_SIZE) {
					batch.push(this.queue.dequeue()!)
				}
				await this.syncBatch(batch)
			}
		} catch (err) {
			this.logger?.log(this.logSource, LogLevel.Error, `Failed to sync token balances: ${getErrorMessage(err)}`)
		}
		const end = Date.now()
		this.logger?.log(this.logSource, LogLevel.Debug, `Token balances synced in ${end - start}ms`)
	}

	/** Persist a failure record onto the LIVE row (re-read, never the batch's
	 *  possibly-stale copy — a deleted row must stay deleted) and emit the
	 *  updated row so every listener re-renders the failed state. */
	private async writeSyncFailure(id: number, message: string, at: number): Promise<void> {
		const current = await this.repo.get(id)
		if (!current) return
		const updated: TokenBalanceRaw = {
			...current,
			syncFailure: { at, message: boundedFailureMessage(message) },
		}
		await this.repo.set(updated)
		this.callbacks.onBalanceUpdated(updated)
	}

	private async syncBatch(batch: TokenBalanceRaw[]): Promise<void> {
		// Start each balance's task record. Handles both the
		// already-registered case (from `enqueue`) and the defensive
		// create-missing case (mirrors service.ts:262-267).
		for (const tb of batch) {
			const taskId = this.pendingTasks.get(tb.id)
			if (!taskId) {
				const task = this.tasks.startNewTask(new BalanceUpdateContent(tb.id, tb.account))
				this.pendingTasks.set(tb.id, task.id)
			} else {
				this.tasks.startTask(taskId)
			}
		}

		try {
			const results = await this.projector.project(batch)
			const now = Date.now()

			for (const result of results) {
				const taskId = this.pendingTasks.get(result.id)
				if (!taskId) continue

				if (result.kind === "error") {
					this.tasks.failTask(taskId, result.error)
					// Persist the failure onto the row (balances + updatedAt
					// untouched — the last-known value keeps rendering). Without
					// this write, "failed" and "still running" are identical in
					// storage once the in-memory task record dies with the SW.
					await this.writeSyncFailure(result.id, result.error, now)
					continue
				}

				// Existence-check mirrors service.ts:392-401 — if the balance
				// record was deleted mid-sync, surface a task failure.
				const current = await this.repo.get(result.id)
				if (!current) {
					this.tasks.failTask(taskId, "Balance record not found")
					this.callbacks.onOrphanDetected?.(batch.find((b) => b.id === result.id)!)
					continue
				}

				const updated: TokenBalanceRaw = {
					...current,
					privateBalance: result.privateBalance,
					publicBalance: result.publicBalance,
					updatedAt: now,
					// A successful projection clears the failure record
					// (JSON-serialization drops the undefined key).
					syncFailure: undefined,
				}
				await this.repo.set(updated)
				this.tasks.completeTask(taskId)
				this.callbacks.onBalanceUpdated(updated)
			}
		} catch (err) {
			// Projector-level failure that survived its own catch. Every
			// balance in the batch fails. Mirrors the outer catch at
			// service.ts:406-415.
			const errorMessage = getErrorMessage(err)
			for (const tb of batch) {
				const taskId = this.pendingTasks.get(tb.id)
				if (!taskId) continue
				const task = this.tasks.getTaskSync(taskId)
				if (!task.finishedAt) {
					this.tasks.failTask(taskId, errorMessage)
					await this.writeSyncFailure(tb.id, errorMessage, Date.now())
				}
			}
		} finally {
			for (const tb of batch) {
				this.pendingTasks.delete(tb.id)
			}
		}
	}
}
