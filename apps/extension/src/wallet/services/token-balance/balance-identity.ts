import { canonicalNumericStorageId } from "@/wallet/services/purge-rows"
import type { Token } from "@/wallet/services/token/spec"
import type { TokenBalanceRaw } from "./spec"

/**
 * The row↔token identity invariant: the row's FK and its stamped identity triple both
 * match the token. The triple is immutable on tokens (`updateToken` rejects any change),
 * so a mismatch proves the row belongs to a dead incarnation or a foreign owner — never
 * a legitimate drift. The FK equality is part of the predicate on purpose: most callers
 * resolve `token` via `tokens.get(row.token)` making it implicit, but the invariant must
 * not depend on that caller precondition (backup's export join in particular).
 */
type RowIdentity = Pick<TokenBalanceRaw, "token" | "profileId" | "chainId" | "contract">
type TokenIdentity = Pick<Token, "id" | "profileId" | "chainId" | "contract">

export function rowMatchesToken(row: RowIdentity, token: TokenIdentity): boolean {
	return row.token === token.id && row.profileId === token.profileId && row.chainId === token.chainId && row.contract === token.contract
}

/**
 * Exact pre-identity (legacy) balance shape: the complete old codec, all three identity
 * fields absent, and the canonical numeric storage key equal to the embedded id. Anything
 * else — partial-new, otherwise-malformed, key-mismatched — is debris of a different
 * provenance and deliberately NOT matched: the startup sweep may only reap rows provably
 * written by the old schema.
 */
export function isLegacyBalanceRow(raw: Record<string, unknown>, storageId: string): boolean {
	if ("profileId" in raw || "chainId" in raw || "contract" in raw) return false
	if (typeof raw.id !== "number" || typeof raw.token !== "number" || typeof raw.account !== "string") return false
	if (typeof raw.updatedAt !== "number") return false
	if (raw.publicBalance !== undefined && typeof raw.publicBalance !== "string") return false
	if (raw.privateBalance !== undefined && typeof raw.privateBalance !== "string") return false
	if (raw.syncFailure !== undefined) {
		const sf = raw.syncFailure as { at?: unknown; message?: unknown } | null
		if (typeof sf !== "object" || sf === null || typeof sf.at !== "number" || typeof sf.message !== "string") return false
	}
	return canonicalNumericStorageId(storageId) === raw.id
}
