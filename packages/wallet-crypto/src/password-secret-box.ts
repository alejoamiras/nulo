/**
 * `PasswordSecretBox` — password-based encryption of the profile master secret.
 *
 * Pure class: no storage writes, no session state, no passkeys, no locking.
 * Wraps `EncryptionKey` (PBKDF2 + AES-GCM) with the `ENCRYPTION_GUARD`
 * round-trip check.
 *
 * ## Wrong-password semantics
 *
 * `unseal` / `unsealWithPasshash` / `reseal` **return `null`** when the
 * supplied credential can't decrypt the profile. They do NOT throw for
 * the wrong-password case. The facade is responsible for mapping
 * `null` into the specific per-callsite error the 31-method RPC
 * contract expects:
 *
 *   - `unlockProfile`           → `throw new InvalidPasswordError()`
 *   - `changeProfilePassword`   → `throw new Error("Invalid profile old password")`
 *   - `confirmProfileOperation` → `throw new InvalidPasswordError()`
 *                                 (then wrapped by the method's own
 *                                 catch block into a generic Error)
 *   - `exportPlain` (password)  → delegates to `confirmProfileOperation`
 *                                 above, which throws first
 *   - `exportMnemonic`          → `throw new Error("Invalid profile old password")`
 *   - `restorePasswordSession`  → silent close (SessionManager owns this)
 *
 * These strings / types are NOT compatibility-fluff; auth UI code
 * matches on `InvalidPasswordError` (`popup/pages/auth.vue:65-74`)
 * and the audit confirmed the error-shape differences are observable.
 *
 * ## Null vs throw
 *
 * Only wrong-password / corrupted-ciphertext failures return null.
 * Unexpected Web Crypto errors (e.g. `importKey` rejects the passhash
 * buffer as the wrong type, or the runtime has no subtle crypto)
 * propagate as thrown exceptions. Callers should not attempt to
 * distinguish those — they're system-level bugs, not user input.
 */

import { array_equals, toBase64 } from "@nulo/wallet-core/utils"
import { EncryptionKey } from "./encryption-key"
import { asBase64Ciphertext, asMasterSecretBytes, type Base64Ciphertext, type MasterSecretBytes, type Passhash } from "./secret-types"
import { zeroize } from "./zeroize"

/** Fixed-plaintext round-trip check. `seal` encrypts this under the
 *  derived key and persists the ciphertext as `guard`; `unseal`
 *  decrypts `guard` and compares against this constant byte-for-byte.
 *  A mismatch means the supplied password is wrong. The value itself
 *  doesn't carry secrets — it just has to be stable. Locked by the V2
 *  derivation vector and every profile row on disk. **DO NOT CHANGE.** */
export const ENCRYPTION_GUARD = new Uint8Array([6, 11, 20, 20, 22, 4, 20, 22])

/** AES-GCM additional-authenticated-data purpose tags for the three profile ciphertexts.
 *  Purpose-only ON PURPOSE (no profileId: create/import/restore finalize ids after sealing) —
 *  a ciphertext swapped between the `secret` and `entropy` slots fails authentication instead
 *  of decrypting into the wrong meaning. Byte-frozen once profiles exist. */
export const PROFILE_AAD = {
	guard: new TextEncoder().encode("nulo:profile-guard:v2") as Uint8Array<ArrayBuffer>,
	secret: new TextEncoder().encode("nulo:profile-master:v2") as Uint8Array<ArrayBuffer>,
	entropy: new TextEncoder().encode("nulo:profile-entropy:v1") as Uint8Array<ArrayBuffer>,
} as const

/** Encrypted form of the master secret + its source entropy as persisted on a Profile record.
 *
 *  Fields are base64-encoded. The encoding is FROZEN — the storage-layer
 *  tests pin it. Do not switch to hex / raw bytes without a migration. */
export type EncryptedProfileSecret = {
	/** Base64-encoded ciphertext of `ENCRYPTION_GUARD` under the key
	 *  derived from the profile password. On unseal this is decrypted
	 *  first and byte-compared to `ENCRYPTION_GUARD`; a mismatch means
	 *  the supplied password is wrong. */
	guard: Base64Ciphertext
	/** Base64-encoded ciphertext of the raw 32-byte master secret under
	 *  the same key as `guard` (AAD: PROFILE_AAD.secret). */
	secret: Base64Ciphertext
	/** Base64-encoded ciphertext of the 32-byte BIP-39 entropy behind the recovery phrase,
	 *  under the same key (AAD: PROFILE_AAD.entropy). REQUIRED for password profiles under the
	 *  entropy-originated model: the master derives one-way from the words, so the words can
	 *  only be re-displayed from stored entropy. */
	entropy: Base64Ciphertext
}

