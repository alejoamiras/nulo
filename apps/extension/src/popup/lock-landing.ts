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
 *
 * A run over an ESTABLISHED page never selects a candidate: a page with no profile selected that
 * survives a restart owns its own flow (an import mid-restore, the register or reset rituals), and
 * routing it to the lock screen would unmount that flow. Selecting the candidate is the landing of
 * a run that has no page yet — the initial boot, a RETRY, or a reconnect whose mount-time boot was
 * lost before the router resolved (a disconnect that rejected the route guard's first read).
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
	/** A reconnect run over a route that already resolved: the mounted page owns its flow. */
	pageEstablished: boolean
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
	if (!state.hasProfile) return state.hasCandidate && !state.pageEstablished ? "select-and-auth" : "settle"
	return state.onAuthRequiredRoute ? "lock" : "settle"
}

export interface UnreachableLandingState {
	hasProfile: boolean
	hasCandidate: boolean
	pageEstablished: boolean
}

export type UnreachableLandingAction =
	/** Select the candidate and go to the lock screen (the password path is the recovery). */
	| "select-and-auth"
	/** A profile is already selected: the lock screen is the recovery. */
	| "auth"
	/** Show the retry banner in place; an established page keeps its flow, and with no profile
	 *  known there is nothing to unlock. */
	| "stay"

/** Where the shell goes when the service stayed unreachable across the boot's backoff. Same
 *  flow-preservation rule as `decideLockLanding`: an established page is never routed away to
 *  select a candidate. */
export function decideUnreachableLanding(state: UnreachableLandingState): UnreachableLandingAction {
	if (state.hasProfile) return "auth"
	return state.hasCandidate && !state.pageEstablished ? "select-and-auth" : "stay"
}
