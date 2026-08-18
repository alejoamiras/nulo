/**
 * Master-keyed MAC over the sealed-entropy ciphertext — the silent-restore tamper check.
 *
 * The bearer path (SW wake) restores a session from the wrapped MASTER without the password, so
 * it can never decrypt `entropy` to run the words↔master pairing check. Without this MAC, a
 * long-lived bearer would keep the wallet operating while tampered entropy silently degrades
 * recovery — failure surfacing exactly when the bearer is lost and recovery is needed (final
 * codex re-verdict C-i). Verifying `HMAC(HKDF(master), entropyCiphertext)` needs only the master
 * the bearer already carries; a mismatch must BLOCK silent restore and force a password unlock,
 * where the full pairing check fires.
 *
 * Uses `globalThis.crypto` for the same cross-env reason as `mnemonic-master.ts`.
 */
import { fromBase64, toBase64 } from "@nulo/wallet-core/utils"
import type { Base64Ciphertext, MasterSecretBytes } from "./secret-types"

const MAC_INFO = new TextEncoder().encode("nulo:entropy-mac:v1")

async function macKey(master: MasterSecretBytes): Promise<CryptoKey> {
	const ikm = await globalThis.crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveKey"])
	return globalThis.crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: MAC_INFO },
		ikm,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	)
}

/** Base64 HMAC-SHA256 tag over the sealed-entropy ciphertext, keyed from the master. */
export async function computeEntropyMac(master: MasterSecretBytes, entropyCiphertext: Base64Ciphertext): Promise<string> {
	const key = await macKey(master)
	const tag = await globalThis.crypto.subtle.sign("HMAC", key, fromBase64(entropyCiphertext))
	return toBase64(new Uint8Array(tag))
}

/** Constant-time verification via WebCrypto's own verify. */
export async function verifyEntropyMac(master: MasterSecretBytes, entropyCiphertext: Base64Ciphertext, mac: string): Promise<boolean> {
	const key = await macKey(master)
	try {
		return await globalThis.crypto.subtle.verify("HMAC", key, fromBase64(mac), fromBase64(entropyCiphertext))
	} catch {
		return false
	}
}
