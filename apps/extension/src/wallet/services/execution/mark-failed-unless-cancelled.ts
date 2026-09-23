import { type JobError, type JobErrorKind, type JobProgress, JobCancelledSentinel, normalizeError } from "@nulo/wallet-core/jobs"
import { DuplicateInitializationError, SessionEndedError } from "@nulo/extension-messaging/errors"

/**
 * Shared catch-arm disposition for the three dapp-send pipelines
 * (`executeSendTransaction` / `executeAztecSendTx` / `executeNoFromSendTx`): a
 * `JobCancelledSentinel` is rethrown as-is (the journal is ALREADY `cancelled` —
 * cancelJob did the transition + abort), and any other error marks the journal
 * `failed` before the caller rethrows it.
 *
 * Deliberately not `async`: an async wrapper adds a microtask before each pipeline's `finally`
 * (controller cleanup and slot release), reordering the cancel/slot-release path; the co-located
 * test pins the synchronous throw and the promise passthrough.
 *
 * Scope: the dapp-send tail only (`lane.markJournal` + the `"dapp_execute"` error
 * context). `transfer-executor` deliberately does NOT use this — its catch
 * differs (RPC-cancel conversion via `maybeRethrowAsRpcCancel`, `task.fail`, and
 * a local `markJournal` closure over `transitionJournal` with a `"transfer"`
 * context) — but it shares {@link failureKind}.
 */
export function markFailedUnlessCancelled(
	error: unknown,
	journalId: string | undefined,
	lane: { markJournal(journalId: string | undefined, progress: JobProgress, error?: JobError | null): Promise<void> },
): Promise<void> {
	if (error instanceof JobCancelledSentinel) {
		throw error
	}
	return lane.markJournal(journalId, { stage: "failed" }, normalizeError(error, failureKind(error, "dapp_execute")))
}

/** The journal kind of a send failure. Classified failures keep their own kind:
 *  retry policy and the activity card must tell "lost the first-tx race — wait
 *  for sync, retry" and "the wallet was locked" from a generic failure. */
export function failureKind(error: unknown, fallback: JobErrorKind): JobErrorKind {
	if (error instanceof DuplicateInitializationError) return "duplicate_initialization"
	if (error instanceof SessionEndedError) return "session_ended"
	return fallback
}