/** Result of a successful `seal`. Returned to callers so they can persist
 *  `encrypted` on the `Profile` record and pass `passhash` into the
 *  SessionManager's `open` fast-path (avoiding a second PBKDF2). */
export type Sealed = {
	passhash: Passhash
	encrypted: EncryptedProfileSecret
}

export class PasswordSecretBox {
	/** Encrypts `secret` + `entropy` under a key derived from `password`. Returns the
	 *  base64-encoded guard+secret+entropy triple for storage plus the passhash for
	 *  the immediate session-open. */
	public async seal(password: string, secret: MasterSecretBytes, entropy: Uint8Array<ArrayBuffer>): Promise<Sealed> {
		const passhash = await EncryptionKey.getPasshash(password)
		try {
			const key = await EncryptionKey.fromPasshash(passhash)
			const encrypted = await this.sealInternal(key, secret, entropy)
			// `passhash` ESCAPES to the caller on success (session-open fast path). Only wipe it
			// on the throw path, where the caller never receives it.
			return { passhash, encrypted }
		} catch (err) {
			zeroize(passhash)
			throw err
		}
	}

	/** Fast path for flows where the caller already has a passhash.
	 *
	 *  ## Buffer ownership
	 *
	 *  The `passhash`, `secret`, and `entropy` parameters are **caller-owned**.
	 *  This method does NOT zero them; the caller is responsible for
	 *  calling `zeroize(...)` after the last legitimate use. */
	public async sealWithPasshash(
		passhash: Passhash,
		secret: MasterSecretBytes,
		entropy: Uint8Array<ArrayBuffer>,
	): Promise<EncryptedProfileSecret> {
		const key = await EncryptionKey.fromPasshash(passhash)
		return this.sealInternal(key, secret, entropy)
	}

	/** Decrypts and returns the raw master secret + entropy, or `null` if the
	 *  password is wrong or the ciphertext is corrupted. */
	public async unseal(
		password: string,
		encrypted: EncryptedProfileSecret,
	): Promise<{ secret: MasterSecretBytes; entropy: Uint8Array<ArrayBuffer> } | null> {
		const passhash = await EncryptionKey.getPasshash(password)
		try {
			const key = await EncryptionKey.fromPasshash(passhash)
			return await this.unsealInternal(key, encrypted)
		} finally {
			zeroize(passhash)
		}
	}

	/** Fast path using a cached passhash. Used during session restore,
	 *  where PBKDF2 already ran on the initial unlock and the resulting
	 *  hash was persisted in the session record.
	 *
	 *  ## Buffer ownership
	 *
	 *  The `passhash` parameter is **caller-owned**. This method does
	 *  NOT zero it; the caller is responsible for calling
	 *  `zeroize(...)` after the last legitimate use. */
	public async unsealWithPasshash(
		passhash: Passhash,
		encrypted: EncryptedProfileSecret,
	): Promise<{ secret: MasterSecretBytes; entropy: Uint8Array<ArrayBuffer> } | null> {
		const key = await EncryptionKey.fromPasshash(passhash)
		return this.unsealInternal(key, encrypted)
	}

	/** Re-encrypts the master secret AND entropy under a new password — always both, atomically:
	 *  a reseal that missed `entropy` would leave the recovery phrase decryptable under the
	 *  RETIRED password (audit H2). Returns the new encrypted blob + new passhash, or `null` if
	 *  the old password was wrong. Used by `changeProfilePassword`.
	 *
	 *  ## Buffer ownership
	 *
	 *  `oldPasshash` is locally derived and zeroed in finally. The
	 *  returned `passhash` (newPasshash) ESCAPES — caller owns it and
	 *  must zero it after the last legitimate use. */
	public async reseal(oldPassword: string, newPassword: string, encrypted: EncryptedProfileSecret): Promise<Sealed | null> {
		const oldPasshash = await EncryptionKey.getPasshash(oldPassword)
		let unsealed: { secret: MasterSecretBytes; entropy: Uint8Array<ArrayBuffer> } | null = null
		try {
			const oldKey = await EncryptionKey.fromPasshash(oldPasshash)
			unsealed = await this.unsealInternal(oldKey, encrypted)
			if (!unsealed) return null

			const newPasshash = await EncryptionKey.getPasshash(newPassword)
			try {
				const newKey = await EncryptionKey.fromPasshash(newPasshash)
				const newEncrypted = await this.sealInternal(newKey, unsealed.secret, unsealed.entropy)
				// newPasshash ESCAPES on success (caller owns it); wipe it only if sealing throws.
				return { passhash: newPasshash, encrypted: newEncrypted }
			} catch (err) {
				zeroize(newPasshash)
				throw err
			}
		} finally {
			zeroize(oldPasshash)
			if (unsealed) {
				zeroize(unsealed.secret)
				zeroize(unsealed.entropy)
			}
		}
	}

