import { EncryptionKey } from "@nulo/wallet-crypto"

/**
 * Recovery-secret encryption for the no-server bridge. The key is derived from
 * a deterministic L1 signature over RECOVERY_KEY_MESSAGE — same signature =>
 * same key, so a deposit's claim secret survives a refresh AND is re-derivable
 * on another device without any server. Reuses @nulo/wallet-crypto's tested
 * PBKDF2 + AES-GCM (never roll your own crypto).
 *
 * NOTE: relies on the wallet producing a DETERMINISTIC signature for the same
 * message (RFC-6979 ECDSA, as MetaMask + most wallets do). The sealed blob is a
 * BEARER credential for PRIVATE transfers (the L2 claim chooses the recipient),
 * so the UI must warn loudly before exporting it.
 */

/** The fixed, domain-separated message the user signs to derive the recovery key. */
export const RECOVERY_KEY_MESSAGE =
	"Nulo Bridge recovery key v1. Sign to encrypt your in-flight claim secrets locally. This is not a transaction and costs nothing."

function toBase64(bytes: Uint8Array): string {
	let s = ""
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
	return btoa(s)
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
	const s = atob(b64)
	const out = new Uint8Array(s.length)
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
	return out
}

/** Derive the recovery key from the user's deterministic L1 signature. */
export function recoveryKeyFromSignature(signatureHex: string): Promise<EncryptionKey> {
	return EncryptionKey.fromPassword(signatureHex)
}

/** Encrypt a claim/exit secret into the opaque base64 blob held in recovery records. */
export async function sealSecret(key: EncryptionKey, secretHex: string): Promise<string> {
	const enc = new TextEncoder().encode(secretHex)
	const bytes = new Uint8Array(enc.length)
	bytes.set(enc)
	return toBase64(await key.encrypt(bytes))
}

/** Decrypt a blob produced by `sealSecret` back into the secret. */
export async function openSecret(key: EncryptionKey, blob: string): Promise<string> {
	return new TextDecoder().decode(await key.decrypt(fromBase64(blob)))
}
