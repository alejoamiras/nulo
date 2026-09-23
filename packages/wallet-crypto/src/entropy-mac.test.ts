import { createHmac, hkdfSync } from "node:crypto"
import { describe, expect, test } from "vitest"
import { computeEnvelopeMacV3, type MacEnvelopeV3, verifyEnvelopeMacV3 } from "./entropy-mac"
import { asImportedKeysDek, asMasterSecretBytes } from "./secret-types"

const MASTER = asMasterSecretBytes(new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>)
const OTHER_MASTER = asMasterSecretBytes(new Uint8Array(32).fill(8) as Uint8Array<ArrayBuffer>)
const b64 = (fill: number) => Buffer.from(new Uint8Array(61).fill(fill)).toString("base64")

const DEK = asImportedKeysDek(new Uint8Array(32).fill(0x11) as Uint8Array<ArrayBuffer>)
const OTHER_DEK = asImportedKeysDek(new Uint8Array(32).fill(0x12) as Uint8Array<ArrayBuffer>)
const ENV_V3: MacEnvelopeV3 = {
	guard: b64(0x2a),
	secret: b64(0x2b),
	entropy: b64(0x2c),
	dek: b64(0x2d),
	walletFingerprint: "f".repeat(64),
}

describe("envelope MAC v3 (DEK-keyed + identity-bound — the same-phrase attacker HOLDS the master)", () => {
	test("round-trips: compute then verify", async () => {
		const mac = await computeEnvelopeMacV3("profile-1", MASTER, DEK, ENV_V3)
		expect(await verifyEnvelopeMacV3("profile-1", MASTER, DEK, ENV_V3, mac)).toBe(true)
	})

	test("a transplanted/tampered ciphertext in ANY of the five covered fields fails verification", async () => {
		const mac = await computeEnvelopeMacV3("profile-1", MASTER, DEK, ENV_V3)
		expect(await verifyEnvelopeMacV3("profile-1", MASTER, DEK, { ...ENV_V3, guard: b64(0x99) }, mac)).toBe(false)
		expect(await verifyEnvelopeMacV3("profile-1", MASTER, DEK, { ...ENV_V3, secret: b64(0x99) }, mac)).toBe(false)
		expect(await verifyEnvelopeMacV3("profile-1", MASTER, DEK, { ...ENV_V3, entropy: b64(0x99) }, mac)).toBe(false)
		expect(await verifyEnvelopeMacV3("profile-1", MASTER, DEK, { ...ENV_V3, dek: b64(0x99) }, mac)).toBe(false)
		// F-2: blinding the plaintext duplicate-guard field is a detectable tamper.
		expect(await verifyEnvelopeMacV3("profile-1", MASTER, DEK, { ...ENV_V3, walletFingerprint: "0".repeat(64) }, mac)).toBe(false)
	})

	test("WHOLE-ENVELOPE SWAP fails: B's authentic envelope + tag pasted under A's id does not verify", async () => {
		// The F-1 attack: every sealed byte AND the original tag are genuine — they belong to
		// profile-B. Verification runs against the ROW's own id ("profile-A"), which the tag
		// never covered. A self-contained row-level check cannot catch this; the id binding can.
		const profileB = await computeEnvelopeMacV3("profile-B", MASTER, DEK, ENV_V3)
		expect(await verifyEnvelopeMacV3("profile-A", MASTER, DEK, ENV_V3, profileB)).toBe(false)
		// The honest row still verifies under its OWN id (the failure above is the swap, not the scheme).
		expect(await verifyEnvelopeMacV3("profile-B", MASTER, DEK, ENV_V3, profileB)).toBe(true)
	})

	test("MASTER-HOLDER FORGERY fails: knowing the master without the victim's DEK cannot mint a valid tag", async () => {
		// The threat model: a same-phrase sibling profile's owner (or a storage attacker with
		// that profile's password) HOLDS the master. They tamper the victim's envelope and try to
		// recompute the MAC — with the master alone (the retired master-only construction, rebuilt
		// here independently so the test doesn't depend on shipped code) or with the master + any
		// DEK that is not the victim's. Every attempt must fail against the victim's verify.
		const victimMac = await computeEnvelopeMacV3("profile-1", MASTER, DEK, ENV_V3)
		const tampered = { ...ENV_V3, dek: b64(0x99) }
		// Forgery attempt 1: master-only-keyed tag over the tampered envelope.
		const masterOnlyKey = Buffer.from(
			hkdfSync("sha256", Buffer.from(MASTER), Buffer.alloc(32), Buffer.from("nulo:envelope-mac:v3", "utf8"), 64),
		)
		const masterOnlyForgery = createHmac("sha256", masterOnlyKey)
			.update(`profile-1.${tampered.guard}.${tampered.secret}.${tampered.entropy}.${tampered.dek}.${tampered.walletFingerprint}`)
			.digest("base64")
		expect(await verifyEnvelopeMacV3("profile-1", MASTER, DEK, tampered, masterOnlyForgery)).toBe(false)
		// Forgery attempt 2: v3 tag keyed with the master + the attacker's own/guessed DEK.
		const wrongDekForgery = await computeEnvelopeMacV3("profile-1", MASTER, OTHER_DEK, tampered)
		expect(await verifyEnvelopeMacV3("profile-1", MASTER, DEK, tampered, wrongDekForgery)).toBe(false)
		// The victim's own honest tag still verifies (the failure above is the forgery, not the scheme).
		expect(await verifyEnvelopeMacV3("profile-1", MASTER, DEK, ENV_V3, victimMac)).toBe(true)
	})

	test("a different master fails too (both halves of the key are load-bearing)", async () => {
		const mac = await computeEnvelopeMacV3("profile-1", MASTER, DEK, ENV_V3)
		expect(await verifyEnvelopeMacV3("profile-1", OTHER_MASTER, DEK, ENV_V3, mac)).toBe(false)
	})

	test("the six-field separator is unambiguous — reshuffling field boundaries changes the tag", async () => {
		const a = await computeEnvelopeMacV3("p1", MASTER, DEK, {
			guard: "a",
			secret: "bc",
			entropy: "d",
			dek: "e",
			walletFingerprint: "f",
		})
		const b = await computeEnvelopeMacV3("p1", MASTER, DEK, {
			guard: "ab",
			secret: "c",
			entropy: "d",
			dek: "e",
			walletFingerprint: "f",
		})
		const c = await computeEnvelopeMacV3("p1", MASTER, DEK, {
			guard: "a",
			secret: "b",
			entropy: "cd",
			dek: "e",
			walletFingerprint: "f",
		})
		const d = await computeEnvelopeMacV3("p1", MASTER, DEK, {
			guard: "a",
			secret: "b",
			entropy: "c",
			dek: "de",
			walletFingerprint: "f",
		})
		expect(new Set([a, b, c, d]).size).toBe(4)
	})

	test("the profileId participates in the preimage (an id-only change re-tags)", async () => {
		const a = await computeEnvelopeMacV3("profile-1", MASTER, DEK, ENV_V3)
		const b = await computeEnvelopeMacV3("profile-2", MASTER, DEK, ENV_V3)
		expect(a).not.toBe(b)
	})

	test("cross-implementation KAT: node:crypto HKDF+HMAC reproduces the WebCrypto tag", async () => {
		// Independent implementation of the whole v3 construction (node:crypto vs WebCrypto): a
		// shared misunderstanding of HKDF/HMAC semantics cannot self-consistently pass this.
		const ikm = Buffer.concat([Buffer.from(MASTER), Buffer.from(DEK)])
		const macKeyBytes = Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(32), Buffer.from("nulo:envelope-mac:v3", "utf8"), 64))
		const preimage = Buffer.from(
			`profile-1.${ENV_V3.guard}.${ENV_V3.secret}.${ENV_V3.entropy}.${ENV_V3.dek}.${ENV_V3.walletFingerprint}`,
			"utf8",
		)
		const expected = createHmac("sha256", macKeyBytes).update(preimage).digest("base64")
		expect(await computeEnvelopeMacV3("profile-1", MASTER, DEK, ENV_V3)).toBe(expected)
	})

	test("garbage/empty MAC strings fail closed, never throw", async () => {
		expect(await verifyEnvelopeMacV3("profile-1", MASTER, DEK, ENV_V3, "")).toBe(false)
		expect(await verifyEnvelopeMacV3("profile-1", MASTER, DEK, ENV_V3, "not-base64!!!")).toBe(false)
	})

	test("REJECTS non-32-byte key halves (distinct splits of the same bytes must not share a key)", async () => {
		const master31 = asMasterSecretBytes(new Uint8Array(31).fill(7) as Uint8Array<ArrayBuffer>)
		const dek33 = asImportedKeysDek(new Uint8Array(33).fill(7) as Uint8Array<ArrayBuffer>)
		await expect(computeEnvelopeMacV3("profile-1", master31, DEK, ENV_V3)).rejects.toThrow()
		await expect(computeEnvelopeMacV3("profile-1", MASTER, dek33, ENV_V3)).rejects.toThrow()
	})
})
