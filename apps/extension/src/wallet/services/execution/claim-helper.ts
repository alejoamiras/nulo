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
	/** The profile execution resolved. Compared against the queued row's, so a
	 *  row filed under another profile is never reused. */
	profileId?: string
	origin: LocalTxOrigin
	calls?: { method?: string }[]
	queuedJournalId?: string
	/** A controller pre-registered (under `queuedJournalId`) BEFORE the
	 *  ExecutionMutex acquire, so a user-cancel can abort the acquire wait. On
	 *  the normal claim path the helper REUSES it (the claimed id ===
	 *  `queuedJournalId`), so `activeControllers[id]` already holds the right
	 *  controller throughout — strictly safer for the cancel-vs-claim race than
	 *  creating one only after the transition. On the create-fresh fallback
	 *  (record reaped → a NEW id) the helper deletes the now-orphaned
	 *  `queuedJournalId` entry so it doesn't leak. */
	reuseController?: AbortController
}

export interface ClaimHelperResult {
	journalId: string | undefined
	controller: AbortController | undefined
}

export async function claimOrCreateDappExecuteJournal(deps: ClaimHelperDeps, input: ClaimHelperInput): Promise<ClaimHelperResult> {
	const { operationJournal, activeControllers, createFreshRecord, logger } = deps
	const { networkId, accountAddress, origin, calls, queuedJournalId, reuseController } = input

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
		// A pre-acquire controller registered under the now-gone queuedJournalId
		// is orphaned; drop it so `activeControllers` doesn't leak (v3 — codex
		// final-pass edge). cancelJob(queuedJournalId) couldn't have fired (the
		// record is gone, so its journal transition would have thrown), so the
		// orphan never aborted.
		if (reuseController) activeControllers.delete(queuedJournalId)
		logger?.debug(`Queued record ${queuedJournalId} not found; creating new in-flight record`)
		const id = await createFreshRecord(networkId, accountAddress, origin, calls)
		const controller = id ? new AbortController() : undefined
		if (id && controller) activeControllers.set(id, controller)
		return { journalId: id, controller }
	}
	// The queued row was filed when the message ARRIVED, from the session and the
	// accounts as they were then. Execution resolves its own account and network,
	// and the two can disagree — a hidden/visible ordering difference, or the user
	// changing scope in between. Reusing a row whose scope does not match would
	// file the operation under one account while sending from another, and put its
	// cancel card somewhere the user is not looking.
	const scopeMatches =
		record.networkId === networkId &&
		record.accountAddress === accountAddress &&
		(record.profileId === undefined || input.profileId === undefined || record.profileId === input.profileId)
	if (!scopeMatches) {
		// A cancel that already landed on the old row must not be undone by
		// re-filing: it moved the record to a terminal stage and aborted its
		// controller, and creating a fresh un-aborted one would let the execution
		// continue after the user stopped it.
		const stageBeforeRefile = record.progress?.stage
		if (stageBeforeRefile !== "queued" && stageBeforeRefile !== "pending") {
			logger?.info(`Queued record ${queuedJournalId} is ${stageBeforeRefile}; not re-filing`)
			throw new JobCancelledSentinel(queuedJournalId)
		}
		if (reuseController?.signal.aborted) {
			logger?.info(`Queued record ${queuedJournalId} was aborted before re-file; honoring the cancel`)
			throw new JobCancelledSentinel(queuedJournalId)
		}

		logger?.info(
			`Queued record ${queuedJournalId} was filed under ${record.accountAddress}/${record.networkId} but execution resolved ` +
				`${accountAddress}/${networkId}; re-filing under the executing scope`,
		)
		// Delete rather than fail it: this operation never ran under the old scope,
		// so a failed card there would be activity that did not happen. The delete
		// must SUCCEED before a replacement exists, or both rows would be live at
		// once — one of them cancellable and neither matching what runs.
		await operationJournal.deleteOperation(queuedJournalId)
		if (reuseController) activeControllers.delete(queuedJournalId)
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
	// When a `reuseController` was pre-registered (under queuedJournalId,
	// before the ExecutionMutex acquire), reuse it. Because queuedJournalId ===
	// this claimed id, the controller has been in `activeControllers` since
	// before the acquire wait — so cancelJob always finds it, which is strictly
	// safer than the original "register only after the transition" timing. The
	// `set` is idempotent in that case (same key, same value).
	//
	// The OTHER side of this handshake is cancelJob → transitionOperation →
	// `_transitionLocked` (operation-journal/service.ts): it transitions the
	// journal record BEFORE calling `controller.abort()`, and the journal's
	// transition lock is the arbiter that serializes claim-vs-cancel. Combined
	// with `reuseController` being registered before the acquire wait (above),
	// cancelJob always finds a controller to abort on this claim path —
	// correctness rests on controller-identity-continuity + transition-before-
	// abort + the journal lock, NOT on microtask luck. The one microtask-
	// sensitive residual is the LEGACY no-reuse / reaped-record fallback, where a
	// freshly-created controller is `set()` immediately after the create await
	// (the same register-immediately discipline, applied at those create sites);
	// the queued/pending `set()` below is the one the no-await line above covers.
	// Making the handshake explicit via a small claim/cancel
	// coordinator seam was evaluated (codex) and deferred to the execution
	// composition harness in #125/#126 for human review; see
	// implementations-plan/quality-arc-deferred/lessons/q23.md.
	const controller = reuseController ?? new AbortController()
	activeControllers.set(queuedJournalId, controller)
	return { journalId: queuedJournalId, controller }
}
