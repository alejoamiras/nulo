import { describe, expect, test } from "vitest"
import { sealImportedSigningKeyV2, unsealImportedSigningKeyV2 } from "./imported-account-key-box"
import { asImportedKeysDek } from "./secret-types"

const DEK = asImportedKeysDek(new Uint8Array(32).fill(0x11) as Uint8Array<ArrayBuffer>)
const OTHER_DEK = asImportedKeysDek(new Uint8Array(32).fill(0x12) as Uint8Array<ArrayBuffer>)
const SK = () => new Uint8Array(32).fill(0x5a) as Uint8Array<ArrayBuffer>
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")

describe("imported-account-key box v2 (DEK-rooted)", () => {
	test("seal → unseal round-trips for the same (dek, chainId, address)", async () => {
		const sealed = await sealImportedSigningKeyV2(DEK, 0, "0xabc", SK())
		expect(hex(await unsealImportedSigningKeyV2(DEK, 0, "0xabc", sealed))).toBe(hex(SK()))
	})

	test("a ciphertext transplanted to a DIFFERENT row fails (per-row info carries over)", async () => {
		const sealed = await sealImportedSigningKeyV2(DEK, 0, "0xabc", SK())
		await expect(unsealImportedSigningKeyV2(DEK, 0, "0xdef", sealed)).rejects.toThrow()
		await expect(unsealImportedSigningKeyV2(DEK, 7, "0xabc", sealed)).rejects.toThrow()
	})

	test("a different DEK fails (the row key roots in the profile's DEK)", async () => {
		const sealed = await sealImportedSigningKeyV2(DEK, 0, "0xabc", SK())
		await expect(unsealImportedSigningKeyV2(OTHER_DEK, 0, "0xabc", sealed)).rejects.toThrow()
	})

	test("a corrupt envelope fails closed", async () => {
		await expect(unsealImportedSigningKeyV2(DEK, 0, "0xabc", "AAA=")).rejects.toThrow()
	})
})
