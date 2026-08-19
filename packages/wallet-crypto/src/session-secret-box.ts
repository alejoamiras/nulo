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

import { asImportedKeysDek, asMasterSecretBytes, type ImportedKeysDek, type MasterSecretBytes } from "./secret-types"
import { zeroize } from "./zeroize"

/** The wrapped payload is always the 32-byte BN254 master secret (an `Fr`).
 *  `unwrap` enforces this length so a crafted/corrupt bearer that decrypts to a
 *  wrong-length plaintext returns `null` — instead of yielding a buffer that
 *  throws in `Fr.fromBuffer` at the restore site and aborts service init. */
const MASTER_SECRET_LEN = 32
/** v2 payload: fixed 32+32 `master || dek` — one wrap, so restore is atomic (no state where the
 *  master restores but the DEK doesn't, which would yield a working session with silently-dead
 *  imported accounts). */
const PAIR_LEN = 64

/** Persisted, base64-encoded silent-restore bearer. Stored in the ephemeral
 *  `chrome.storage.session` Session record. */
export type SessionWrappedSecret = {
	/** Bearer format version. `1` = master-only (legacy, rejected by `unwrapPair`);
	 *  `2` = the `master || dek` pair. A version mismatch → `null` → silentClose → re-unlock. */
	v: 1 | 2
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
	 * Wrap the `master || dek` pair under a fresh random token (v2 bearer). ONE AES-GCM frame on
	 * purpose: restore is atomic — either both secrets come back or neither does. Both inputs are
	 * caller-owned (caller zeroizes after this returns).
	 */
	public async wrapPair(master: MasterSecretBytes, dek: ImportedKeysDek, aad: string): Promise<SessionWrappedSecret> {
		// Brands erase at runtime — enforce the fixed 32+32 contract here, or a short input would
		// silently zero-pad and unwrap into a "valid" branded secret (P3 rider Medium).
		if (master.length !== MASTER_SECRET_LEN || dek.length !== MASTER_SECRET_LEN) {
			throw new Error("wrapPair requires 32-byte master and dek")
		}
		let pair: Uint8Array<ArrayBuffer> | undefined
		const token = crypto.getRandomValues(new Uint8Array(32))
		const salt = crypto.getRandomValues(new Uint8Array(32))
		const iv = crypto.getRandomValues(new Uint8Array(12))
		try {
			// Copy INSIDE the protected block so any throw from here on zeroizes it (rider Low).
			pair = new Uint8Array(PAIR_LEN) as Uint8Array<ArrayBuffer>
			pair.set(master, 0)
			pair.set(dek, MASTER_SECRET_LEN)
			const key = await deriveWrapKey(token, salt)
			const ct = new Uint8Array(
				await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, pair),
			)
			const packed = new Uint8Array(iv.length + ct.length)
			packed.set(iv, 0)
			packed.set(ct, iv.length)
			return {
				v: 2,
				token: Buffer.from(token).toString("base64"),
				salt: Buffer.from(salt).toString("base64"),
				wrappedSecret: Buffer.from(packed).toString("base64"),
			}
		} finally {
			zeroize(pair)
			zeroize(token)
			zeroize(salt)
		}
	}

	/**
	 * Recover the v2 pair. Returns `null` (never throws) on a malformed bearer, a NON-v2 version
	 * (a legacy v1 master-only record must silentClose into a full re-unlock, never yield a
	 * dek-less session), wrong `aad`, a bad tag, or a wrong-length plaintext.
	 */
	public async unwrapPair(
		wrapped: SessionWrappedSecret,
		aad: string,
	): Promise<{ master: MasterSecretBytes; dek: ImportedKeysDek } | null> {
		if (wrapped?.v !== 2) return null
		let token: Uint8Array<ArrayBuffer> | undefined
		let salt: Uint8Array<ArrayBuffer> | undefined
		let pt: ArrayBuffer | undefined
		try {
			let packed: Uint8Array<ArrayBuffer>
			try {
				token = new Uint8Array(Buffer.from(wrapped.token, "base64"))
				salt = new Uint8Array(Buffer.from(wrapped.salt, "base64"))
				packed = new Uint8Array(Buffer.from(wrapped.wrappedSecret, "base64"))
			} catch {
				return null
			}
			if (token.length !== 32 || salt.length !== 32 || packed.length < 12 + 16) {
				return null
			}
			const iv = packed.slice(0, 12)
			const ct = packed.slice(12)
			try {
				const key = await deriveWrapKey(token, salt)
				pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, ct)
				if (pt.byteLength !== PAIR_LEN) {
					zeroize(pt)
					return null
				}
				const bytes = new Uint8Array(pt)
				const master = asMasterSecretBytes(new Uint8Array(bytes.subarray(0, MASTER_SECRET_LEN)))
				const dek = asImportedKeysDek(new Uint8Array(bytes.subarray(MASTER_SECRET_LEN)))
				zeroize(pt)
				return { master, dek }
			} catch {
				return null
			}
		} finally {
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
