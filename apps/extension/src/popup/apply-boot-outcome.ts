/**
 * What the shell does with a finished boot run. Pure over a small shell interface so the
 * bookkeeping every outcome shares — the retrying presentation ends, the session counts as
 * checked — is pinned for the outcomes that apply nothing else. An `event-superseded` run in
 * particular must still settle those flags: the event path that superseded it routes the shell but
 * never touches them, and a retried boot left `retrying` would keep the auth form withheld with
 * RETRY disabled until the next reconnect.
 */

import type { BootSessionResult } from "./boot-session"
import type { LockedBootOutcome } from "./reconcile-locked-boot"

export interface BootOutcomeShell<P extends { id: string }> {
	setRetrying: (retrying: boolean) => void
	setProfiles: (profiles: P[]) => void
	markChecked: () => void
	/** The service stayed unreachable, or an open session's bootstrap threw. */
	settleUndecided: (outcome: "unreachable" | "failed", candidate: P | undefined) => void
	logFailed: (profileId: string) => void
	/** An open session survived (or not) its bootstrap. */
	advance: (stillActive: boolean) => void
}

export function applyBootOutcome<P extends { id: string }>(
	outcome: LockedBootOutcome<BootSessionResult<P>>,
	shell: BootOutcomeShell<P>,
): void {
	if (outcome.kind === "superseded") return
	// A decision — of any kind — ends the retrying presentation; a newer run owns the next one.
	shell.setRetrying(false)
	if (outcome.kind === "event-superseded") {
		// The lookup completed, so the session was checked; the event path owns everything else,
		// and this run's list and candidate are stale.
		shell.markChecked()
		return
	}
	shell.setProfiles(outcome.profiles)
	if (outcome.kind === "unreachable") {
		shell.settleUndecided("unreachable", outcome.candidate)
		return
	}
	if (outcome.kind === "failed") {
		shell.logFailed(outcome.profile.id)
		shell.settleUndecided("failed", undefined)
		return
	}
	// The reconcile already acted on a lock, under its fences.
	if (outcome.kind === "locked") return
	shell.markChecked()
	shell.advance(outcome.stillActive)
}
