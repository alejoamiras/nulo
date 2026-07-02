/**
 * Pure stage→subtitle mapping for in-flight `TransactionAwaitingCard` rendering.
 *
 * Extracted from `RecentActivityView.vue` so the switch is unit-testable in
 * isolation (the original `cardSubtitleFor` consumes Vue reactive state for
 * the executingTask subtask-label decoration; this helper handles only the
 * stage-level default that runs when no subtask label applies).
 *
 * Adding a new `JobStage` MUST update this switch — the
 * `card-subtitle.test.ts` pin enforces exhaustiveness at runtime.
 */
import type { JobStage } from "@nulo/wallet-core/jobs"

export function stageSubtitle(stage: JobStage | undefined): string {
	switch (stage) {
		case "queued":
			// Pre-handler state surfaced by the wallet-sdk session FIFO.
			// User sees "Queued..." while a previous sendTx is still being
			// approved + simulated + built ahead of this one.
			return "Queued..."
		case "pending":
			return "Preparing..."
		case "simulating":
			return "Simulating..."
		case "proving":
			return "Generating proof..."
		case "submitting":
			return "Submitting..."
		default:
			// Terminal stages (succeeded/failed/cancelled) shouldn't render the
			// in-flight card at all — the activity feed switches to terminal-
			// card surface. Defensive fallback.
			return "Processing..."
	}
}
