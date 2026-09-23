import { describe, expect, test } from "vitest"
import { EncryptionKey } from "./encryption-key"
import { sealImportedSigningKeyV2 } from "./imported-account-key-box"
import { sealDekUnderWrapKey } from "./imported-keys-dek-box"
import { asImportedKeysDek, asMasterSecretBytes, asPasshash } from "./secret-types"
import { SessionSecretBox } from "./session-secret-box"

/**
 * Every AES-GCM sealing box in this package must draw a FRESH RANDOM nonce per encryption.
 *
 * Nonce reuse is the one mistake in this codebase that is instantly catastrophic rather than
 * merely bad: encrypting two different plaintexts under the same (key, nonce) in GCM leaks their
 * XOR outright, and — worse — lets an attacker recover the authentication subkey, after which they
 * can forge tags at will. Confidentiality AND integrity are gone at once, with no brute force
 * involved. There is no "partially reused nonce": one repeat is enough.
 *
 * The dangerous version of this bug is not random-looking, it is DETERMINISTIC — a nonce derived
 * from the plaintext, a counter reset on service-worker restart, a zero IV left from a test. Every
 * one of those collides on the very first repeat, which is what these tests look for: seal the
 * same input repeatedly under the same key and demand that no two frames share a nonce.
 *
 * These are structural pins, not statistics. A handful of repeats already fails any deterministic
 * scheme; the sample sizes are just large enough to be convincing while staying fast.
 */

/** Frames laid out `version(1) ‖ iv(12) ‖ ct` — EncryptionKey and both DEK-rooted boxes. */
const ivFromVersionedFrame = (frame: Uint8Array): string => Buffer.from(frame.subarray(1, 13)).toString("hex")
/** The session bearer packs `iv(12) ‖ ct` and carries its version in the record instead. */
const ivFromPackedFrame = (b64: string): string => Buffer.from(b64, "base64").subarray(0, 12).toString("hex")

const PLAINTEXT = new Uint8Array(32).fill(0x5a) as Uint8Array<ArrayBuffer>

async function expectAllDistinct(label: string, ivs: string[]): Promise<void> {
	for (const iv of ivs) expect(iv, `${label}: nonce is not 12 bytes`).toHaveLength(24)
	// A zero or fixed nonce is the specific failure worth naming, since it survives review by
	// looking like a placeholder.
	expect(ivs, `${label}: all-zero nonce`).not.toContain("000000000000000000000000")
	expect(new Set(ivs).size, `${label}: repeated nonce across ${ivs.length} seals`).toBe(ivs.length)
}

describe("AES-GCM nonce uniqueness across every sealing box", () => {
	test("EncryptionKey.encrypt draws a fresh nonce per call", async () => {
		// Deliberately few rounds: this box runs PBKDF2-600k per encrypt. Any deterministic nonce
		// collides on round 2, so a small sample still catches the failure this test exists for.
		const key = await EncryptionKey.fromPasshash(asPasshash(new Uint8Array(32).fill(3).buffer))
		const ivs: string[] = []
		for (let i = 0; i < 6; i++) ivs.push(ivFromVersionedFrame(await key.encrypt(PLAINTEXT)))
		await expectAllDistinct("EncryptionKey", ivs)
	})

	test("sealDekUnderWrapKey draws a fresh nonce per call", async () => {
		const wrapKey = await globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
		const dek = asImportedKeysDek(new Uint8Array(32).fill(0x11) as Uint8Array<ArrayBuffer>)
		const ivs: string[] = []
		for (let i = 0; i < 128; i++) {
			ivs.push(ivFromVersionedFrame(Buffer.from(await sealDekUnderWrapKey(wrapKey, dek), "base64")))
		}
		await expectAllDistinct("sealDekUnderWrapKey", ivs)
	})

	test("sealImportedSigningKeyV2 draws a fresh nonce per call, same row included", async () => {
		// Same DEK, same chainId, same address on every call: the row identity is fixed, so only a
		// per-call random nonce can keep these frames apart. This is the realistic shape — a user
		// re-importing the same account, or a restore rewrapping the same row.
		const dek = asImportedKeysDek(new Uint8Array(32).fill(0x22) as Uint8Array<ArrayBuffer>)
		const ivs: string[] = []
		for (let i = 0; i < 128; i++) {
			const sealed = await sealImportedSigningKeyV2(dek, 0, "0xabc", PLAINTEXT)
			ivs.push(ivFromVersionedFrame(Buffer.from(sealed, "base64")))
		}
		await expectAllDistinct("sealImportedSigningKeyV2", ivs)
	})

	test("SessionSecretBox.wrapPair draws a fresh nonce per call", async () => {
		const box = new SessionSecretBox()
		const master = asMasterSecretBytes(new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>)
		const dek = asImportedKeysDek(new Uint8Array(32).fill(0x11) as Uint8Array<ArrayBuffer>)
		const ivs: string[] = []
		const tokens: string[] = []
		for (let i = 0; i < 128; i++) {
			const wrapped = await box.wrapPair(master, dek, "profile-p1")
			ivs.push(ivFromPackedFrame(wrapped.wrappedSecret))
			tokens.push(wrapped.token)
		}
		await expectAllDistinct("SessionSecretBox", ivs)
		// The bearer's wrap key comes from a per-bearer random token, so a repeated token would
		// re-key the whole frame even with distinct nonces.
		expect(new Set(tokens).size).toBe(tokens.length)
	})

	test("identical plaintext never produces identical ciphertext", async () => {
		// The property a reader actually cares about, stated end-to-end rather than inferred from
		// the nonce plumbing: sealing the same secret twice must not be detectable by comparison.
		const dek = asImportedKeysDek(new Uint8Array(32).fill(0x33) as Uint8Array<ArrayBuffer>)
		const a = await sealImportedSigningKeyV2(dek, 0, "0xabc", PLAINTEXT)
		const b = await sealImportedSigningKeyV2(dek, 0, "0xabc", PLAINTEXT)
		expect(a).not.toBe(b)
	})
})
