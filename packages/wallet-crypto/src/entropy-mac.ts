/**
 * Master-keyed MAC over the ENTIRE sealed-secret envelope — the silent-restore + transplant
 * tamper check.
 *
 * The bearer path (SW wake) restores a session from the wrapped MASTER without the password, so
 * it can never decrypt the sealed fields to run the words↔master pairing check. Without this MAC,
 * an attacker with storage write access could (a) tamper the sealed entropy so a long-lived bearer
 * keeps operating while recovery silently degrades, or (b) transplant a single authentic ciphertext
 * (e.g. the `secret` slot) from ANOTHER profile that shares the password — purpose-AAD blocks
 * slot-swaps but not same-slot cross-profile moves (final-codex re-verdict, P3 rider High).
 *
 * MACing a canonical encoding of the whole envelope (guard‖secret‖entropy), keyed by the master
 * the bearer already carries, means the stored MAC only verifies for the exact envelope that
 * master minted: any transplanted or mutated ciphertext fails it. A mismatch BLOCKS silent restore
 * and forces a password unlock, where the full pairing check fires.
 *
 * Uses `globalThis.crypto` for the same cross-env reason as `mnemonic-master.ts`.
 */
import { fromBase64, toBase64 } from "@nulo/wallet-core/utils"
import type { ImportedKeysDek, MasterSecretBytes } from "./secret-types"
import { zeroize } from "./zeroize"

const MAC_INFO = new TextEncoder().encode("nulo:envelope-mac:v1")
// v2: the key is HKDF(master || dek) — NOT master-only. The v2 threat model includes an attacker
// who HOLDS the master (a same-phrase sibling profile), for whom any master-keyed MAC is
// forgeable; forging v2 additionally requires the victim's DEK, the exact secret the DEK design
// keeps from them. The info label bumps WITH the preimage grammar so the two versions never share
// a key domain.
const MAC_INFO_V2 = new TextEncoder().encode("nulo:envelope-mac:v2")

/** The three sealed base64 ciphertexts, in the order the MAC canonicalizes them. */
export type MacEnvelope = { guard: string; secret: string; entropy: string }

/** Canonical preimage: the three base64 ciphertexts joined by `.` — a byte NOT in the base64
 *  alphabet, so the concatenation is unambiguous. */
function preimage(env: MacEnvelope): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(`${env.guard}.${env.secret}.${env.entropy}`) as Uint8Array<ArrayBuffer>
}

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

/** Base64 HMAC-SHA256 tag over the whole sealed envelope, keyed from the master. */
export async function computeEnvelopeMac(master: MasterSecretBytes, env: MacEnvelope): Promise<string> {
	const key = await macKey(master)
	const tag = await globalThis.crypto.subtle.sign("HMAC", key, preimage(env))
	return toBase64(new Uint8Array(tag))
}

/** Constant-time verification via WebCrypto's own verify. */
export async function verifyEnvelopeMac(master: MasterSecretBytes, env: MacEnvelope, mac: string): Promise<boolean> {
	const key = await macKey(master)
	try {
		return await globalThis.crypto.subtle.verify("HMAC", key, fromBase64(mac), preimage(env))
	} catch {
		return false
	}
}

/** The v2 envelope: the four sealed base64 slots, in canonical order. */
export type MacEnvelopeV2 = { guard: string; secret: string; entropy: string; dek: string }

function preimageV2(env: MacEnvelopeV2): Uint8Array<ArrayBuffer> {
	// `.` is not in the base64 alphabet, so the 4-field concatenation is unambiguous — and no v1
	// (3-field) preimage can collide with a v2 one even byte-wise, since a base64 field can never
	// contain the extra separator. The key domains are separated regardless (MAC_INFO_V2).
	return new TextEncoder().encode(`${env.guard}.${env.secret}.${env.entropy}.${env.dek}`) as Uint8Array<ArrayBuffer>
}

async function macKeyV2(master: MasterSecretBytes, dek: ImportedKeysDek): Promise<CryptoKey> {
	const ikmBytes = new Uint8Array(master.length + dek.length) as Uint8Array<ArrayBuffer>
	ikmBytes.set(master, 0)
	ikmBytes.set(dek, master.length)
	try {
		const ikm = await globalThis.crypto.subtle.importKey("raw", ikmBytes, "HKDF", false, ["deriveKey"])
		return await globalThis.crypto.subtle.deriveKey(
			{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: MAC_INFO_V2 },
			ikm,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign", "verify"],
		)
	} finally {
		// The concatenated IKM copy is secret material; the engine holds it inside `ikm`.
		zeroize(ikmBytes)
	}
}

/** v2 tag over the four-slot envelope, keyed by HKDF(master||dek). Both inputs caller-owned. */
export async function computeEnvelopeMacV2(master: MasterSecretBytes, dek: ImportedKeysDek, env: MacEnvelopeV2): Promise<string> {
	const key = await macKeyV2(master, dek)
	const tag = await globalThis.crypto.subtle.sign("HMAC", key, preimageV2(env))
	return toBase64(new Uint8Array(tag))
}

/** Constant-time v2 verification via WebCrypto's own verify. */
export async function verifyEnvelopeMacV2(
	master: MasterSecretBytes,
	dek: ImportedKeysDek,
	env: MacEnvelopeV2,
	mac: string,
): Promise<boolean> {
	const key = await macKeyV2(master, dek)
	try {
		return await globalThis.crypto.subtle.verify("HMAC", key, fromBase64(mac), preimageV2(env))
	} catch {
		return false
	}
}
