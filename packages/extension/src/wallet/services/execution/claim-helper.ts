/**
 * Standalone helper for claiming a pre-allocated queued journal record vs
 * creating a fresh one. Extracted from `ExecutionService` for unit-testability —
 * the original method had too many `this.*` dependencies to test in isolation.
 *
 * Decision tree (proven correct via codex rounds 3-5):
 *
 *   - no `queuedJournalId`                     → create new (legacy path)
 *   - `journal.getOperation(id)` returns null   → create new (reaper deleted it)
 *   - record stage === "queued"                  → claim (queued → pending).
 *                                                  Controller registered
 *                                                  IMMEDIATELY after the stage
 *                                                  write — no await between
 *                                                  transition and `set()`.
 *   - record stage IS NOT "queued"               → throw `JobCancelledSentinel`.
 *                                                  Reuses the existing
 *                                                  cancelled-pipeline that
 *                                                  surfaces as EIP-1193 4001.
 *
 * Journal-storage failures (write error inside `transitionOperation`) RE-THROW
 * the original error so the caller's `executeOperations` classifies as a
 * failed operation, NOT as cancelled (codex R5).
 *
 * The journal-layer mutex on `transitionOperation` serializes claim against
 * `cancelJob`. If cancel wins the mutex first, our claim fails — we re-read
 * to disambiguate cancellation from storage error and throw the appropriate
 * sentinel.
 */

import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import type { LocalTxOrigin } from "@/wallet/services/transaction/spec"
import type { OperationJournalService } from "@/wallet/services/operation-journal/service"

export interface ClaimHelperDeps {
	operationJournal: OperationJournalService
	/** Map shared with `ExecutionService.activeControllers`. The helper sets
	 *  the controller into this map before returning so `cancelJob(id)` can
	 *  find it. */
	activeControllers: Map<string, AbortController>
	/** Plain factory that creates a fresh in-flight dapp_execute record (the
	 *  pre-existing `beginDappExecuteJournal` behaviour). Used for the
	 *  "no queuedJournalId" and "record reaped" fallback paths. */
	createFreshRecord: (
		networkId: string,
		accountAddress: string,
		origin: LocalTxOrigin,
		calls?: { method?: string }[],
	) => Promise<string | undefined>
	logger?: {
		debug: (msg: string) => void
		info: (msg: string) => void
		error: (msg: string, raw?: unknown) => void
	}
}

export interface ClaimHelperInput {
	networkId: string
	accountAddress: string
	origin: LocalTxOrigin
	calls?: { method?: string }[]
	queuedJournalId?: string
}

export interface ClaimHelperResult {
	journalId: string | undefined
	controller: AbortController | undefined
}

export async function claimOrCreateDappExecuteJournal(deps: ClaimHelperDeps, input: ClaimHelperInput): Promise<ClaimHelperResult> {
	const { operationJournal, activeControllers, createFreshRecord, logger } = deps
	const { networkId, accountAddress, origin, calls, queuedJournalId } = input

	if (!queuedJournalId) {
		const id = await createFreshRecord(networkId, accountAddress, origin, calls)
		const controller = id ? new AbortController() : undefined
		if (id && controller) activeControllers.set(id, controller)
		return { journalId: id, controller }
	}

	const record = await operationJournal.getOperation(queuedJournalId).catch(() => null)
	if (!record) {
		// Record was reaped (boot sweep or staleness GC). Best-effort
		// fallback — create new in-flight record so execution proceeds.
		logger?.debug(`Queued record ${queuedJournalId} not found; creating new in-flight record`)
		const id = await createFreshRecord(networkId, accountAddress, origin, calls)
		const controller = id ? new AbortController() : undefined
		if (id && controller) activeControllers.set(id, controller)
		return { journalId: id, controller }
	}
	// Accept queued OR pending. Queued is the normal claim path; pending
	// is what the silent-path optimization (in DappInteractionService.execute)
	// fast-forwards to so the UI doesn't briefly show "Queued..." for a
	// sendTx that never opens a popup. In the pending case we skip the
	// transitionOperation call (already-advanced) and just register the
	// controller. Any other stage (cancelled / failed / succeeded /
	// simulating / proving / submitting) is a hard "don't execute" signal.
	const stage = record.progress?.stage
	if (stage !== "queued" && stage !== "pending") {
		// Cancelled / failed before claim (most likely: cancelJob raced
		// our claim and won the journal-layer mutex). Surface via the
		// existing cancelled pipeline; the dApp sees EIP-1193 4001.
		logger?.info(`Queued record ${queuedJournalId} is ${stage}; aborting via JobCancelledSentinel`)
		throw new JobCancelledSentinel(queuedJournalId)
	}

	// Happy path: claim. The journal mutex serializes us against any
	// concurrent cancelJob — whichever acquires first wins.
	if (stage === "queued") {
		try {
			await operationJournal.transitionOperation(queuedJournalId, { stage: "pending" })
		} catch (error) {
			// Transition failed. Re-read to disambiguate cancellation race
			// (cancelJob won the mutex) from a genuine storage failure.
			const recheck = await operationJournal.getOperation(queuedJournalId).catch(() => null)
			if (recheck && recheck.progress?.stage !== "queued") {
				logger?.info(`Queued record ${queuedJournalId} was ${recheck.progress?.stage}'d during claim; cancelled-path`)
				throw new JobCancelledSentinel(queuedJournalId)
			}
			// Genuine journal-storage failure — preserve observability by
			// re-throwing instead of masking as cancellation.
			throw error
		}
	} else {
		// stage === "pending" — silent-path pre-transitioned. Skip the
		// transitionOperation call; just register the controller and return.
		logger?.debug(`Queued record ${queuedJournalId} already at pending (silent-path pre-claim); registering controller only`)
	}

	// Register the controller IMMEDIATELY — no await between the stage
	// write and this set(). cancelJob() reads activeControllers to find
	// a controller to abort; if it lands during this microtask window,
	// it would find no controller. The next sync line closes the gap.
	//
	// The OTHER side of this invariant lives in cancelJob → transitionOperation
	// → `_transitionLocked` (operation-journal/service.ts). That path has
	// its own awaits BEFORE it calls `controller.abort()`, which yields
	// the microtask back to us so we get a chance to set the controller
	// before any cancel-side abort lands. This is correctness-by-microtask-
	// interleaving and is fragile against future refactors of either side
	// (opus post-impl F5).
	const controller = new AbortController()
	activeControllers.set(queuedJournalId, controller)
	return { journalId: queuedJournalId, controller }
}
