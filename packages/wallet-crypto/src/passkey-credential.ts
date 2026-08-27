import {
	asBase64CredentialId,
	asHexUserHandle,
	asMasterSecretBytes,
	type Base64CredentialId,
	type Base64SecretPrf,
	type HexUserHandle,
	type MasterSecretBytes,
} from "./secret-types"
import { Fr } from "@aztec/foundation/curves/bn254"
import { fromBase64 } from "@nulo/wallet-core/utils"
import { zeroize } from "./zeroize"

/** Raw passkey output returned by the WebAuthn PRF extension, as
 *  shuttled from the popup back to the background / crypto layer.
 *  All three fields are wire-safe strings. */
export type PasskeyCredentialData = {
	/** WebAuthn credential id (base64). */
	id: Base64CredentialId
	/** PRF eval output (base64). Secret IKM for HKDF. */
	prf: Base64SecretPrf
	/** Optional userHandle tying the credential to a profile (hex). */
	userHandle?: HexUserHandle
}

const te = new TextEncoder()

// SECURITY: Domain separators in the key derivation chain. Changing these labels
// produces different keys and invalidates every existing passkey wallet.
const PASSKEY_KDF_LABEL = te.encode("nulo:kdf:v1")
const PASSKEY_MASTER_LABEL = te.encode("nulo:master:v1")
// Separate expand-info for the imported-keys-DEK wrap key: same HKDF extract (baseKey + salt),
// a DISTINCT expand, so the wrap key never coincides with (or leaks) the master derivation.
const PASSKEY_DEK_WRAP_LABEL = te.encode("nulo:dek-wrap:v1")

export class PasskeyCredential {
	public readonly id: Base64CredentialId
	public readonly userHandle?: HexUserHandle
	private baseKey: CryptoKey
	private salt: ArrayBuffer

	private constructor(id: Base64CredentialId, baseKey: CryptoKey, salt: ArrayBuffer, userHandle?: HexUserHandle) {
		this.id = id
		this.userHandle = userHandle
		this.baseKey = baseKey
		this.salt = salt
	}

	public static async create(params: { id: string; prf: string; userHandle?: string }): Promise<PasskeyCredential> {
		const ikm = fromBase64(params.prf)
		try {
			const credential = fromBase64(params.id)
			const saltInput = Buffer.concat([PASSKEY_KDF_LABEL, credential])
			// "deriveKey" alongside "deriveBits": deriveMasterSecret uses deriveBits; the
			// imported-keys-DEK wrap key below is derived as a non-extractable CryptoKey.
			const baseKey = await globalThis.crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits", "deriveKey"])
			const salt = await globalThis.crypto.subtle.digest("SHA-256", saltInput)
			return new PasskeyCredential(
				asBase64CredentialId(params.id),
				baseKey,
				salt,
				params.userHandle === undefined ? undefined : asHexUserHandle(params.userHandle),
			)
		} finally {
			// PRF input keying material — engine has it inside `baseKey` after
			// `importKey`, but the local copy we passed in is no longer needed.
			// `params.prf` (base64 string) is immutable + caller-owned; can't
			// zero from here.
			zeroize(ikm)
		}
	}

	public async deriveMasterSecret(): Promise<MasterSecretBytes> {
		// 512-bit expand before the field reduce — HKDF-Expand output is IND-random, so a
		// 64-byte input gives reduce bias ≤ ~2^-258 (the same low-skew form the mnemonic path
		// uses in mnemonic-master.ts). A 256-bit expand was rejected: reducing 32 bytes mod Fr
		// leaves residues with 5 or 6 preimages — a 20% relative skew and 253.415-bit
		// min-entropy (the high-skew case upstream warns about).
		const masterBits = await globalThis.crypto.subtle.deriveBits(
			{ name: "HKDF", hash: "SHA-256", salt: this.salt, info: PASSKEY_MASTER_LABEL },
			this.baseKey,
			512,
		)
		// Named copy for the Buffer view Fr reads from — it is master-equivalent OKM and must be
		// wiped alongside the deriveBits output (mnemonic-master.ts's seed64Copy pattern; an
		// anonymous `Buffer.from(...)` inline would survive un-zeroized until GC).
		const masterBitsCopy = Buffer.from(new Uint8Array(masterBits))
		try {
			const masterFr = Fr.fromBufferReduce(masterBitsCopy)
			// `masterFr.toBuffer()` allocates a fresh Buffer; the returned
			// reference is the caller's responsibility to zero.
			return asMasterSecretBytes(masterFr.toBuffer() as Buffer<ArrayBuffer>)
		} finally {
			// Fr made its own copy (verified by the `Fr.fromBufferReduce` 64-byte
			// test in zeroize.test.ts) — both local OKM buffers are dead here.
			zeroize(masterBits)
			zeroize(masterBitsCopy)
		}
	}

	/**
	 * Derive the AES-GCM wrap key for this profile's imported-keys DEK slot
	 * (`imported-keys-dek-box`). Same HKDF extract as `deriveMasterSecret`, a distinct expand
	 * (`nulo:dek-wrap:v1`) — the wrap key and the master derivation can never coincide. The key is
	 * non-extractable and lives only while the ceremony's credential is in scope; re-running the
	 * ceremony with the SAME credential reproduces it exactly (deterministic salt + info), which
	 * is what lets a passkey backup carry the SEALED dek blob verbatim.
	 */
	public async deriveDekWrapKey(): Promise<CryptoKey> {
		return globalThis.crypto.subtle.deriveKey(
			{ name: "HKDF", hash: "SHA-256", salt: this.salt, info: PASSKEY_DEK_WRAP_LABEL },
			this.baseKey,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"],
		)
	}
}
