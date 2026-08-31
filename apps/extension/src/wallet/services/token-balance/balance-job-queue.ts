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
import { boundSyncFailureMessage, type TokenBalanceRaw } from "./spec"

const TICK_INTERVAL_MS = 1000
const BATCH_SIZE = 12

export type BalanceJobQueueCallbacks = {
	/** Called after a successful projection writes a balance to storage. */
	onBalanceUpdated: (balance: TokenBalanceRaw) => void
	/** Called when a balance is projected but its storage record has
	 *  been deleted mid-sync (mirrors service.ts:395-401). */
	onOrphanDetected?: (balance: TokenBalanceRaw) => void
	/** Deletion fence (TOCTOU guard): checked SYNCHRONOUSLY immediately before
	 *  every storage write — a delete that began after the queue's re-read adds
	 *  the id here BEFORE its awaited `repo.delete`, so single-threaded dispatch
	 *  order makes write-after-delete resurrection impossible. */
	isBalanceInvalidated?: (id: number) => boolean
	/** Ownership guard for failure writes: a shared-address row from ANOTHER
	 *  profile, or a dead incarnation's row at a reused token id, can reach
	 *  this queue. Writing a failure record onto such a row — or emitting it
	 *  through a token lookup that throws — must be skipped, not attempted.
	 *  Receives the full row so the check is the row↔token identity, not a
	 *  bare id-presence probe. */
	isRowEmittable?: (row: TokenBalanceRaw) => boolean
	/** Profile generation, captured at syncBatch entry and re-read immediately
	 *  before every post-projection write. The projector resolves LIVE
	 *  active-profile handles mid-flight, so an A→B→A switch repopulates the
	 *  token map and disarms `isRowEmittable` while the in-flight result was
	 *  computed under the departed context. REQUIRED (not optional): an
	 *  omitted wiring would silently disable the fence while queue-level
	 *  tests stay green. */
	getGeneration: () => number
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

	/** Drop all queued work and pending-task pointers. Called on a profile switch:
	 *  the TaskService records these pointers reference are wiped with the profile,
	 *  so keeping them would (a) coalesce new-profile enqueues onto dead task ids
	 *  (enqueue gates fresh-mint on `!pendingTasks.has`) and (b) leave stale entries
	 *  an in-flight batch's identity-checked cleanup must tolerate.
	 *
	 *  Cancel the records we still own first: on LOCK (`profile === undefined`)
	 *  TaskService keeps its map, so dropping only our pointer would strand each
	 *  record as a phantom "in-progress" task until the SW restarts. A record whose
	 *  id TaskService no longer knows (a real profile switch cleared it) is skipped. */
	public reset(): void {
		try {
			for (const taskId of this.pendingTasks.values()) {
				if (!this.tasks.hasTask(taskId)) continue
				// A task can finish (complete/fail) between this check and the cancel,
				// or be cancelled concurrently — cancelTask then throws "already
				// finished". Tolerate it: the record is terminal either way.
				try {
					this.tasks.cancelTask(taskId)
				} catch {
					// Already finished / raced — nothing to cancel.
				}
			}
		} finally {
			// Always drop the pointers + queue, even if a cancel throws, so the
			// jam this reset exists to clear can never survive an error above.
			this.queue.clear()
			this.pendingTasks.clear()
		}
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
	private async writeSyncFailure(id: number, message: string, at: number, gen: number): Promise<void> {
		const current = await this.repo.get(id)
		if (!current) return
		// Foreign-profile rows (unknown token in the active map) get NO failure
		// record: the row isn't ours to annotate, and emitting it would throw
		// through the service's token lookup and abort the whole batch.
		if (this.callbacks.isRowEmittable?.(current) === false) return
		const updated: TokenBalanceRaw = {
			...current,
			syncFailure: { at, message: boundSyncFailureMessage(message) },
		}
		// Fence check with NO await between it and the write dispatch.
		if (this.callbacks.isBalanceInvalidated?.(id)) return
		// Generation fence: silent return, not failTask — this helper holds no
		// taskId; both callers have already failed the task before writing.
		if (gen !== this.callbacks.getGeneration()) return
		await this.repo.set(updated)
		// Re-check AFTER the awaited write: a token deleted during the await must
		// not be emitted — the service's token lookup would throw and the outer
		// batch catch would falsely fail every remaining healthy row.
		if (this.callbacks.isRowEmittable?.(current) === false) return
		this.callbacks.onBalanceUpdated(updated)
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 34) — refactor when touched, never raise
	private async syncBatch(batch: TokenBalanceRaw[]): Promise<void> {
		// Generation captured BEFORE any await: the projector resolves live
		// active-profile handles mid-flight, so an A→B→A switch during it
		// repopulates the token map (disarming isRowEmittable) while these
		// results were computed under the departed profile's context.
		const gen = this.callbacks.getGeneration()
		// The task id THIS batch owns per balance id — captured up front so a
		// concurrent queue reset (profile switch) that re-registers a newer task
		// for the same id can't cause us to complete/fail/delete the wrong record.
		const owned = new Map<number, string>()
		// Start each balance's task record. Handles both the
		// already-registered case (from `enqueue`) and the defensive
		// create-missing case (mirrors service.ts:262-267).
		for (const tb of batch) {
			const taskId = this.pendingTasks.get(tb.id)
			// A pre-registered id the TaskService no longer knows (its map was
			// cleared on a profile switch) is stale: mint a fresh record instead of
			// letting `startTask` throw "Invalid task id" OUTSIDE the try/finally
			// below — that escape drops the whole batch and strands the dead
			// `pendingTasks` entry, permanently jamming every future enqueue for
			// this id. A genuine not-pending invariant error still propagates.
			if (!taskId || !this.tasks.hasTask(taskId)) {
				const task = this.tasks.startNewTask(new BalanceUpdateContent(tb.id, tb.account))
				this.pendingTasks.set(tb.id, task.id)
				owned.set(tb.id, task.id)
			} else {
				this.tasks.startTask(taskId)
				owned.set(tb.id, taskId)
			}
		}

		try {
			const results = await this.projector.project(batch)
			const now = Date.now()

			for (const result of results) {
				const taskId = owned.get(result.id)
				if (!taskId) continue

				if (result.kind === "error") {
					this.tasks.failTask(taskId, result.error)
					// Persist the failure onto the row (balances + updatedAt
					// untouched — the last-known value keeps rendering). Without
					// this write, "failed" and "still running" are identical in
					// storage once the in-memory task record dies with the SW.
					await this.writeSyncFailure(result.id, result.error, now, gen)
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
				// Fence check with NO await between it and the write dispatch
				// (a delete interleaving since the re-read must win).
				if (this.callbacks.isBalanceInvalidated?.(result.id)) {
					this.tasks.failTask(taskId, "Balance record deleted mid-sync")
					continue
				}
				// A row that is no longer ours (token deleted mid-batch) gets no
				// write: its projection ran under a context that no longer holds.
				if (this.callbacks.isRowEmittable?.(current) === false) {
					this.tasks.failTask(taskId, "Token no longer active")
					continue
				}
				// Generation fence (A→B→A): the map-membership check above is
				// disarmed by a round-trip switch; the generation is not. No
				// await between this check and the write dispatch.
				if (gen !== this.callbacks.getGeneration()) {
					this.tasks.failTask(taskId, "Profile changed mid-sync")
					continue
				}
				await this.repo.set(updated)
				this.tasks.completeTask(taskId)
				// Re-check AFTER the awaited write — same batch-abort hazard as the
				// failure path's emit.
				if (this.callbacks.isRowEmittable?.(current) === false) continue
				this.callbacks.onBalanceUpdated(updated)
			}
		} catch (err) {
			// Projector-level failure that survived its own catch. Every
			// balance in the batch fails. Mirrors the outer catch at
			// service.ts:406-415.
			const errorMessage = getErrorMessage(err)
			for (const tb of batch) {
				const taskId = owned.get(tb.id)
				// A reset since batch-start may have cleared this batch's task record;
				// `getTaskSync` would throw and abort the remaining failure writes.
				if (!taskId || !this.tasks.hasTask(taskId)) continue
				const task = this.tasks.getTaskSync(taskId)
				if (!task.finishedAt) {
					this.tasks.failTask(taskId, errorMessage)
					await this.writeSyncFailure(tb.id, errorMessage, Date.now(), gen)
				}
			}
		} finally {
			for (const tb of batch) {
				// Identity-checked: only clear the pointer if it STILL points at the
				// task this batch owned. A reset that re-registered a newer task for
				// this id must keep its fresh pointer intact.
				if (this.pendingTasks.get(tb.id) === owned.get(tb.id)) {
					this.pendingTasks.delete(tb.id)
				}
			}
		}
	}
}
