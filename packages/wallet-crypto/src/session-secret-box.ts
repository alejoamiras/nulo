/**
 * `SessionSecretBox` — F-11 silent-restore bearer.
 *
 * Wraps the profile master secret under a FRESH RANDOM 256-bit token (via
 * HKDF-SHA256 → AES-GCM), replacing the previous bearer which persisted the
 * raw `passhash` (an unsalted `SHA-256(password)` — password-equivalent, so a
 * `chrome.storage.session` leak yielded a value reusable/brute-forceable back
 * to the password). The token is random and not password-derived, so a session
 * leak no longer exposes the password.
 *
 * NOT built on `PasswordSecretBox`/`EncryptionKey`: those run PBKDF2 (~600k
 * rounds) for password stretching, which is pointless for a random 256-bit
 * token and would blur the profile-record crypto domain with the ephemeral
 * session-bearer domain.
 *
 * Threat-model honesty: `token` + `wrappedSecret` live together in the Session
 * record, so a session-store leak still recovers the master secret — that is
 * the definition of a silent-restore bearer and is unchanged from before. The
 * win is narrow-but-real: no password-equivalent value in the session.
 */

import { asMasterSecretBytes, type MasterSecretBytes } from "./secret-types"
import { zeroize } from "./zeroize"

/** The wrapped payload is always the 32-byte BN254 master secret (an `Fr`).
 *  `unwrap` enforces this length so a crafted/corrupt bearer that decrypts to a
 *  wrong-length plaintext returns `null` — instead of yielding a buffer that
 *  throws in `Fr.fromBuffer` at the restore site and aborts service init. */
const MASTER_SECRET_LEN = 32

/** Persisted, base64-encoded silent-restore bearer. Stored in the ephemeral
 *  `chrome.storage.session` Session record. */
export type SessionWrappedSecret = {
	/** Bearer format version. Only `1` is accepted; anything else → reject. */
	v: 1
	/** base64 of 32 random bytes — the HKDF input keying material. */
	token: string
	/** base64 of 32 random bytes — the per-bearer HKDF salt. */
	salt: string
	/** base64 of `[iv(12) || AES-GCM(ciphertext||tag)]`. */
	wrappedSecret: string
}

const SESSION_WRAP_INFO = new TextEncoder().encode("nulo:session-wrap:v1")

async function deriveWrapKey(token: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
	const baseKey = await crypto.subtle.importKey("raw", token, "HKDF", false, ["deriveKey"])
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt, info: SESSION_WRAP_INFO },
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	)
}

export class SessionSecretBox {
	/**
	 * Wrap `secret` under a fresh random token. `aad` binds the ciphertext to a
	 * context (the profile id) so a bearer can't be replayed against a different
	 * profile. `secret` is caller-owned (caller zeroizes it after this returns).
	 */
	public async wrap(secret: MasterSecretBytes, aad: string): Promise<SessionWrappedSecret> {
		const token = crypto.getRandomValues(new Uint8Array(32))
		const salt = crypto.getRandomValues(new Uint8Array(32))
		const iv = crypto.getRandomValues(new Uint8Array(12))
		try {
			const key = await deriveWrapKey(token, salt)
			const ct = new Uint8Array(
				await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, secret),
			)
			const packed = new Uint8Array(iv.length + ct.length)
			packed.set(iv, 0)
			packed.set(ct, iv.length)
			return {
				v: 1,
				token: Buffer.from(token).toString("base64"),
				salt: Buffer.from(salt).toString("base64"),
				wrappedSecret: Buffer.from(packed).toString("base64"),
			}
		} finally {
			// The base64 `token`/`salt` copies are already in the returned object;
			// wipe our binary copies so they don't linger in the GC heap.
			zeroize(token)
			zeroize(salt)
		}
	}

	/**
	 * Recover the wrapped secret. Returns `null` (never throws) on a malformed
	 * bearer, wrong version, wrong `aad`, or a bad AES-GCM tag — the caller
	 * (`SessionManager.restore`) treats `null` as "close the session".
	 */
	public async unwrap(wrapped: SessionWrappedSecret, aad: string): Promise<MasterSecretBytes | null> {
		if (wrapped?.v !== 1) return null
		// One outer try/finally so `token`/`salt` are ALWAYS zeroized — including
		// the partial-decode path (a valid `token` followed by a non-string
		// `salt`/`wrappedSecret` that throws) which previously returned from the
		// decode catch before either buffer was wiped.
		let token: Uint8Array<ArrayBuffer> | undefined
		let salt: Uint8Array<ArrayBuffer> | undefined
		try {
			let packed: Uint8Array<ArrayBuffer>
			try {
				token = new Uint8Array(Buffer.from(wrapped.token, "base64"))
				salt = new Uint8Array(Buffer.from(wrapped.salt, "base64"))
				packed = new Uint8Array(Buffer.from(wrapped.wrappedSecret, "base64"))
			} catch {
				return null
			}
			// 32-byte token/salt; packed = iv(12) + at least the 16-byte GCM tag.
			if (token.length !== 32 || salt.length !== 32 || packed.length < 12 + 16) {
				return null
			}
			const iv = packed.slice(0, 12)
			const ct = packed.slice(12)
			try {
				const key = await deriveWrapKey(token, salt)
				const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, ct)
				// A validly-tagged but crafted/corrupt bearer could decrypt to a
				// wrong-length buffer; reject it here so the caller `silentClose`s
				// rather than crashing in `Fr.fromBuffer` (needs exactly 32 bytes).
				// A 32-byte value ≥ the BN254 modulus is caught at the restore
				// boundary (`Fr.fromBuffer` try/catch → silentClose).
				if (pt.byteLength !== MASTER_SECRET_LEN) return null
				return asMasterSecretBytes(new Uint8Array(pt))
			} catch {
				return null
			}
		} finally {
			zeroize(token)
			zeroize(salt)
		}
	}
}
