/**
 * MAC over the ENTIRE sealed-secret envelope PLUS the row's identity — the tamper +
 * transplant + identity-swap check, verified at BOTH password unlock and silent (bearer)
 * restore.
 *
 * Without it, an attacker with storage write access could (a) tamper the sealed entropy so a
 * long-lived bearer keeps operating while recovery silently degrades, (b) transplant a single
 * authentic ciphertext (e.g. the `secret` slot) from ANOTHER profile that shares the password,
 * or (c) swap a WHOLE envelope between same-password profiles — the purpose-AADs stop (b)'s
 * cross-slot moves but neither same-slot moves nor (c).
 *
 * KEYED BY `HKDF(master ‖ dek)`, not by the master alone: the threat model's attacker HOLDS
 * the shared master (two profiles from one recovery phrase derive the same one), so a
 * master-keyed tag is forgeable BY THEM — forging additionally requires the victim's DEK, the
 * exact secret the DEK design keeps from them.
 *
 * The v3 preimage binds `profileId` FIRST and `walletFingerprint` LAST. The id kills the
 * whole-envelope swap: the tag is computed over the row's OWN storage key, so B's authentic
 * envelope pasted into A's row fails verification even though every field — including the
 * original tag — is byte-authentic. The fingerprint closes the same hole for the plaintext
 * duplicate-guard field: blinding it (to silence the duplicate warning) is now a detectable
 * tamper. Both fields are non-secret; binding them costs nothing and removes the last
 * unauthenticated inputs a storage writer could steer.
 *
 * A mismatch never profile-blocks: it opens a DERIVED-ONLY session (imported accounts
 * quarantine, no bearer is persisted) so a storage writer can't DoS the user's main funds.
 *
 * Uses `globalThis.crypto` for the same cross-env reason as `mnemonic-master.ts`.
 */
import { fromBase64, toBase64 } from "@nulo/wallet-core/utils"
import type { ImportedKeysDek, MasterSecretBytes } from "./secret-types"
import { zeroize } from "./zeroize"

// The key is HKDF(master || dek) — NOT master-only. The threat model includes an attacker who
// HOLDS the master (a same-phrase sibling profile), for whom any master-keyed MAC is forgeable;
// forging this one additionally requires the victim's DEK, the exact secret the DEK design keeps
// from them. The `:v3` label pairs with the 6-field preimage grammar (profileId first,
// fingerprint last), so retired grammars can never share a key domain with it.
const MAC_INFO_V3 = new TextEncoder().encode("nulo:envelope-mac:v3")

/** The envelope: the four sealed base64 slots plus the plaintext wallet fingerprint, in
 *  canonical order. */
export type MacEnvelopeV3 = {
	guard: string
	secret: string
	entropy: string
	dek: string
	walletFingerprint: string
}

function preimageV3(profileId: string, env: MacEnvelopeV3): Uint8Array<ArrayBuffer> {
	// `.` is not in the base64 alphabet and profile ids / fingerprints are hex-or-numeric
	// storage keys, so the 6-field concatenation is unambiguous — and no shorter grammar's
	// preimage can collide with a v3 one even byte-wise. The key domains are separated
	// regardless (MAC_INFO_V3).
	return new TextEncoder().encode(
		`${profileId}.${env.guard}.${env.secret}.${env.entropy}.${env.dek}.${env.walletFingerprint}`,
	) as Uint8Array<ArrayBuffer>
}

async function macKeyV3(master: MasterSecretBytes, dek: ImportedKeysDek): Promise<CryptoKey> {
	// Brands erase at runtime — enforce the fixed 32+32 concat contract, or two distinct
	// (master, dek) splits of the same bytes would derive the same key (P3 rider Medium).
	if (master.length !== 32 || dek.length !== 32) {
		throw new Error("envelope MAC v3 requires 32-byte master and dek")
	}
	const ikmBytes = new Uint8Array(master.length + dek.length) as Uint8Array<ArrayBuffer>
	ikmBytes.set(master, 0)
	ikmBytes.set(dek, master.length)
	try {
		const ikm = await globalThis.crypto.subtle.importKey("raw", ikmBytes, "HKDF", false, ["deriveKey"])
		return await globalThis.crypto.subtle.deriveKey(
			{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: MAC_INFO_V3 },
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

/** v3 tag over `(profileId, four-slot envelope, fingerprint)`, keyed by HKDF(master||dek).
 *  Both key inputs caller-owned. */
export async function computeEnvelopeMacV3(
	profileId: string,
	master: MasterSecretBytes,
	dek: ImportedKeysDek,
	env: MacEnvelopeV3,
): Promise<string> {
	const key = await macKeyV3(master, dek)
	const tag = await globalThis.crypto.subtle.sign("HMAC", key, preimageV3(profileId, env))
	return toBase64(new Uint8Array(tag))
}

/** Constant-time v3 verification via WebCrypto's own verify. */
export async function verifyEnvelopeMacV3(
	profileId: string,
	master: MasterSecretBytes,
	dek: ImportedKeysDek,
	env: MacEnvelopeV3,
	mac: string,
): Promise<boolean> {
	const key = await macKeyV3(master, dek)
	try {
		return await globalThis.crypto.subtle.verify("HMAC", key, fromBase64(mac), preimageV3(profileId, env))
	} catch {
		return false
	}
}
