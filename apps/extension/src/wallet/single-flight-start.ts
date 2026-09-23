/**
 * Failure-resetting single-flight memo for the runtime's `start()`.
 *
 * Contract:
 *   - Concurrent callers share ONE in-flight `doStart()` — a second call
 *     during boot awaits the same promise instead of resolving early
 *     (resolve-before-ready was how the price-alarm shim lost ticks).
 *   - A REJECTED boot re-throws to every waiter, and the memo resets only
 *     when `canRetryAfterFailure()` says the failure left no partial state
 *     behind — the next call then re-attempts the boot.
 *   - When retry is vetoed (the boot failed after side effects that are not
 *     re-entrant, e.g. service registrations — `ServiceCollection.add`
 *     throws on duplicates), the rejected memo is kept: every later call
 *     observes the SAME rejection instead of silently void-resolving, and
 *     the SW's own death-and-respawn (fresh module state) is the retry.
 */
export function createSingleFlightStart(doStart: () => Promise<void>, canRetryAfterFailure: () => boolean): () => Promise<void> {
	let memo: Promise<void> | null = null
	return () => {
		memo ??= doStart().catch((err) => {
			if (canRetryAfterFailure()) memo = null
			throw err
		})
		return memo
	}
}
