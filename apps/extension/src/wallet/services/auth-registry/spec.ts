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
	account: z.string(),
	hash: z.string(),
	content: z.custom<AuthwitContent>((v) => typeof v === "object" && v !== null),
	pending: z.boolean().optional(),
	txHash: z.string().optional(),
})

/** Codec for the per-account enabled-flag store (rows are bare booleans). */
export const AuthwitStatusSchema = z.boolean()

export type Methods = {
	/**
	 * Returns a list of tracked public authwits for the account.
	 * @param account Account address.
	 */
	getAuthwits(account: string): Authwit[]
	/**
	 * Revokes up to MAX_REVOKES_PER_TX authwits (sends a transaction).
	 * @param networkId Network id.
	 * @param account Account address.
	 * @param ids Ids of the authwits to revoke.
	 * @param feeSettings Fee settings to be used for sending the transaction.
	 */
	revokeAuthwits(networkId: string, account: string, ids: number[], feeSettings: FeeSettings): void
	/**
	 * Returns whether or not the auth registry is enabled for the account.
	 * @param account Account address.
	 */
	getRegistryEnabled(account: string): boolean
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
	/** Emitted when a new authwit is added */
	onAuthwitAdded: Authwit
	/** Emitted when an existing authwit is deleted */
	onAuthwitDeleted: Authwit
	/** Emitted when an auth registry is enabled */
	onRegistryEnabled: string
	/** Emitted when an auth registry is disabled */
	onRegistryDisabled: string
}
