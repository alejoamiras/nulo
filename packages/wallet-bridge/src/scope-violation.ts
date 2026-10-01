/**
 * The one constructor for a grant-check refusal. Its message type admits only wallet-owned words,
 * so a refusal that interpolates a request value does not compile. Leaf module: `MethodName` is a
 * type-only import.
 */
import { ScopeViolationError } from "@nulo/extension-messaging/errors"
import type { MethodName } from "./method-descriptors"

/** Where a dApp-supplied account list arrived. */
export type AccountScopeField = "exec.scopes" | "opts.scopes" | "opts.additionalScopes" | "eventFilter.scopes"

type GrantRefusal =
	| "contract not permitted by granted contracts scope"
	| "class not permitted by granted contractClasses scope"
	| "call not permitted by granted transaction scope"
	| "call not permitted by granted simulation.transactions scope"
	| "call not permitted by granted simulation.utilities scope"
	| "contract not permitted by granted data.privateEvents scope"
	| "account not permitted by granted accounts scope"
	| "call not permitted by granted transaction or simulation scope"
	| "inner-hash consumer not permitted by granted transaction or simulation scope"
	| "requires accounts.canGet=true"
	| "requires data.addressBook=true"

export type ScopeViolationMessage =
	| `Scope violation: ${MethodName} ${GrantRefusal}`
	| `Scope violation: ${MethodName}.${AccountScopeField} entry not in session's approved accounts`
	| "Scope violation: requested account not authorized for this dApp session"

export function scopeViolation(message: ScopeViolationMessage): ScopeViolationError {
	return new ScopeViolationError(message)
}
