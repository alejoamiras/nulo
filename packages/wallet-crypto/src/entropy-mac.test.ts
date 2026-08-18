import { describe, expect, test } from "vitest"
import { computeEnvelopeMac, type MacEnvelope, verifyEnvelopeMac } from "./entropy-mac"
import { asMasterSecretBytes } from "./secret-types"

const MASTER = asMasterSecretBytes(new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>)
const OTHER_MASTER = asMasterSecretBytes(new Uint8Array(32).fill(8) as Uint8Array<ArrayBuffer>)
const b64 = (fill: number) => Buffer.from(new Uint8Array(61).fill(fill)).toString("base64")
const ENV: MacEnvelope = { guard: b64(0x2a), secret: b64(0x2b), entropy: b64(0x2c) }

describe("envelope MAC (silent-restore + transplant tamper check)", () => {
	test("round-trips: compute then verify", async () => {
		const mac = await computeEnvelopeMac(MASTER, ENV)
		expect(await verifyEnvelopeMac(MASTER, ENV, mac)).toBe(true)
	})

	test("a transplanted/tampered ciphertext in ANY slot fails verification", async () => {
		const mac = await computeEnvelopeMac(MASTER, ENV)
		expect(await verifyEnvelopeMac(MASTER, { ...ENV, secret: b64(0x99) }, mac)).toBe(false)
		expect(await verifyEnvelopeMac(MASTER, { ...ENV, entropy: b64(0x99) }, mac)).toBe(false)
		expect(await verifyEnvelopeMac(MASTER, { ...ENV, guard: b64(0x99) }, mac)).toBe(false)
	})

	test("a different master fails verification (the MAC is master-keyed)", async () => {
		const mac = await computeEnvelopeMac(MASTER, ENV)
		expect(await verifyEnvelopeMac(OTHER_MASTER, ENV, mac)).toBe(false)
	})

	test("the separator is unambiguous — reshuffling field boundaries changes the tag", async () => {
		// `.` is not in the base64 alphabet, so `a.bc` and `ab.c` must MAC differently.
		const a = await computeEnvelopeMac(MASTER, { guard: "a", secret: "bc", entropy: "d" })
		const b = await computeEnvelopeMac(MASTER, { guard: "ab", secret: "c", entropy: "d" })
		expect(a).not.toBe(b)
	})

	test("garbage/empty MAC strings fail closed, never throw", async () => {
		expect(await verifyEnvelopeMac(MASTER, ENV, "")).toBe(false)
		expect(await verifyEnvelopeMac(MASTER, ENV, "not-base64!!!")).toBe(false)
	})
})
