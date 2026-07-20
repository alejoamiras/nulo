import type { MasterSecretBytes } from "@nulo/wallet-crypto"
import { z } from "zod"

export const ACCOUNT_INTEGRITY_BLOCKED_ROOT = "nulo:core:account-integrity-blocked"
export const ACCOUNT_INTEGRITY_VERIFIED_ROOT = "nulo:core:account-integrity-verified"

/** Per-profile marker of the last wallet build whose derivation verified green. Lets the boot
 *  path skip re-deriving on every SW wake: a silently-rehydrated session is re-verified ONLY on
 *  the first boot of a new build (the update window the per-open chokepoint cannot see). */
export const VerifiedStampSchema = z.object({ walletVersion: z.string() })
export type AccountIntegrityVerifiedStamp = z.infer<typeof VerifiedStampSchema>

/**
 * The persisted mismatch record — one per blocked profile. Written by the integrity coordinator
 * the moment a stored account address diverges from re-derivation; read raw by the popup barrier
 * (presence of the key = blocked, even if the payload is corrupt — fail-closed).
 */
export const AccountIntegrityBlockedSchema = z.object({
	profileId: z.string(),
	chainId: z.number(),
	accountIndex: z.number(),
	storedAddress: z.string(),
	derivedAddress: z.string(),
	/** The address regime this build derives under (see aztec-runtime address-freeze). */
	regimeId: z.string(),
	/** Wallet build that detected the mismatch. */
	walletVersion: z.string(),
	detectedAt: z.number(),
})
export type AccountIntegrityBlocked = z.infer<typeof AccountIntegrityBlockedSchema>

/**
 * Injected into ProfileService by the last-started AccountIntegrityCoordinator — never a
 * topological dependency (would be a cycle, mirroring the deletion delegate).
 */
export interface AccountIntegrityDelegate {
	/**
	 * Re-derive every stored account of the profile (all chains) from the master secret and
	 * compare to the stored addresses. On mismatch: persists the blocking record and THROWS
	 * `AccountAddressInconsistencyError` — the caller must NOT open the session. On success:
	 * clears any stale blocking record for the profile (a compatible build heals the block).
	 * Deterministic and PXE/node-independent, so there are no transient false positives.
	 */
	verifyBeforeSessionOpen(profileId: string, masterSecret: MasterSecretBytes): Promise<void>
}

/**
 * Injected into AccountService for the mid-session window (e.g. an extension update rehydrated a
 * live session under new derivation code): `getAccountContract` detects the mismatch at operation
 * time, reports here, and throws the typed error. The coordinator persists the record and closes
 * the session.
 */
export interface AccountRuntimeIntegrityDelegate {
	reportRuntimeMismatch(record: AccountIntegrityBlocked): Promise<void>
}
