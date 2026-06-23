import { type JobError, type JobProgress, JobCancelledSentinel, normalizeError } from "@nulo/wallet-core/jobs"

/**
 * Shared catch-arm disposition for the three dapp-send pipelines
 * (`executeSendTransaction` / `executeAztecSendTx` / `executeNoFromSendTx`): a
 * `JobCancelledSentinel` is rethrown as-is (the journal is ALREADY `cancelled` —
 * cancelJob did the transition + abort), and any other error marks the journal
 * `failed` before the caller rethrows it.
 *
 * Deliberately SYNCHRONOUS (not `async`): it throws the sentinel synchronously
 * and hands back `markJournal`'s own promise, so the call site's
 * `await markFailedUnlessCancelled(...); throw error` keeps the EXACT microtask
 * timing of the original inline `if (sentinel) throw; await markJournal; throw`.
 * An `async` wrapper would add one microtask before the `throw` on BOTH paths,
 * delaying each pipeline's `finally` (controller cleanup + slot release) by a
 * microtask — a real ordering change on the load-bearing cancel/slot-release
 * path. (codex post-impl 019ef365 caught this.) The co-located test pins the
 * synchronous-throw + promise-passthrough behavior so the `async` form can't
 * silently return.
 *
 * Scope: the dapp-send tail only (`lane.markJournal` + the `"dapp_execute"` error
 * context). `transfer-executor` deliberately does NOT use this — its catch
 * differs (RPC-cancel conversion via `maybeRethrowAsRpcCancel`, `task.fail`, and
 * a local `markJournal` closure over `transitionJournal` with a `"transfer"`
 * context).
 */
export function markFailedUnlessCancelled(
	error: unknown,
	journalId: string | undefined,
	lane: { markJournal(journalId: string | undefined, progress: JobProgress, error?: JobError | null): Promise<void> },
): Promise<void> {
	if (error instanceof JobCancelledSentinel) {
		throw error
	}
	return lane.markJournal(journalId, { stage: "failed" }, normalizeError(error, "dapp_execute"))
}
