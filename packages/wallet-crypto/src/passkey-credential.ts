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
			const baseKey = await globalThis.crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
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
		// leaves a ~2^-1.6-scale relative bias (the high-skew case upstream warns about).
		const masterBits = await globalThis.crypto.subtle.deriveBits(
			{ name: "HKDF", hash: "SHA-256", salt: this.salt, info: PASSKEY_MASTER_LABEL },
			this.baseKey,
			512,
		)
		try {
			const masterFr = Fr.fromBufferReduce(Buffer.from(new Uint8Array(masterBits)))
			// `masterFr.toBuffer()` allocates a fresh Buffer; the returned
			// reference is the caller's responsibility to zero.
			return asMasterSecretBytes(masterFr.toBuffer() as Buffer<ArrayBuffer>)
		} finally {
			// The deriveBits ArrayBuffer is no longer needed — Fr made its
			// own copy (verified by `Fr.fromBufferReduce` test in
			// zeroize.test.ts).
			zeroize(masterBits)
		}
	}
}
