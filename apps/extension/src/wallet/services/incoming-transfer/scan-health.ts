/**
 * What one public-scan tick achieved for a contract.
 * - `progress`: a validated cursor advance was committed (forward, or a reconciliation step).
 * - `idle-at-tip`: a validated empty read up to the pinned checkpoint — nothing to do.
 * - `no-progress`: the tick ran but confirmed nothing (dropped page, no checkpoint hash).
 * - `failed`: the tick could not run or threw.
 * - `ineligible`: the token is never scanned (non-standard class); not a health signal.
 */
export type ScanOutcome = "progress" | "idle-at-tip" | "no-progress" | "failed" | "ineligible"

/** A run of consecutive unsuccessful ticks for one contract. `failingSince` is `null` when healthy. */
export interface ScanEpisode {
	failingSince: number | null
	failures: number
}

export const BACKOFF_BASE_MS = 30_000
export const BACKOFF_CAP_MS = 5 * 60_000
export const STALLED_MIN_FAILURES = 2
export const STALLED_AFTER_MS = 10 * 60_000

export function isScanSuccess(outcome: ScanOutcome): boolean {
	return outcome === "progress" || outcome === "idle-at-tip"
}

/** Whether the outcome opens or extends an episode. `ineligible` is neither success nor failure. */
export function isScanFailure(outcome: ScanOutcome): boolean {
	return outcome === "failed" || outcome === "no-progress"
}

/** Delay before the next attempt after `failures` consecutive failures: 30 s doubling, capped at 5 min. */
export function nextBackoffMs(failures: number): number {
	if (!Number.isSafeInteger(failures) || failures <= 0) return 0
	// The exponent is bounded before the shift so a hostile count cannot overflow into a small delay.
	const doublings = Math.min(failures - 1, 10)
	return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** doublings)
}

/** Stalled = failing repeatedly AND for long enough; one slow tick or a fresh unlock never qualifies. */
export function isStalled(episode: ScanEpisode, now: number): boolean {
	if (episode.failingSince === null) return false
	return episode.failures >= STALLED_MIN_FAILURES && now - episode.failingSince > STALLED_AFTER_MS
}
