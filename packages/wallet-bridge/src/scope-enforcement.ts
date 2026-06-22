/**
 * Per-operation scope enforcement for wallet-sdk method calls.
 *
 * Checks that the specific contracts/functions targeted by a dApp operation
 * fall within the scope of the dApp's granted capabilities. This runs AFTER
 * type-level enforcement (enforceCapability) which ensures the capability
 * type itself is granted.
 *
 * The per-method checker BODIES + their helpers live in
 * `./method-scope-checkers` (the leaf the method-descriptors registry also
 * references — that split breaks the registry↔scope-enforcement cycle). This
 * file owns the method→checker map and the F-005 session-account-scope wrapper.
 */

import type { GrantedCapabilityRecord } from "./capabilities"
// The method→checker map is DERIVED from the method-descriptors registry (the
// single source of truth) — no longer a hand-maintained literal here.
import { METHOD_SCOPE_CHECKER } from "./method-descriptors"

// ── F-005 session-account-scope helper ────────────────────────────────

/**
 * F-005: validate dApp-supplied account-scope arrays against the session's
 * approved account list. The dApp can pass `eventFilter.scopes`,
 * `opts.scopes`, or `opts.additionalScopes` — arrays of CAIP-10 accounts
 * the wallet should expose private state for during execution. Prior to
 * this helper, the dispatcher forwarded these arrays unchanged to PXE,
 * silently widening one granted account into N accounts.
 *
 * sessionAccounts is the set of CAIP-10 account identifiers the session
 * has approved (built from `dappSession.accounts`).
 *
 * Throws if any entry in the scope array is not in the approved set.
 * Returns silently if the scope field is absent or not an array (i.e. the
 * caller didn't pass it).
 */
function validateAccountScopes(scopeField: unknown, sessionAccounts: Set<string>, fieldName: string): void {
	if (!Array.isArray(scopeField)) return
	for (const entry of scopeField) {
		const addr = String(entry)
		if (!sessionAccounts.has(addr)) {
			throw new Error(`Scope violation: ${fieldName} contains ${addr}, not in session's approved accounts`)
		}
	}
}

// ── Main entry point ──────────────────────────────────────────────────

/**
 * Enforce per-operation scope against granted capabilities.
 *
 * Call this after enforceCapability() (type-level check). This function
 * checks that the specific contracts/functions targeted by the operation
 * fall within the scope of at least one matching grant.
 *
 * Methods without a scope dimension (getChainInfo, registerSender, etc.)
 * are silently skipped.
 */
export function enforceScope(methodName: string, args: unknown[], grants: GrantedCapabilityRecord[]): void {
	// `Object.hasOwn` so prototype names can't resolve to a truthy prototype member
	// (which would be invoked as a "checker") on the derived plain object.
	const checker = Object.hasOwn(METHOD_SCOPE_CHECKER, methodName) ? METHOD_SCOPE_CHECKER[methodName] : undefined
	if (!checker) return
	checker(args, grants)
}

/**
 * F-005: extended scope enforcement that ALSO validates dApp-supplied
 * account-scope arrays against the session's approved accounts.
 *
 * Closes the empty-`calls` fast path: F-005's account-scope check fires
 * even when `exec.calls = []` (which short-circuited `checkTransactionCalls`
 * and friends). A dApp could previously pass `{ calls: [], additionalScopes: [<other-account>] }`
 * and bypass enforcement because the contract/function checker exited
 * early on the empty-calls branch.
 *
 * `sessionAccounts` is the set of CAIP-10 account identifiers approved
 * for this session. Pass an empty set if no session — the caller (the
 * dispatcher) decides how to handle missing sessions; this function just
 * fails closed.
 */
export function enforceScopeWithSession(
	methodName: string,
	args: unknown[],
	grants: GrantedCapabilityRecord[],
	sessionAccounts: Set<string>,
): void {
	// First run the standard scope check.
	enforceScope(methodName, args, grants)

	// Then run the F-005 account-scope check. Runs regardless of whether
	// the calls-array check was satisfied or short-circuited.
	const exec = args[0] as Record<string, unknown> | undefined
	const opts = args[1] as Record<string, unknown> | undefined

	validateAccountScopes(exec?.scopes, sessionAccounts, `${methodName}.exec.scopes`)
	validateAccountScopes(opts?.scopes, sessionAccounts, `${methodName}.opts.scopes`)
	validateAccountScopes(opts?.additionalScopes, sessionAccounts, `${methodName}.opts.additionalScopes`)

	// getPrivateEvents takes `(eventMetadata, eventFilter)` where eventFilter
	// can also include a `scopes` array.
	if (methodName === "getPrivateEvents") {
		const eventFilter = args[1] as Record<string, unknown> | undefined
		validateAccountScopes(eventFilter?.scopes, sessionAccounts, `${methodName}.eventFilter.scopes`)
	}
}
