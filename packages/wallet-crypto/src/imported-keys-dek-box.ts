/**
 * Seals the per-profile imported-keys DEK under a CREDENTIAL-derived AES-GCM key — the 4th
 * profile-row slot.
 *
 * The DEK is the HKDF root for imported signing-key rows (`imported-account-key-box`, v2 info).
 * It is deliberately credential-rooted, never master-derived: two profiles created from the same
 * recovery phrase share the master, so any master-rooted key is decryptable by the sibling
 * profile BY CONSTRUCTION — the credential (password / passkey PRF) is the only input that
 * distinguishes them.
 *
 * Wrap-key sources (per profile variant):
 *   password: `EncryptionKey.fromPasshash(...)` sealing via its own `encrypt(payload, DEK_AAD)`
 *             (the audited PBKDF2 + AES-GCM path — no new crypto for that branch);
 *   passkey:  `PasskeyCredential.deriveDekWrapKey()` (HKDF → AES-GCM CryptoKey), sealed with the
 *             functions in THIS module.
 *
 * Envelope (this module): base64 `version(1) || iv(12) || ciphertext`, AAD = `DEK_AAD` — a wrong
 * wrap key (a sibling profile's ceremony), a slot transplant, or corruption all fail AES-GCM
 * authentication closed. Uses `globalThis.crypto` for the same cross-env reason as
 * `mnemonic-master.ts`.
 */
import { fromBase64, toBase64 } from "@nulo/wallet-core/utils"
import { asImportedKeysDek, type ImportedKeysDek } from "./secret-types"
import { zeroize } from "./zeroize"

/** Purpose-AAD for the sealed DEK slot — shared by BOTH wrap paths (EncryptionKey for password
 *  profiles, the CryptoKey functions below for passkey profiles) so the slot can never be
 *  satisfied by a ciphertext minted for another purpose. Byte-frozen once profiles exist. */
export const IMPORTED_DEK_AAD = new TextEncoder().encode("nulo:profile-imported-dek:v1") as Uint8Array<ArrayBuffer>

export const IMPORTED_KEYS_DEK_LEN = 32

/** Mint a fresh random DEK (CSPRNG, full 256-bit). */
export function generateImportedKeysDek(): ImportedKeysDek {
	return asImportedKeysDek(globalThis.crypto.getRandomValues(new Uint8Array(IMPORTED_KEYS_DEK_LEN)))
}

/** Seal a DEK under an AES-GCM wrap key (the passkey branch's `deriveDekWrapKey` output).
 *  Caller owns + zeroes `dek`. */
export async function sealDekUnderWrapKey(wrapKey: CryptoKey, dek: ImportedKeysDek): Promise<string> {
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
	const ct = new Uint8Array(
		await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: IMPORTED_DEK_AAD }, wrapKey, dek),
	)
	const out = new Uint8Array(13 + ct.length)
	out[0] = 1
	out.set(iv, 1)
	out.set(ct, 13)
	return toBase64(out)
}

/** Unseal a DEK. Throws on wrong wrap key / transplant / corruption (AES-GCM authentication) and
 *  on a wrong-length plaintext. Caller owns + zeroes the returned buffer. */
export async function unsealDekUnderWrapKey(wrapKey: CryptoKey, sealed: string): Promise<ImportedKeysDek> {
	const bytes = fromBase64(sealed)
	try {
		if (bytes.length < 13 || bytes[0] !== 1) throw new Error("Invalid imported-dek envelope")
		const iv = bytes.subarray(1, 13)
		const ct = bytes.subarray(13)
		const pt = new Uint8Array(
			await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: IMPORTED_DEK_AAD }, wrapKey, ct),
		) as Uint8Array<ArrayBuffer>
		if (pt.length !== IMPORTED_KEYS_DEK_LEN) {
			zeroize(pt)
			throw new Error("Invalid imported-dek length")
		}
		return asImportedKeysDek(pt)
	} finally {
		// Wipe the decoded envelope on every path — including the wrong-wrap-key /
		// transplant / corruption throw, which is the common adversarial case.
		zeroize(bytes)
	}
}
