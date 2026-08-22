import type { Fr } from "@aztec/foundation/curves/bn254"
import type {
	Base64CredentialId,
	Base64MasterSecret,
	ImportedKeysDek,
	PasskeyCredentialData,
	SessionWrappedSecret,
} from "@nulo/wallet-crypto"
import type { Restored } from "@/wallet/base"

export const PROFILE_SERVICE_NAME = "profile"

export type ProfileType = "password" | "passkey"

/**
 * The secret half of a full-backup `restore()`, discriminated by profile type.
 * Replaces the old polymorphic `masterKey: string` slot, where a password profile
 * passed a base64 32-byte plain master key and a passkey profile passed a credential
 * id in the SAME parameter — a swap that type-checked and only failed at restore.
 * `ProfileService.restore` asserts `secret.type === profile.type` before branching.
 */
export type RestoreSecret =
	| {
			type: "password"
			masterKey: Base64MasterSecret
			/** Base64 of the 32-byte BIP-39 entropy behind the recovery phrase. REQUIRED for
			 *  epoch-4 password backups; `restore` verifies `PBKDF2(words(entropy)) == masterKey`
			 *  before sealing either (the backup checksum is integrity-not-auth). */
			entropy: string
			/** Base64 of the SOURCE profile's 32-byte imported-keys DEK, plaintext — the same trust
			 *  envelope as the plaintext `masterKey` beside it. REQUIRED (epoch-4 shape). Used ONLY
			 *  inside the TTL-bound rewrap context: `restore` mints a FRESH destination DEK for the
			 *  new row (a restored clone must never share the source's DEK — clone divergence) and
			 *  `restoreImportedKeys` rewraps the backup's key rows source→destination. */
			importedKeysDek: string
	  }
	| {
			type: "passkey"
			credentialId: Base64CredentialId
			/** The source profile's SEALED dek blob, verbatim (passkey backups carry no plaintext
			 *  secrets) — the restore ceremony re-derives the same PRF wrap key to unseal it into
			 *  the rewrap context. REQUIRED (epoch-4 shape). */
			dekSealed: string
	  }

export type ProfileInfo = {
	/** Randomly generated id. */
	id: string
	/** Display name. */
	name: string
	/** Profile type. */
	type: ProfileType
}

export type Profile = ProfileInfo & {
	/** 128-bit random incarnation generation (hex), minted fresh at EVERY row
	 *  creation — including a same-id backup re-import. The PXE layer fences
	 *  provisions/ops/clears on it so a deleted incarnation can never be
	 *  resurrected in the offscreen document (#281 D4). Never reused, never
	 *  derived from the id. */
	pxeGeneration: string
	/** The per-profile imported-keys DEK, sealed under the profile CREDENTIAL (password:
	 *  EncryptionKey under the passhash; passkey: AES-GCM under the PRF-derived wrap key), AAD
	 *  `nulo:profile-imported-dek:v1`. The DEK — never the master — roots imported signing-key
	 *  rows: a shared recovery phrase means a shared master, so master-rooted keys are readable by
	 *  the sibling profile by construction. */
	dekSealed: string
	/** One-way plaintext duplicate-phrase detector: hex(sha256("nulo:wallet-fingerprint:v1" ||
	 *  master)). Plaintext ON PURPOSE — other profiles' masters are sealed, so import/restore can
	 *  only compare a candidate master against stored fingerprints. Negligible-marginal (not zero)
	 *  same-device linkability, owner-accepted; see `wallet-fingerprint.ts`. */
	walletFingerprint: string
} & (
		| {
				type: "password"
				guard: string
				secret: string
				/** Sealed 32-byte BIP-39 entropy (AAD-bound, PasswordSecretBox v2) — the recovery
				 *  phrase re-displays from THIS; the master derives one-way from the words. */
				entropy: string
				/** HMAC over the WHOLE sealed envelope (guard‖secret‖entropy‖dekSealed), keyed by
				 *  HKDF(master‖dek) — v2. NOT master-only: the same-phrase attacker HOLDS the
				 *  master, so a master-keyed tag is forgeable by them; forging v2 requires the
				 *  victim's DEK. Verified at password unlock AND bearer restore; a mismatch opens
				 *  DERIVED-ONLY (imported accounts quarantine, no bearer) — never a profile block
				 *  (A4: imported material must not block derived funds). */
				envelopeMac: string
		  }
		| {
				type: "passkey"
				credentialId: string
		  }
	)

