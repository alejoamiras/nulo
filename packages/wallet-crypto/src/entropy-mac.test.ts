import { createHmac, hkdfSync } from "node:crypto"
import { describe, expect, test } from "vitest"
import { computeEnvelopeMacV2, type MacEnvelopeV2, verifyEnvelopeMacV2 } from "./entropy-mac"
import { asImportedKeysDek, asMasterSecretBytes } from "./secret-types"

const MASTER = asMasterSecretBytes(new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>)
const OTHER_MASTER = asMasterSecretBytes(new Uint8Array(32).fill(8) as Uint8Array<ArrayBuffer>)
const b64 = (fill: number) => Buffer.from(new Uint8Array(61).fill(fill)).toString("base64")

const DEK = asImportedKeysDek(new Uint8Array(32).fill(0x11) as Uint8Array<ArrayBuffer>)
const OTHER_DEK = asImportedKeysDek(new Uint8Array(32).fill(0x12) as Uint8Array<ArrayBuffer>)
const ENV_V2: MacEnvelopeV2 = { guard: b64(0x2a), secret: b64(0x2b), entropy: b64(0x2c), dek: b64(0x2d) }

describe("envelope MAC v2 (DEK-keyed — the same-phrase attacker HOLDS the master)", () => {
	test("round-trips: compute then verify", async () => {
		const mac = await computeEnvelopeMacV2(MASTER, DEK, ENV_V2)
		expect(await verifyEnvelopeMacV2(MASTER, DEK, ENV_V2, mac)).toBe(true)
	})

	test("a transplanted/tampered ciphertext in ANY of the four slots fails verification", async () => {
		const mac = await computeEnvelopeMacV2(MASTER, DEK, ENV_V2)
		expect(await verifyEnvelopeMacV2(MASTER, DEK, { ...ENV_V2, guard: b64(0x99) }, mac)).toBe(false)
		expect(await verifyEnvelopeMacV2(MASTER, DEK, { ...ENV_V2, secret: b64(0x99) }, mac)).toBe(false)
		expect(await verifyEnvelopeMacV2(MASTER, DEK, { ...ENV_V2, entropy: b64(0x99) }, mac)).toBe(false)
		expect(await verifyEnvelopeMacV2(MASTER, DEK, { ...ENV_V2, dek: b64(0x99) }, mac)).toBe(false)
	})

	test("MASTER-HOLDER FORGERY fails: knowing the master without the victim's DEK cannot mint a valid tag", async () => {
		// The v2 threat model: a same-phrase sibling profile's owner (or a storage attacker with
		// that profile's password) HOLDS the master. They tamper the victim's envelope and try to
		// recompute the MAC — with the master alone (the retired master-only construction, rebuilt
		// here independently so the test doesn't depend on shipped code) or with the master + any
		// DEK that is not the victim's. Every attempt must fail against the victim's verify.
		const victimMac = await computeEnvelopeMacV2(MASTER, DEK, ENV_V2)
		const tampered = { ...ENV_V2, dek: b64(0x99) }
		// Forgery attempt 1: master-only-keyed tag over the tampered envelope.
		const masterOnlyKey = Buffer.from(
			hkdfSync("sha256", Buffer.from(MASTER), Buffer.alloc(32), Buffer.from("nulo:envelope-mac:v2", "utf8"), 64),
		)
		const masterOnlyForgery = createHmac("sha256", masterOnlyKey)
			.update(`${tampered.guard}.${tampered.secret}.${tampered.entropy}.${tampered.dek}`)
			.digest("base64")
		expect(await verifyEnvelopeMacV2(MASTER, DEK, tampered, masterOnlyForgery)).toBe(false)
		// Forgery attempt 2: v2 tag keyed with the master + the attacker's own/guessed DEK.
		const wrongDekForgery = await computeEnvelopeMacV2(MASTER, OTHER_DEK, tampered)
		expect(await verifyEnvelopeMacV2(MASTER, DEK, tampered, wrongDekForgery)).toBe(false)
		// The victim's own honest tag still verifies (the failure above is the forgery, not the scheme).
		expect(await verifyEnvelopeMacV2(MASTER, DEK, ENV_V2, victimMac)).toBe(true)
	})

	test("a different master fails too (both halves of the key are load-bearing)", async () => {
		const mac = await computeEnvelopeMacV2(MASTER, DEK, ENV_V2)
		expect(await verifyEnvelopeMacV2(OTHER_MASTER, DEK, ENV_V2, mac)).toBe(false)
	})

	test("the four-field separator is unambiguous — reshuffling field boundaries changes the tag", async () => {
		const a = await computeEnvelopeMacV2(MASTER, DEK, { guard: "a", secret: "bc", entropy: "d", dek: "e" })
		const b = await computeEnvelopeMacV2(MASTER, DEK, { guard: "ab", secret: "c", entropy: "d", dek: "e" })
		const c = await computeEnvelopeMacV2(MASTER, DEK, { guard: "a", secret: "b", entropy: "cd", dek: "e" })
		expect(new Set([a, b, c]).size).toBe(3)
	})

	test("cross-implementation KAT: node:crypto HKDF+HMAC reproduces the WebCrypto tag", async () => {
		// Independent implementation of the whole v2 construction (node:crypto vs WebCrypto): a
		// shared misunderstanding of HKDF/HMAC semantics cannot self-consistently pass this.
		const ikm = Buffer.concat([Buffer.from(MASTER), Buffer.from(DEK)])
		const macKeyBytes = Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(32), Buffer.from("nulo:envelope-mac:v2", "utf8"), 64))
		const preimage = Buffer.from(`${ENV_V2.guard}.${ENV_V2.secret}.${ENV_V2.entropy}.${ENV_V2.dek}`, "utf8")
		const expected = createHmac("sha256", macKeyBytes).update(preimage).digest("base64")
		expect(await computeEnvelopeMacV2(MASTER, DEK, ENV_V2)).toBe(expected)
	})

	test("garbage/empty MAC strings fail closed, never throw", async () => {
		expect(await verifyEnvelopeMacV2(MASTER, DEK, ENV_V2, "")).toBe(false)
		expect(await verifyEnvelopeMacV2(MASTER, DEK, ENV_V2, "not-base64!!!")).toBe(false)
	})

	test("REJECTS non-32-byte key halves (distinct splits of the same bytes must not share a key)", async () => {
		const master31 = asMasterSecretBytes(new Uint8Array(31).fill(7) as Uint8Array<ArrayBuffer>)
		const dek33 = asImportedKeysDek(new Uint8Array(33).fill(7) as Uint8Array<ArrayBuffer>)
		await expect(computeEnvelopeMacV2(master31, DEK, ENV_V2)).rejects.toThrow()
		await expect(computeEnvelopeMacV2(MASTER, dek33, ENV_V2)).rejects.toThrow()
	})
})
