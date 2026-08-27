/**
 * Encrypts an IMPORTED account's Schnorr signing key at rest, bound to its row identity.
 *
 * The key is sealed under `HKDF(dek, info = "nulo:imported-account-key:v2" || chainId ||
 * address)`. The root is the profile's CREDENTIAL-sealed imported-keys DEK, never the master: two
 * profiles created from the same recovery phrase share the master, so a master-rooted key is
 * readable by the sibling profile BY CONSTRUCTION — the DEK is the isolation boundary. (Isolation
 * between same-phrase profiles therefore requires distinct CREDENTIALS; reusing one password
 * across them collapses the boundary, and is the confused-deputy case the plan records as an
 * accepted residual — that attacker can unlock the sibling profile outright anyway.)
 *
 * The per-row `info` means a ciphertext transplanted to a DIFFERENT account row (or sealed under a
 * different profile's DEK) fails to decrypt, not just fails a later address check. It deliberately
 * excludes `profileId` — full-backup restore remaps profile ids, which would otherwise strand the
 * key; a restored backup's rows are instead rewrapped from the source DEK onto the destination
 * profile's freshly minted one (clone divergence).
 *
 * Uses `globalThis.crypto` for the same cross-env reason as `mnemonic-master.ts`.
 */
import { fromBase64, toBase64 } from "@nulo/wallet-core/utils"
import type { ImportedKeysDek } from "./secret-types"
import { zeroize } from "./zeroize"

const INFO_PREFIX_V2 = "nulo:imported-account-key:v2"

async function rowKey(dek: ImportedKeysDek, chainId: number, address: string): Promise<CryptoKey> {
	const ikm = await globalThis.crypto.subtle.importKey("raw", dek, "HKDF", false, ["deriveKey"])
	const info = new TextEncoder().encode(`${INFO_PREFIX_V2}|${chainId}|${address}`)
	return globalThis.crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info },
		ikm,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	)
}

/** Seal a 32-byte signing key for `(profile DEK, chainId, address)`. Returns base64
 *  `version(1) || iv(12) || ciphertext` — that leading byte is the ENVELOPE framing version,
 *  orthogonal to the KDF-root version in the HKDF info. Caller owns + zeroes `signingKey`. */
export async function sealImportedSigningKeyV2(
	dek: ImportedKeysDek,
	chainId: number,
	address: string,
	signingKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
	const key = await rowKey(dek, chainId, address)
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
	const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, signingKey))
	const out = new Uint8Array(13 + ct.length)
	out[0] = 1
	out.set(iv, 1)
	out.set(ct, 13)
	return toBase64(out)
}

/** Unseal a signing key. Throws on wrong DEK / transplanted ciphertext / corruption (AES-GCM
 *  authentication). Caller owns + zeroes the returned buffer. */
export async function unsealImportedSigningKeyV2(
	dek: ImportedKeysDek,
	chainId: number,
	address: string,
	sealed: string,
): Promise<Uint8Array<ArrayBuffer>> {
	const bytes = fromBase64(sealed)
	try {
		if (bytes.length < 13 || bytes[0] !== 1) throw new Error("Invalid imported-key envelope")
		const iv = bytes.subarray(1, 13)
		const ct = bytes.subarray(13)
		const key = await rowKey(dek, chainId, address)
		return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct)) as Uint8Array<ArrayBuffer>
	} finally {
		// Wipe the decoded envelope on every path — the wrong-DEK / transplant /
		// corruption throw is the common adversarial case.
		zeroize(bytes)
	}
}
