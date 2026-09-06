/**
 * Where a popup lands when the boot-time session check finds NO open session. Pure over a
 * snapshot of the shell's state so every branch — including the one only a service-worker
 * restart produces — is unit-testable without mounting the shell.
 *
 * The restart case: a popup that was authenticated keeps its Pinia state (a selected profile,
 * an auth-required page rendered) while the replacement worker holds no session. Keying the
 * decision on the ROUTE rather than the logged-in flag matters — the header flips that flag
 * before the worker answers a Lock click, so a flag-keyed decision would leave such a popup
 * parked on the page it was showing.
 */

export interface LockLandingState {
	/** A profile is selected in the shell. */
	hasProfile: boolean
	/** The current route requires an open session. */
	onAuthRequiredRoute: boolean
	/** The current route owns a passkey ceremony. */
	isPasskeyRoute: boolean
	/** The lock screen has a profile to unlock. */
	hasCandidate: boolean
}

export type LockLandingAction =
	/** A passkey-interaction route with no profile selected owns its own ceremony: touch nothing. */
	| "passkey-hold"
	/** Select the candidate and go to the lock screen (the password path must stay reachable). */
	| "select-and-auth"
	/** The shell renders an authenticated page over a worker with no session: enter the locked state. */
	| "lock"
	/** Nothing to change; only mark the session as checked. */
	| "settle"

export function decideLockLanding(state: LockLandingState): LockLandingAction {
	if (state.isPasskeyRoute && !state.hasProfile) return "passkey-hold"
	if (!state.hasProfile) return state.hasCandidate ? "select-and-auth" : "settle"
	return state.onAuthRequiredRoute ? "lock" : "settle"
}
