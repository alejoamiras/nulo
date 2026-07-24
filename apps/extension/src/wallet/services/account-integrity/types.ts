import type { MasterSecretBytes } from "@nulo/wallet-crypto"
import { z } from "zod"

export const ACCOUNT_INTEGRITY_BLOCKED_ROOT = "nulo:core:account-integrity-blocked"
export const ACCOUNT_INTEGRITY_VERIFIED_ROOT = "nulo:core:account-integrity-verified"

/** Per-profile marker of the last verification that passed green. Lets the boot path skip
 *  re-deriving on every SW wake: a silently-rehydrated session is re-verified ONLY when the wallet
 *  build changed OR the account set changed since the stamp. Both are keyed here — the digest is
 *  computed from storage at verify AND at check time, so an account added/restored/removed after a
 *  green stamp deterministically invalidates it (no event race). */
export const VerifiedStampSchema = z.object({ walletVersion: z.string(), accountSetDigest: z.string() })
export type AccountIntegrityVerifiedStamp = z.infer<typeof VerifiedStampSchema>

/**
 * Deterministic identity of a profile's account set — order-independent over the fields that feed
 * address derivation + the derived address itself. Pure string work (jsdom-safe, no crypto/bb);
 * it is an identity key, not a security digest.
 */
export function accountSetDigest(rows: ReadonlyArray<{ chainId: number; index: number; type: number; address: string }>): string {
	return JSON.stringify(rows.map((r) => `${r.chainId}:${r.index}:${r.type}:${r.address}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
}

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
