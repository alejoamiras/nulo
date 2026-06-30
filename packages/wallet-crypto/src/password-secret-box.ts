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
import { zeroize } from "./zeroize"

/** Fixed-plaintext round-trip check. `seal` encrypts this under the
 *  derived key and persists the ciphertext as `guard`; `unseal`
 *  decrypts `guard` and compares against this constant byte-for-byte.
 *  A mismatch means the supplied password is wrong. The value itself
 *  doesn't carry secrets — it just has to be stable. Locked by the V2
 *  derivation vector and every profile row on disk. **DO NOT CHANGE.** */
export const ENCRYPTION_GUARD = new Uint8Array([6, 11, 20, 20, 22, 4, 20, 22])

/** Encrypted form of the master secret as persisted on a Profile record.
 *
 *  Fields are base64-encoded. The encoding is FROZEN — the storage-layer
 *  tests and the V2 derivation vector pin it, and every existing profile
 *  row on disk was written under this shape. Do not switch to hex / raw
 *  bytes without a migration. */
export type EncryptedProfileSecret = {
	/** Base64-encoded ciphertext of `ENCRYPTION_GUARD` under the key
	 *  derived from the profile password. On unseal this is decrypted
	 *  first and byte-compared to `ENCRYPTION_GUARD`; a mismatch means
	 *  the supplied password is wrong. */
	guard: string
	/** Base64-encoded ciphertext of the raw 32-byte master secret under
	 *  the same key as `guard`. */
	secret: string
}

/** Result of a successful `seal`. Returned to callers so they can persist
 *  `encrypted` on the `Profile` record and pass `passhash` into the
 *  SessionManager's `open` fast-path (avoiding a second PBKDF2). */
export type Sealed = {
	passhash: ArrayBuffer
	encrypted: EncryptedProfileSecret
}

export class PasswordSecretBox {
	/** Encrypts `secret` under a key derived from `password`. Returns the
	 *  base64-encoded guard+secret pair for storage plus the passhash for
	 *  the immediate session-open. */
	public async seal(password: string, secret: Uint8Array<ArrayBuffer>): Promise<Sealed> {
		const passhash = await EncryptionKey.getPasshash(password)
		const key = await EncryptionKey.fromPasshash(passhash)
		const encrypted = await this.sealInternal(key, secret)
		return { passhash, encrypted }
	}

	/** Fast path for import flows where the caller already has a
	 *  passhash (e.g. `importEncrypted` derives the hash once and
	 *  re-uses it for both the decrypt-probe and the re-seal).
	 *
	 *  ## Buffer ownership
	 *
	 *  The `passhash` and `secret` parameters are **caller-owned**.
	 *  This method does NOT zero them; the caller is responsible for
	 *  calling `zeroize(...)` after the last legitimate use. */
	public async sealWithPasshash(passhash: ArrayBuffer, secret: Uint8Array<ArrayBuffer>): Promise<EncryptedProfileSecret> {
		const key = await EncryptionKey.fromPasshash(passhash)
		return this.sealInternal(key, secret)
	}

	/** Decrypts and returns the raw master secret, or `null` if the
	 *  password is wrong or the ciphertext is corrupted. */
	public async unseal(password: string, encrypted: EncryptedProfileSecret): Promise<Uint8Array<ArrayBuffer> | null> {
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
	public async unsealWithPasshash(passhash: ArrayBuffer, encrypted: EncryptedProfileSecret): Promise<Uint8Array<ArrayBuffer> | null> {
		const key = await EncryptionKey.fromPasshash(passhash)
		return this.unsealInternal(key, encrypted)
	}

	/** Re-encrypts the master secret under a new password. Returns the
	 *  new encrypted blob + new passhash, or `null` if the old password
	 *  was wrong. Used by `changeProfilePassword`.
	 *
	 *  ## Buffer ownership
	 *
	 *  `oldPasshash` is locally derived and zeroed in finally. The
	 *  returned `passhash` (newPasshash) ESCAPES — caller owns it and
	 *  must zero it after the last legitimate use. */
	public async reseal(oldPassword: string, newPassword: string, encrypted: EncryptedProfileSecret): Promise<Sealed | null> {
		const oldPasshash = await EncryptionKey.getPasshash(oldPassword)
		let secret: Uint8Array<ArrayBuffer> | null = null
		try {
			const oldKey = await EncryptionKey.fromPasshash(oldPasshash)
			secret = await this.unsealInternal(oldKey, encrypted)
			if (!secret) return null

			const newPasshash = await EncryptionKey.getPasshash(newPassword)
			const newKey = await EncryptionKey.fromPasshash(newPasshash)
			const newEncrypted = await this.sealInternal(newKey, secret)
			return { passhash: newPasshash, encrypted: newEncrypted }
		} finally {
			zeroize(oldPasshash)
			zeroize(secret)
		}
	}

	/** Encrypt GUARD + secret under the given key. Shared between `seal`
	 *  and `reseal`. Returns the persistable base64 pair. */
	private async sealInternal(key: EncryptionKey, secret: Uint8Array<ArrayBuffer>): Promise<EncryptedProfileSecret> {
		const guard = await key.encrypt(ENCRYPTION_GUARD as Uint8Array<ArrayBuffer>)
		const encryptedSecret = await key.encrypt(secret)
		return {
			guard: toBase64(new Uint8Array(guard.buffer)),
			secret: toBase64(new Uint8Array(encryptedSecret.buffer)),
		}
	}

	/** Decrypt GUARD and verify; decrypt secret. Shared between `unseal`,
	 *  `unsealWithPasshash`, and `reseal`. Returns null on any
	 *  wrong-password / corrupted-ciphertext condition. */
	private async unsealInternal(key: EncryptionKey, encrypted: EncryptedProfileSecret): Promise<Uint8Array<ArrayBuffer> | null> {
		const guard = await this.tryDecrypt(key, Buffer.from(encrypted.guard, "base64") as Uint8Array<ArrayBuffer>)
		try {
			if (!guard || !array_equals(guard, ENCRYPTION_GUARD)) {
				return null
			}
			const secret = await this.tryDecrypt(key, Buffer.from(encrypted.secret, "base64") as Uint8Array<ArrayBuffer>)
			// At this point the GUARD decrypted cleanly, so the password IS
			// correct. A null here means the secret ciphertext is corrupted
			// (storage damage), which we still surface as null — the facade
			// maps it to "Profile storage corrupted" at the appropriate
			// callsite.
			return secret ?? null
		} finally {
			// `guard` is just ENCRYPTION_GUARD bytes (a known constant) so
			// it isn't a secret, but defensible to zero anyway — the
			// call-site invariant test asserts `zeroize` ran here.
			zeroize(guard)
		}
	}

	/** Attempts to decrypt; returns undefined on any Web Crypto failure
	 *  (wrong key / bad tag / malformed payload). Matches the behavior
	 *  of the original `ProfileService.tryDecrypt` helper. */
	private async tryDecrypt(key: EncryptionKey, payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | undefined> {
		try {
			return await key.decrypt(payload)
		} catch {
			return undefined
		}
	}
}
