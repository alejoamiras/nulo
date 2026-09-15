import { z } from "zod"
import type { FeeSettings, AuthwitContent } from "@/wallet/services/execution/spec"

export const AUTH_REGISTRY_SERVICE_NAME = "auth-registry"

/** EntityStorage root for authwit rows (keyed by `String(authwit.id)`). Frozen:
 *  renaming detaches every existing row; the backup-migration registry pins it. */
export const AUTH_REGISTRY_STORAGE_ROOT = "nulo:core:auth-registry"

/** EntityStorage root for per-account enable flags. Backup-ABSENT by design:
 *  `backup()` never exports it and absence defaults to `true` at read time, so
 *  a backup migration touching this root cannot distinguish "disabled" from
 *  "absent" — the backup-migration guardrail blocks import for any migration
 *  that reads or writes it. */
export const AUTH_REGISTRY_ENABLED_STORAGE_ROOT = "nulo:core:auth-registry-enabled"

export const MAX_REVOKES_PER_TX = 28 // Aztec protocol limitation

/** Per-account ceiling on tracked public authwits. Enforced PRE-send (at the
 *  build/approval gate): granting beyond this is blocked, NEVER auto-evicted —
 *  eviction would destroy the only local revocation index. */
export const MAX_TRACKED_AUTHWITS_PER_ACCOUNT = 256

export type Authwit = {
	/** Internal id. */
	id: number
	/** Owning profile — authwit rows are keyed by a bare numeric id, so the scope tuple
	 *  `(profileId, chainId, account)` lives INSIDE the row and every read/purge/sync/dedup path
	 *  filters on it. Without it a hostile backup, a sibling profile's reconcile or a cross-chain
	 *  sync could read or delete another profile's authwits (F-07). */
	profileId: string
	/** Aztec chain id this authwit lives on — part of the scope tuple. */
	chainId: number
	/** Account created the authwit. */
	account: string
	/** Message hash. */
	hash: string
	/** Plain content. */
	content: AuthwitContent
	/** Recording state. A `pending` row was written at the post-send tail but is
	 *  not yet mine-confirmed; it is reconciled once its tx mines (→ confirmed,
	 *  `pending` cleared) or drops (→ removed). Absent ⇒ confirmed/legacy. The
	 *  pending row IS the durable record — recovery retries from it, never from
	 *  on-chain enumeration (the registry can't discover authwits from chain). */
	pending?: boolean
	/** The tx that wrote this authwit on-chain — the reconcile key. */
	txHash?: string
}

/** Storage codec row schema. `content` is deliberately shape-tolerant: it is a
 *  deep wallet-bridge-owned union used for DISPLAY only — the registry branches
 *  on the flat fields, and rejecting an old content variant would hide the row. */
export const AuthwitSchema: z.ZodType<Authwit> = z.object({
	id: z.number(),
	profileId: z.string(),
	chainId: z.number(),
	account: z.string(),
	hash: z.string(),
	content: z.custom<AuthwitContent>((v) => typeof v === "object" && v !== null),
	pending: z.boolean().optional(),
	txHash: z.string().optional(),
})

/** Codec for the per-account enabled-flag store (rows are bare booleans). */
export const AuthwitStatusSchema = z.boolean()

/** The registry-enabled flag is per `(profileId, chainId, account)`, not per bare account: the
 *  same address is a legitimate account on a sibling profile and on another chain, and a
 *  bare-account key would let a sibling's disable hide this profile's grants (F-07). JSON-encoded
 *  for the same reason as `accountRowId` — a delimiter could occur inside a profile id. */
export function authwitStatusRowId(profileId: string, chainId: number, account: string): string {
	return JSON.stringify(["authwit-status", profileId, chainId, account])
}

/** Inverse of `authwitStatusRowId`: the byte-canonical scope tuple a key encodes, or undefined
 *  for a legacy/foreign key. Ownership evidence must be byte-canonical (see `parseAccountRowId`):
 *  a crafted non-canonical key must not donate a foreign account to a purge cascade. */
export function parseAuthwitStatusRowId(id: string): { profileId: string; chainId: number; account: string } | undefined {
	let parsed: unknown
	try {
		parsed = JSON.parse(id)
	} catch {
		return undefined
	}
	if (!Array.isArray(parsed) || parsed.length !== 4 || parsed[0] !== "authwit-status") return undefined
	const [, profileId, chainId, account] = parsed
	if (typeof profileId !== "string" || typeof chainId !== "number" || typeof account !== "string") return undefined
	if (authwitStatusRowId(profileId, chainId, account) !== id) return undefined
	return { profileId, chainId, account }
}

/** Scope carried by the registry enable/disable events so a listener can tell whether the change
 *  is for the account+chain it currently shows (a bare account is ambiguous across chains). */
export type AuthwitRegistryScope = { profileId: string; chainId: number; account: string }

export type Methods = {
	/**
	 * Returns a list of tracked public authwits for `(active profile, chainId, account)`.
	 * @param chainId Aztec chain id scoping the lookup.
	 * @param account Account address.
	 */
	getAuthwits(chainId: number, account: string): Authwit[]
	/**
	 * Revokes up to MAX_REVOKES_PER_TX authwits (sends a transaction).
	 * @param networkId Network id.
	 * @param account Account address.
	 * @param ids Ids of the authwits to revoke.
	 * @param feeSettings Fee settings to be used for sending the transaction.
	 */
	revokeAuthwits(networkId: string, account: string, ids: number[], feeSettings: FeeSettings): void
	/**
	 * Returns whether or not the auth registry is enabled for `(active profile, chainId, account)`.
	 * @param chainId Aztec chain id scoping the lookup.
	 * @param account Account address.
	 */
	getRegistryEnabled(chainId: number, account: string): boolean
	/**
	 * Enables or disables auth registry for the account (sends a transaction).
	 * @param networkId Network id.
	 * @param account Account address.
	 * @param enabled Whether to enable or disable the auth registry.
	 * @param feeSettings Fee settings to be used for sending the transaction.
	 */
	setRegistryEnabled(networkId: string, account: string, enabled: boolean, feeSettings: FeeSettings): void
	/**
	 * Triggers synchronization of the auth registry for the account.
	 * @param networkId Network id.
	 * @param account Account address.
	 */
	syncRegistry(networkId: string, account: string): void
}

export type Events = {
	/** Emitted when a new authwit is added (carries the full scoped row). */
	onAuthwitAdded: Authwit
	/** Emitted when an existing authwit is deleted (carries the full scoped row). */
	onAuthwitDeleted: Authwit
	/** Emitted when an auth registry is enabled — the `(profileId, chainId, account)` scope, so a
	 *  listener filters to the account+chain it currently shows (a bare account is ambiguous). */
	onRegistryEnabled: AuthwitRegistryScope
	/** Emitted when an auth registry is disabled — same scope. */
	onRegistryDisabled: AuthwitRegistryScope
}
