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
import { METHOD_SCOPE_CHECKER, type MethodName } from "./method-descriptors"
import { type AccountScopeField, scopeViolation } from "./scope-violation"

// ── Session-account-scope helper ──────────────────────────────────────

/**
 * Every entry of a dApp-supplied account list must be one of the session's approved accounts:
 * PXE exposes private state for each, so an unchecked list widens one granted account into many.
 * A field that is absent or not an array passes.
 */
function validateAccountScopes(scopeField: unknown, sessionAccounts: Set<string>, method: MethodName, field: AccountScopeField): void {
	if (!Array.isArray(scopeField)) return
	for (const entry of scopeField) {
		if (!sessionAccounts.has(String(entry))) {
			throw scopeViolation(`Scope violation: ${method}.${field} entry not in session's approved accounts`)
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
 * `enforceScope`, then every dApp-supplied account list against the session's approved accounts.
 * The account lists are checked even when `exec.calls` is empty, where the call checkers pass
 * vacuously.
 *
 * `sessionAccounts` is the set of CAIP-10 account identifiers approved
 * for this session. Pass an empty set if no session — the caller (the
 * dispatcher) decides how to handle missing sessions; this function just
 * fails closed.
 */
export function enforceScopeWithSession(
	methodName: MethodName,
	args: unknown[],
	grants: GrantedCapabilityRecord[],
	sessionAccounts: Set<string>,
): void {
	enforceScope(methodName, args, grants)

	const exec = args[0] as Record<string, unknown> | undefined
	const opts = args[1] as Record<string, unknown> | undefined

	validateAccountScopes(exec?.scopes, sessionAccounts, methodName, "exec.scopes")
	validateAccountScopes(opts?.scopes, sessionAccounts, methodName, "opts.scopes")
	validateAccountScopes(opts?.additionalScopes, sessionAccounts, methodName, "opts.additionalScopes")

	// getPrivateEvents takes `(eventMetadata, eventFilter)` where eventFilter
	// can also include a `scopes` array.
	if (methodName === "getPrivateEvents") {
		const eventFilter = args[1] as Record<string, unknown> | undefined
		validateAccountScopes(eventFilter?.scopes, sessionAccounts, methodName, "eventFilter.scopes")
	}
}
