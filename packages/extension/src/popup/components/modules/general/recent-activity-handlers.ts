/**
 * Pure handler builders for RecentActivityView (Phase 2 follow-up).
 *
 * The Vue component itself is hard to unit-test (4+ service clients to
 * stub, appStore, useTicker, useRouter, ...). Extracting the cancel +
 * retry wire to a tiny pure module gives us regression coverage on the
 * "emit → service call / navigation" link without mounting Vue.
 *
 * Both handlers close over a getter rather than the value directly:
 * Vue refs are captured at handler-build time and read at emit time,
 * so we test the same "read at click" semantics.
 */

import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import { ContentKind } from "@/wallet/services/task/spec"
import { TxStatus } from "@/wallet/services/transaction/spec"

/** Minimal chain-tx shape the pending-suppression filter needs. */
export interface MinimalChainTx {
	hash: string
	status: TxStatus
}

/**
 * Suppress pending chain txs that are already represented by an in-flight
 * journal awaiting card — but ONLY for the records that match by txHash.
 *
 * Bug pinned: a previous blanket filter hid T1's pending chain tx as soon
 * as T1's journal record transitioned to `succeeded`, while T2 was still
 * queued. T1 vanished from the feed (succeeded → returns null from the
 * terminal-card resolver, AND its chain tx was suppressed because T2
 * was in-flight). Came back only after T1's chain tx left `pending`.
 *
 * Per-hash scoping: only suppress chain txs whose hash matches an
 * in-flight journal record currently in `submitting` stage (the only
 * in-flight stage whose schema permits a `txHash`). Records in queued /
 * pending / simulating / proving stages don't have a chain tx yet — they
 * pull nothing from this filter.
 *
 * TODO(follow-up: dapp-interaction-lock-fix-v2):
 *   The runtime does not currently populate `submitting.txHash` — the four
 *   `markJournal({ stage: "submitting" })` call sites in `execution/service.ts`
 *   all transition bare and then jump straight to `succeeded({ txHash })`. So
 *   in production this helper's `inFlightHashes` set is always empty and the
 *   filter is effectively a no-op. The disappearing-card bug remains for the
 *   broader case — once T2 advances past `queued` into any in-flight stage,
 *   the blanket fallback in RecentActivityView's `executingTask` branch
 *   kicks in and hides T1's pending chain tx again. The QA-validated path
 *   (T1 terminals while T2 is still queued) IS covered today; this is the
 *   narrow window the unit tests below pin against the eventual contract.
 *   Resolution requires: (a) setting `txHash` at the `submitting` transition
 *   in all four execution paths, and (b) dropping the `executingTask` blanket
 *   fallback in favor of journal-record-first matching.
 */
export function filterPendingDoubleRender(
	txs: ReadonlyArray<MinimalChainTx>,
	inFlightJournalOps: ReadonlyArray<OperationRecord>,
): MinimalChainTx[] {
	const inFlightHashes = new Set<string>()
	for (const op of inFlightJournalOps) {
		const stage = op.progress
		if (stage.stage === "submitting" && stage.txHash) inFlightHashes.add(stage.txHash)
	}
	return txs.filter((t) => t.status !== TxStatus.Pending || !inFlightHashes.has(t.hash))
}

export interface CancelExecutor {
	cancelJob(jobId: string): Promise<void>
}

/**
 * Match an executingTask against a journal record for the cancel-dupe fix.
 * Returns true iff the task likely refers to the same operation.
 *
 * KNOWN LIMITATION (codex audit Nice): matches by kind + tokenId for
 * transfers, kind alone for dapp_execute. For concurrent same-account
 * dApp ops (rare — dApp approval windows serialize at the user level),
 * a terminal event on op A could false-clear executingTask when it's
 * currently B. Consequence: brief flicker before TaskService re-syncs.
 *
 * If concurrency-driven flicker shows up in QA, strengthen by plumbing
 * a journalId onto task content for strict identity match.
 */
// biome-ignore lint/suspicious/noExplicitAny: TaskService spec is JS; importing the concrete TaskRecord type would create a circular Vue/TS dep here.
export function isMatchingTask(task: any, op: OperationRecord, activeAccount: string | undefined): boolean {
	if (!task || !op) return false
	if (op.accountAddress !== activeAccount) return false
	if (op.kind === "transfer") {
		return task.content?.kind === ContentKind.Transfer && task.content?.tokenId === op.tokenId
	}
	if (op.kind === "dapp_execute") {
		return task.content?.kind === ContentKind.ExecuteOperation
	}
	return false
}

/**
 * Build a cancel handler. Wired to `<TransactionAwaitingCard @cancel="...">`,
 * which now emits the card's `jobId` as a payload so multi-card render
 * (concurrent in-flight ops) cancels the correct journal record.
 *
 * - Falsy / unknown `jobId` → no-op (defensive; the button is only rendered
 *   for non-null `jobId` so this should not fire in production).
 * - Otherwise → invoke optional `onInitiated(jobId)` for cancel-dupe tracking,
 *   then call `cancelJob`; swallow rejection silently. The button is already
 *   hidden at `submitting` stage, so a rejected cancel here is a tight race
 *   we can't avoid; silent unwind is acceptable.
 *
 * `onInitiated` lets the caller pin the jobId for direct ID correlation in
 * the journal event handler — bulletproof against `isMatchingTask` fragility
 * (see RecentActivityView's `pendingCancelJobIds`).
 */
export function buildCancelHandler(
	execution: CancelExecutor,
	onInitiated?: (jobId: string) => void,
): (jobId: string | null | undefined) => void {
	return (jobId) => {
		if (!jobId) return
		onInitiated?.(jobId)
		execution.cancelJob(jobId).catch(() => {})
	}
}
