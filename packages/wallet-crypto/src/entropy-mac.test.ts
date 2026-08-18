import { describe, expect, test } from "vitest"
import { computeEntropyMac, verifyEntropyMac } from "./entropy-mac"
import { asBase64Ciphertext, asMasterSecretBytes } from "./secret-types"

const MASTER = asMasterSecretBytes(new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>)
const OTHER_MASTER = asMasterSecretBytes(new Uint8Array(32).fill(8) as Uint8Array<ArrayBuffer>)
const CT = asBase64Ciphertext(Buffer.from(new Uint8Array(61).fill(0x2c)).toString("base64"))
const OTHER_CT = asBase64Ciphertext(Buffer.from(new Uint8Array(61).fill(0x2d)).toString("base64"))

describe("entropy MAC (silent-restore tamper check)", () => {
	test("round-trips: compute then verify", async () => {
		const mac = await computeEntropyMac(MASTER, CT)
		expect(await verifyEntropyMac(MASTER, CT, mac)).toBe(true)
	})

	test("a swapped/tampered ciphertext fails verification", async () => {
		const mac = await computeEntropyMac(MASTER, CT)
		expect(await verifyEntropyMac(MASTER, OTHER_CT, mac)).toBe(false)
	})

	test("a different master fails verification (the MAC is master-keyed)", async () => {
		const mac = await computeEntropyMac(MASTER, CT)
		expect(await verifyEntropyMac(OTHER_MASTER, CT, mac)).toBe(false)
	})

	test("garbage/empty MAC strings fail closed, never throw", async () => {
		expect(await verifyEntropyMac(MASTER, CT, "")).toBe(false)
		expect(await verifyEntropyMac(MASTER, CT, "not-base64!!!")).toBe(false)
	})
})
