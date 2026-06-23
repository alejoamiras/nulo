import { type JobError, type JobProgress, JobCancelledSentinel, normalizeError } from "@nulo/wallet-core/jobs"

/**
 * Shared catch-arm disposition for the three dapp-send pipelines
 * (`executeSendTransaction` / `executeAztecSendTx` / `executeNoFromSendTx`): on a
 * `JobCancelledSentinel` the journal is ALREADY `cancelled` (cancelJob did the
 * transition + abort), so leave it untouched; on any other error mark the
 * journal `failed`. Returns the original error so the caller rethrows it
 * verbatim — keeping the `throw` at the call site means each pipeline's
 * `catch`/`finally` shape (and its controller-cleanup + slot-release ordering)
 * is unchanged. This is the catch arm ONLY; the acquireSlot/journal/finally
 * ordering stays inline because it is a load-bearing concurrency invariant.
 *
 * Scope: the dapp-send tail only (`lane.markJournal` + the `"dapp_execute"` error
 * context). `transfer-executor` deliberately does NOT use this — its catch
 * differs (RPC-cancel conversion via `maybeRethrowAsRpcCancel`, `task.fail`, and
 * a local `markJournal` closure over `transitionJournal` with a `"transfer"`
 * context).
 */
export async function markFailedUnlessCancelled(
	error: unknown,
	journalId: string | undefined,
	lane: { markJournal(journalId: string | undefined, progress: JobProgress, error?: JobError | null): Promise<void> },
): Promise<unknown> {
	if (!(error instanceof JobCancelledSentinel)) {
		await lane.markJournal(journalId, { stage: "failed" }, normalizeError(error, "dapp_execute"))
	}
	return error
}