	/** Encrypt GUARD + secret + entropy under the given key, each AAD-bound to its purpose.
	 *  Shared between `seal` and `reseal`. Returns the persistable base64 triple. */
	private async sealInternal(
		key: EncryptionKey,
		secret: MasterSecretBytes,
		entropy: Uint8Array<ArrayBuffer>,
	): Promise<EncryptedProfileSecret> {
		if (entropy.byteLength !== 32) throw new Error("Invalid entropy length")
		const guard = await key.encrypt(ENCRYPTION_GUARD as Uint8Array<ArrayBuffer>, PROFILE_AAD.guard)
		const encryptedSecret = await key.encrypt(secret, PROFILE_AAD.secret)
		const encryptedEntropy = await key.encrypt(entropy, PROFILE_AAD.entropy)
		return {
			guard: asBase64Ciphertext(toBase64(new Uint8Array(guard.buffer))),
			secret: asBase64Ciphertext(toBase64(new Uint8Array(encryptedSecret.buffer))),
			entropy: asBase64Ciphertext(toBase64(new Uint8Array(encryptedEntropy.buffer))),
		}
	}

	/** Decrypt GUARD and verify; decrypt secret + entropy. Shared between `unseal`,
	 *  `unsealWithPasshash`, and `reseal`. Returns null on any
	 *  wrong-password / corrupted-ciphertext condition. */
	private async unsealInternal(
		key: EncryptionKey,
		encrypted: EncryptedProfileSecret,
	): Promise<{ secret: MasterSecretBytes; entropy: Uint8Array<ArrayBuffer> } | null> {
		const guard = await this.tryDecrypt(key, Buffer.from(encrypted.guard, "base64") as Uint8Array<ArrayBuffer>, PROFILE_AAD.guard)
		let secret: Uint8Array<ArrayBuffer> | undefined
		let handedOff = false
		try {
			if (!guard || !array_equals(guard, ENCRYPTION_GUARD)) {
				return null
			}
			secret = await this.tryDecrypt(key, Buffer.from(encrypted.secret, "base64") as Uint8Array<ArrayBuffer>, PROFILE_AAD.secret)
			// At this point the GUARD decrypted cleanly, so the password IS
			// correct. A null from here on means a ciphertext is corrupted or
			// was moved between slots (AAD mismatch) — surfaced as null; the
			// facade maps it to "Profile storage corrupted" at the callsite.
			if (!secret) return null
			const entropy = await this.tryDecrypt(
				key,
				Buffer.from(encrypted.entropy, "base64") as Uint8Array<ArrayBuffer>,
				PROFILE_AAD.entropy,
			)
			if (!entropy) return null
			handedOff = true
			return { secret: asMasterSecretBytes(secret), entropy }
		} finally {
			// `guard` is just ENCRYPTION_GUARD bytes (a known constant) so
			// it isn't a secret, but defensible to zero anyway — the
			// call-site invariant test asserts `zeroize` ran here.
			zeroize(guard)
			// Wipe the decrypted master on every non-handoff path: the `!entropy`
			// return AND any throw between decrypting it and handing it back
			// (e.g. a malformed/hostile entropy slot throwing in `Buffer.from`).
			if (secret && !handedOff) zeroize(secret)
		}
	}

	/** Attempts to decrypt; returns undefined on any Web Crypto failure
	 *  (wrong key / bad tag / AAD mismatch / malformed payload). Matches the
	 *  behavior of the original `ProfileService.tryDecrypt` helper. */
	private async tryDecrypt(
		key: EncryptionKey,
		payload: Uint8Array<ArrayBuffer>,
		aad: Uint8Array<ArrayBuffer>,
	): Promise<Uint8Array<ArrayBuffer> | undefined> {
		try {
			return await key.decrypt(payload, aad)
		} catch {
			return undefined
		}
	}
}
