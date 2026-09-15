/**
 * Per-profile HMAC key for dApp-session row integrity (NULO-DAPPSESSION-MAC v2). Keyed by
 * `HKDF(master ‖ dek)`: a same-phrase sibling profile shares the master, so a master-only key
 * would let it forge a row that verifies under the victim — the DEK is what it lacks. The key
 * is non-extractable; a degraded session (no DEK) has no key and cannot sign or verify.
 */
import { importDualSecretHkdfKey } from "./dual-secret-hkdf"
import type { ImportedKeysDek, MasterSecretBytes } from "./secret-types"

const DAPP_SESSION_MAC_SALT = new TextEncoder().encode("nulo:dappsession-mac:salt:v2")
const DAPP_SESSION_MAC_INFO = new TextEncoder().encode("nulo:dappsession-mac:v2")

/** Exported for the key-vector pin ONLY. */
export const DAPP_SESSION_MAC_LABEL = "nulo:dappsession-mac:v2"

export async function deriveDappSessionMacKey(master: MasterSecretBytes, dek: ImportedKeysDek): Promise<CryptoKey> {
	const baseKey = await importDualSecretHkdfKey(master, dek, ["deriveKey"])
	return await crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: DAPP_SESSION_MAC_SALT, info: DAPP_SESSION_MAC_INFO },
		baseKey,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	)
}
