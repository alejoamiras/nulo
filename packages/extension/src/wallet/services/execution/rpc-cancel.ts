/**
 * Cancel-conversion at the SW RPC boundary.
 *
 * Used by every service catch block that may receive a `JobCancelledSentinel`
 * (the internal control-flow exception thrown when an in-flight prove pipeline
 * trips its AbortSignal checkpoint) and needs to:
 *
 *   1. Mark its task as `.cancel()` (not `.fail()`) so the task service's
 *      terminal state matches the journal's terminal state.
 *   2. Convert the sentinel into the structured `JobCancelledError`
 *      (extension-messaging) so the popup-side `instanceof` check survives
 *      the chrome.runtime port RPC.
 *
 * Callers do:
 *
 * ```ts
 * } catch (error) {
 *   maybeRethrowAsRpcCancel(error, task)  // throws JobCancelledError or returns
 *   // ... normal failure-marking path
 * }
 * ```
 *
 * The function either throws (cancellation) or returns (let caller handle the
 * non-cancel branch). The `void` return type is intentional — TypeScript can
 * narrow `error` to "not JobCancelledSentinel" after the call only if the
 * caller re-reads error or asserts.
 *
 * COVERAGE NOTE: this helper is unit-tested in isolation; the catch sites that
 * call it (`executeTransfer`, `revokeAuthwits`, `setRegistryEnabled`) are not
 * directly pinned with service-level integration tests (mocking surface for
 * `ExecutionService` is non-trivial). The dApp cancel-mid-prove e2e covers
 * the `executeOperations` aggregator path end-to-end. If you refactor a
 * catch site, preserve the call — silently dropping it brings back the
 * wrong-toast UX bug.
 */

import { JobCancelledError } from "@nulo/extension-messaging/errors"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"

/** Minimal task surface needed for the cancel conversion. Avoids importing
 *  the full WrappedTask type into wallet-core's layer. */
export interface CancellableTask {
	cancel(): void
	fail(error: unknown): void
}

export function maybeRethrowAsRpcCancel(error: unknown, task: Pick<CancellableTask, "cancel">): void {
	if (!(error instanceof JobCancelledSentinel)) return
	task.cancel()
	throw new JobCancelledError(undefined, { jobId: error.jobId })
}

/**
 * Aggregator-side branching for `executeOperations`. Maps the catch to an
 * `OperationResult` variant and calls the appropriate task lifecycle method.
 *
 * `cancelled` → `task.cancel()`. `failed` → `task.fail(error)`. Symmetry
 * between task state and operation-result state is load-bearing — codex's
 * v2 audit caught that mismatched (failed task + cancelled result, or
 * cancelled task + failed result) leaves the UX inconsistent.
 *
 * Returns the OperationResult variant for the caller to push into its
 * results array. The caller still owns logging.
 */
export type CancelOrFailResult = { status: "cancelled"; jobId?: string; reason: "user" } | { status: "failed"; error: string }

export function classifyOperationCatch(error: unknown, task: CancellableTask, errorMessage: (e: unknown) => string): CancelOrFailResult {
	if (error instanceof JobCancelledSentinel) {
		task.cancel()
		return { status: "cancelled", jobId: error.jobId, reason: "user" }
	}
	task.fail(error)
	return { status: "failed", error: errorMessage(error) }
}
