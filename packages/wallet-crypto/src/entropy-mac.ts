/**
 * MAC over the ENTIRE sealed-secret envelope — the tamper + transplant check, verified at BOTH
 * password unlock and silent (bearer) restore.
 *
 * Without it, an attacker with storage write access could (a) tamper the sealed entropy so a
 * long-lived bearer keeps operating while recovery silently degrades, or (b) transplant a single
 * authentic ciphertext (e.g. the `secret` slot) from ANOTHER profile that shares the password —
 * purpose-AAD blocks slot-swaps but not same-slot cross-profile moves.
 *
 * KEYED BY `HKDF(master ‖ dek)`, not by the master alone: the threat model's attacker HOLDS the
 * shared master (two profiles from one recovery phrase derive the same one), so a master-keyed tag
 * is forgeable BY THEM — they could tamper a victim's envelope and recompute a valid MAC. Binding
 * the profile's credential-sealed DEK into the key means forging requires the one secret they
 * don't have. A mismatch never profile-blocks: it opens a DERIVED-ONLY session (imported accounts
 * quarantine, no bearer persisted) so a storage writer can't DoS the user's main funds.
 *
 * Uses `globalThis.crypto` for the same cross-env reason as `mnemonic-master.ts`.
 */
import { fromBase64, toBase64 } from "@nulo/wallet-core/utils"
import type { ImportedKeysDek, MasterSecretBytes } from "./secret-types"
import { zeroize } from "./zeroize"

// The key is HKDF(master || dek) — NOT master-only. The threat model includes an attacker who
// HOLDS the master (a same-phrase sibling profile), for whom any master-keyed MAC is forgeable;
// forging this one additionally requires the victim's DEK, the exact secret the DEK design keeps
// from them. The `:v2` label pairs with the 4-slot preimage grammar, so the retired master-keyed
// 3-slot construction can never share a key domain with it.
const MAC_INFO_V2 = new TextEncoder().encode("nulo:envelope-mac:v2")

/** The envelope: the four sealed base64 slots, in canonical order. */
export type MacEnvelopeV2 = { guard: string; secret: string; entropy: string; dek: string }

function preimageV2(env: MacEnvelopeV2): Uint8Array<ArrayBuffer> {
	// `.` is not in the base64 alphabet, so the 4-field concatenation is unambiguous — and no v1
	// (3-field) preimage can collide with a v2 one even byte-wise, since a base64 field can never
	// contain the extra separator. The key domains are separated regardless (MAC_INFO_V2).
	return new TextEncoder().encode(`${env.guard}.${env.secret}.${env.entropy}.${env.dek}`) as Uint8Array<ArrayBuffer>
}

async function macKeyV2(master: MasterSecretBytes, dek: ImportedKeysDek): Promise<CryptoKey> {
	// Brands erase at runtime — enforce the fixed 32+32 concat contract, or two distinct
	// (master, dek) splits of the same bytes would derive the same key (P3 rider Medium).
	if (master.length !== 32 || dek.length !== 32) {
		throw new Error("envelope MAC v2 requires 32-byte master and dek")
	}
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
