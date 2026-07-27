/**
 * The composite scope that owns every piece of activity state.
 *
 * A record belongs to exactly one `(profileId, networkId, chainId, accountAddress)`
 * tuple. Routing is always computed from the record's OWN scope — never from
 * whichever scope happens to be active — which is what makes cross-scope
 * isolation structural rather than a filter someone can forget to apply.
 */

/** Identifies the silo a record lives in. */
export interface ActivityScope {
	profileId: string
	networkId: string
	chainId: number
	accountAddress: string
}

/**
 * Opaque canonical encoding of an `ActivityScope`, used as a map key.
 *
 * Branded so a bare string can't be passed where a validated key is required.
 */
export type ActivityScopeKey = string & { readonly __activityScopeKey: unique symbol }

/** Thrown when a scope is structurally unusable as an identity. */
export class InvalidActivityScopeError extends Error {
	public constructor(reason: string) {
		super(`Invalid activity scope: ${reason}`)
		this.name = "InvalidActivityScopeError"
	}
}

/** Addresses are compared case-insensitively; storage and events may disagree on casing. */
function canonicalizeAddress(address: string): string {
	return address.trim().toLowerCase()
}

/**
 * Encode a scope into its canonical key.
 *
 * JSON-encodes the parts rather than joining on a delimiter: any separator
 * character could also occur inside an identifier, which makes `a|b` vs `a` +
 * `|b` ambiguous. JSON quoting removes that whole class of collision.
 */
export function activityScopeKey(scope: ActivityScope): ActivityScopeKey {
	if (scope.profileId.trim().length === 0) throw new InvalidActivityScopeError("empty profileId")
	if (scope.networkId.trim().length === 0) throw new InvalidActivityScopeError("empty networkId")
	if (!Number.isSafeInteger(scope.chainId) || scope.chainId < 0) {
		throw new InvalidActivityScopeError(`chainId must be a non-negative safe integer (got ${scope.chainId})`)
	}
	const address = canonicalizeAddress(scope.accountAddress)
	if (address.length === 0) throw new InvalidActivityScopeError("empty accountAddress")
	return JSON.stringify([scope.profileId, scope.networkId, scope.chainId, address]) as ActivityScopeKey
}

/** Structural equality on the canonical form. */
export function scopesEqual(a: ActivityScope, b: ActivityScope): boolean {
	return activityScopeKey(a) === activityScopeKey(b)
}