/** Mint a fresh 128-bit Web-Crypto incarnation generation (32 hex chars). */
export function mintPxeGeneration(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16))
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export type Session = {
	/** Profile id. */
	profile: string
	/** F-11: random-token wrapped-secret silent-restore bearer (non-strict
	 *  password profiles only). Replaces `passhash` — see `SessionSecretBox`.
	 *  The token is random, not password-derived, so a session-store leak no
	 *  longer exposes a password-equivalent value. */
	bearer?: SessionWrappedSecret
	/** @deprecated F-11: legacy password-equivalent bearer (unsalted
	 *  `SHA-256(password)`). Written only by pre-F-11 code; the new `restore()`
	 *  NEVER accepts it — such a session is `silentClose`d (one-time re-unlock). */
	passhash?: string
	/** Creation time */
	since: number
	/**
	 * Epoch-ms timestamp at which this session expires. Set when
	 * `sessionTtl > 0`. Optional for backward compatibility — older
	 * sessions written without this field still load; `SessionManager`
	 * derives the same value from `since + sessionTtl` at read time.
	 *
	 * Source of truth for the `chrome.alarms` lock fire — both the
	 * scheduler (`open` / `refresh`) and the alarm listener gate compare
	 * against it (gate:
	 * `alarm.scheduledTime === activeSession.session.lockedAt`).
	 *
	 * Schema version: still v1 (additive optional field). Any future
	 * session migrator MUST accept both `lockedAt`-present and
	 * `lockedAt`-absent records as v1.
	 */
	lockedAt?: number
}

export type ActiveSession = {
	/** Profile object*/
	profile: Profile
	/** Session object */
	session: Session
	/** Master secret */
	secret: Fr
	/** The unsealed imported-keys DEK. `undefined` = a DEGRADED (derived-only) session: the DEK
	 *  slot failed to unseal or the envelope MAC failed at unlock — imported accounts quarantine
	 *  per-account, and NO silent-restore bearer is persisted (the next SW wake forces a password
	 *  unlock, re-surfacing the state). Zeroized on close/replace/expiry. */
	dek?: ImportedKeysDek
}

