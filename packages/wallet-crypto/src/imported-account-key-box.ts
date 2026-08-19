/**
 * Encrypts an IMPORTED account's Schnorr signing key at rest, bound to its row identity.
 *
 * The key is sealed under `HKDF(master, info = "nulo:imported-account-key:v1" || chainId ||
 * address)` — the per-row `info` means a ciphertext transplanted to a DIFFERENT account row (or a
 * different profile's master) fails to decrypt, not just fails a later address check. The master
 * is the profile's own secret and travels with a full backup, so imported keys survive a
 * backup/restore; `(master, chainId, address)` deliberately excludes `profileId` (full-backup
 * restore remaps profile ids, which would otherwise strand the key).
 *
 * Uses `globalThis.crypto` for the same cross-env reason as `mnemonic-master.ts`.
 */
import { fromBase64, toBase64 } from "@nulo/wallet-core/utils"
import type { ImportedKeysDek } from "./secret-types"
import { zeroize } from "./zeroize"

const INFO_PREFIX = "nulo:imported-account-key:v1"
// v2: the HKDF root is the CREDENTIAL-sealed per-profile DEK, not the master. A master-rooted
// key is decryptable by any same-phrase sibling profile by construction (shared phrase ⇒ shared
// master); the DEK is the isolation boundary. The per-row info (chainId|address, deliberately NO
// profileId) keeps the restore-id-remap survival and transplant rejection of v1.
const INFO_PREFIX_V2 = "nulo:imported-account-key:v2"

async function rowKey(ikmBytes: Uint8Array<ArrayBuffer>, infoPrefix: string, chainId: number, address: string): Promise<CryptoKey> {
	const ikm = await globalThis.crypto.subtle.importKey("raw", ikmBytes, "HKDF", false, ["deriveKey"])
	const info = new TextEncoder().encode(`${infoPrefix}|${chainId}|${address}`)
	return globalThis.crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info },
		ikm,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	)
}

/** Seal a 32-byte signing key for `(profile master, chainId, address)`. Returns base64
 *  `version(1) || iv(12) || ciphertext`. Caller owns + zeroes `signingKey`. */
export async function sealImportedSigningKey(
	master: Uint8Array<ArrayBuffer>,
	chainId: number,
	address: string,
	signingKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
	const key = await rowKey(master, INFO_PREFIX, chainId, address)
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
	const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, signingKey))
	const out = new Uint8Array(13 + ct.length)
	out[0] = 1
	out.set(iv, 1)
	out.set(ct, 13)
	return toBase64(out)
}

/** Unseal a signing key. Throws on wrong master / transplanted ciphertext / corruption (AES-GCM
 *  authentication). Caller owns + zeroes the returned buffer. */
export async function unsealImportedSigningKey(
	master: Uint8Array<ArrayBuffer>,
	chainId: number,
	address: string,
	sealed: string,
): Promise<Uint8Array<ArrayBuffer>> {
	const bytes = fromBase64(sealed)
	try {
		if (bytes.length < 13 || bytes[0] !== 1) throw new Error("Invalid imported-key envelope")
		const iv = bytes.subarray(1, 13)
		const ct = bytes.subarray(13)
		const key = await rowKey(master, INFO_PREFIX, chainId, address)
		return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct)) as Uint8Array<ArrayBuffer>
	} finally {
		// Wipe the decoded envelope on every path — including the wrong-master /
		// transplant / corruption throw, which is the common adversarial case.
		zeroize(bytes)
	}
}

/** v2 seal: the row key roots in the profile's imported-keys DEK (brand-enforced — a master can
 *  never be passed here). Returns base64 `version(1) || iv(12) || ciphertext`. Caller owns +
 *  zeroes `signingKey`. */
export async function sealImportedSigningKeyV2(
	dek: ImportedKeysDek,
	chainId: number,
	address: string,
	signingKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
	const key = await rowKey(dek, INFO_PREFIX_V2, chainId, address)
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
	const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, signingKey))
	const out = new Uint8Array(13 + ct.length)
	out[0] = 1
	out.set(iv, 1)
	out.set(ct, 13)
	return toBase64(out)
}

/** v2 unseal. Throws on wrong DEK / transplanted ciphertext / corruption (AES-GCM
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
		const key = await rowKey(dek, INFO_PREFIX_V2, chainId, address)
		return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct)) as Uint8Array<ArrayBuffer>
	} finally {
		// Wipe the decoded envelope on every path — the wrong-DEK / transplant /
		// corruption throw is the common adversarial case.
		zeroize(bytes)
	}
}