export type Methods = {
	/**
	 * Returns a profile for which an active session exists, or undefined otherwise.
	 */
	getActiveProfile(): ProfileInfo | undefined

	/**
	 * Returns a list of profiles.
	 */
	getProfiles(): ProfileInfo[]

	/**
	 * Returns a freshly-generated profile id that is not currently in
	 * storage — useful for PATH A passkey create flows that need to
	 * bind the WebAuthn `userHandle` to a known id BEFORE the ceremony
	 * runs (the credential's userHandle = profile id is the linkage
	 * `recoverByCredentialId` / `importPasskey` rely on).
	 *
	 * Caller MUST follow the contract documented at
	 * `ProfileRepository.generateUniqueId` — pair every use with a
	 * locked re-verification before relying on the id. The id may be
	 * claimed by a concurrent writer between this call and the
	 * subsequent `createPasskeyProfile`; surface that conflict via
	 * `ProfileIdConflictError`.
	 */
	generateProfileId(): string

	/**
	 * Creates and returns a new profile.
	 * @param name Display name.
	 * @param password Password for storage encryption.
	 */
	createProfile(name: string, password: string): ProfileInfo

	/**
	 * Creates and returns a new passkey-backed profile.
	 *
	 * @param name Display name.
	 * @param credentialData OPTIONAL — PATH A. When present, the caller has
	 *   already collected the WebAuthn credential via the in-page modal
	 *   (`src/wallet/utils/passkey-ceremony.ts:runPasskeyCeremony`); the SW
	 *   skips its window-opening dance and uses the supplied data.
	 *   When absent, falls through to the legacy PATH B (SW opens a popup
	 *   window). PATH B currently has no production callers but the
	 *   plumbing is preserved for future SW/dApp-triggered flows.
	 */
	createPasskeyProfile(name: string, credentialData?: PasskeyCredentialData): ProfileInfo

	/**
	 * Unlocks a profile with the specified id.
	 * @param id Profile id.
	 * @param password Profile password.
	 */
	unlockProfile(id: string, password: string): ProfileInfo

	/**
	 * Unlocks a passkey-backed profile with the specified id.
	 *
	 * @param id Profile id.
	 * @param credentialData OPTIONAL — PATH A. See `createPasskeyProfile` for
	 *   the dual-path contract.
	 */
	unlockPasskeyProfile(id: string, credentialData?: PasskeyCredentialData): ProfileInfo

	/**
	 * Returns the WebAuthn `credentialId` bound to a passkey profile.
	 * The popup needs this to run a targeted `navigator.credentials.get`
	 * (allowedCredentials) for PATH A unlock — instead of a discovery
	 * `get` that would let the user pick any of their passkeys, possibly
	 * the wrong one. Throws if the profile is not passkey-typed or has
	 * no credentialId.
	 */
	getPasskeyCredentialId(id: string): string

	/**
	 * Locks active profile, closing active session.
	 */
	lockActiveProfile(): void

	/**
	 * Resets expiration of active session.
	 */
	refreshSession(): void

	/**
	 * Changes profile name and returns the updated profile.
	 * @param id Profile id.
	 * @param newName New display name.
	 */
	changeProfileName(id: string, newName: string): ProfileInfo

	/**
	 * Changes profile password and returns the updated profile.
	 * @param id Profile id.
	 * @param oldPassword Old password, to decrypt storage.
	 * @param newPassword New password, to encrypt storage.
	 */
	changeProfilePassword(id: string, oldPassword: string, newPassword: string): ProfileInfo

	/**
	 * Confirm profile operation.
	 * @param id Profile id.
	 * @param password Profile password.
	 */
	confirmProfileOperation(id: string, password?: string): boolean

	/**
	 * Deletes a profile and returns the deleted profile.
	 * @param id Profile id.
	 */
	deleteProfile(id: string): ProfileInfo

	/**
	 * Imports a passkey-backed profile using an existing credential and signs in.
	 *
	 * @param name Display name.
	 * @param credentialData OPTIONAL — PATH A. See `createPasskeyProfile` for
	 *   the dual-path contract.
	 */
	importPasskey(name: string, credentialData?: PasskeyCredentialData, allowDuplicate?: boolean): ProfileInfo

	/**
	 * Imports a profile from its 24-word recovery phrase and signs in. Validates on the
	 * canonical form (NFKD/lowercase/collapse) BEFORE any persistence: exactly 24 words, all
	 * on the wordlist, checksum valid. The master derives via the standard BIP-39 PBKDF2 step
	 * (NULO-ACCOUNT-KDF v2); the entropy is stored sealed so the phrase re-displays.
	 * Throws `DuplicateWalletError` (naming the colliding profile) when another live profile
	 * carries the same wallet fingerprint, unless `allowDuplicate` — the UI confirms and retries
	 * (warn-and-confirm, never a hard block; owner policy).
	 * @param name Display name.
	 * @param mnemonic 24-word recovery phrase.
	 * @param password Password to encrypt the secrets.
	 * @param allowDuplicate Confirmed duplicate override from the warn dialog.
	 */
	importMnemonic(name: string, mnemonic: string[], password: string, allowDuplicate?: boolean): ProfileInfo

	/**
	 * Returns plain profile secret (base64). For passkey profiles, the
	 * return value is the credentialId (not a base64 secret) — the
	 * full-backup format uses it as the `master-key` field; the import
	 * side re-runs the ceremony against that credentialId to recover
	 * the actual master.
	 *
	 * @param id Profile id.
	 * @param password Password to decrypt the secret (password profiles only).
	 * @param credentialData PATH A — required for passkey profiles. The
	 *   caller (popup) has already collected the WebAuthn credential via
	 *   the in-page `PasskeyCeremonyDialog`. Throws if missing for a
	 *   passkey profile (no SW-driven window fallback).
	 */
	exportPlain(id: string, password?: string, credentialData?: PasskeyCredentialData): string

	/**
	 * Atomic discriminated export for the Full-Backup builder: master key, recovery-phrase
	 * entropy, AND the imported-keys DEK from ONE authenticated pass, so the backup fields can
	 * never come from different row states (no cross-call races). Password profiles only. Fails
	 * loudly on an unrecoverable DEK slot (the epoch-4 backup shape requires it; a password
	 * change self-heals the slot first).
	 * @param id Profile id.
	 * @param password Password to decrypt the secrets.
	 */
	exportBackupMaterial(id: string, password: string): { masterKey: string; entropy: string; importedKeysDek: string }

	/**
	 * The profile's SEALED imported-keys DEK blob, verbatim (ciphertext — safe to hand out).
	 * Passkey full backups carry THIS as their `imported-keys-dek-sealed` field; the restore
	 * ceremony re-derives the same PRF wrap key to open it.
	 * @param id Profile id.
	 */
	getProfileDekSealed(id: string): string

	/**
	 * Returns the 24-word recovery phrase, re-encoded from the profile's stored entropy after
	 * the words↔master pairing check (fails closed on a tampered row).
	 * @param id Profile id.
	 * @param password Password to decrypt the secrets.
	 */
	exportMnemonic(id: string, password: string): string[]

	/**
	 * Restores a profile from a full-backup payload. Writes the profile to
	 * storage and emits `onProfileAdded`. Does NOT open a session — that's
	 * deferred to `finalizeRestore` so the caller can finish restoring
	 * networks / accounts / etc. before `onActiveProfileChanged` fires.
	 *
	 * For passkey profiles, the recovered secret is retained server-side in
	 * memory between this call and `finalizeRestore` so the caller does not
	 * have to run a second WebAuthn ceremony.
	 *
	 * @param profile Source profile descriptor (id, name, type) from the backup.
	 * @param secret Profile-type-discriminated: `{ type: "password", masterKey }`
	 *                  carries the base64 32-byte plain master key; `{ type:
	 *                  "passkey", credentialId }` carries the original credentialId
	 *                  used to drive recovery. `secret.type` must equal
	 *                  `profile.type` (asserted first). For passkey, the service
	 *                  rejects (with `credentialId mismatch`) if `credentialData.id`
	 *                  does not match `secret.credentialId`.
	 * @param password New password (password profiles only).
	 * @param credentialData PATH A — required for passkey profiles. The
	 *   caller (popup) has already collected the WebAuthn credential via
	 *   the in-page `PasskeyCeremonyDialog`. Returns
	 *   `{...profile, restoreError}` if missing for a passkey profile (no
	 *   SW-driven window fallback).
	 */
	restore(
		profile: ProfileInfo,
		secret: RestoreSecret,
		password?: string,
		credentialData?: PasskeyCredentialData,
		allowDuplicate?: boolean,
	): Restored<ProfileInfo>

	/**
	 * Opens the session for a profile previously created by `restore()`.
	 * For password profiles, takes the SAME password supplied to `restore`
	 * and re-derives the secret (one PBKDF2). For passkey profiles, consumes
	 * the in-memory pending secret stashed by `restore` — no second WebAuthn
	 * prompt.
	 *
	 * Emits `onActiveProfileChanged` once the session is up. Idempotent: if
	 * the session is already active for `id`, returns without re-opening.
	 *
	 * @param id Profile id (from the `restore` return value).
	 * @param password Password (password profiles only).
	 */
	finalizeRestore(id: string, password?: string): ProfileInfo
}

export type Events = {
	/** Emitted when a new profile is created. */
	onProfileAdded: ProfileInfo
	/** Emitted when an existing profile is updated. */
	onProfileUpdated: ProfileInfo
	/** Emitted when an existing profile is deleted. */
	onProfileDeleted: ProfileInfo
	/** Emitted when an active profile is changed. */
	onActiveProfileChanged: ProfileInfo | undefined
	/** Emitted when an unlock opened a DEGRADED (derived-only) session — the imported-keys DEK
	 *  slot failed to unseal or the envelope MAC failed. The popup surfaces a visible warning
	 *  (never just a log); imported accounts quarantine per-account. */
	onImportedKeysDegraded: ProfileInfo
}
