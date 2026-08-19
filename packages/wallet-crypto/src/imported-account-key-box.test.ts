import { describe, expect, test } from "vitest"
import { sealImportedSigningKey, unsealImportedSigningKey } from "./imported-account-key-box"
import { asMasterSecretBytes } from "./secret-types"

const MASTER = asMasterSecretBytes(new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>)
const OTHER = asMasterSecretBytes(new Uint8Array(32).fill(8) as Uint8Array<ArrayBuffer>)
const SK = () => new Uint8Array(32).fill(0x5a) as Uint8Array<ArrayBuffer>
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex")

describe("imported-account-key box", () => {
	test("seal → unseal round-trips for the same (master, chainId, address)", async () => {
		const sealed = await sealImportedSigningKey(MASTER, 0, "0xabc", SK())
		expect(hex(await unsealImportedSigningKey(MASTER, 0, "0xabc", sealed))).toBe(hex(SK()))
	})

	test("a ciphertext transplanted to a DIFFERENT row fails (per-row info)", async () => {
		const sealed = await sealImportedSigningKey(MASTER, 0, "0xabc", SK())
		await expect(unsealImportedSigningKey(MASTER, 0, "0xdef", sealed)).rejects.toThrow()
		await expect(unsealImportedSigningKey(MASTER, 7, "0xabc", sealed)).rejects.toThrow()
	})

	test("a different master fails (key is HKDF'd from the profile master)", async () => {
		const sealed = await sealImportedSigningKey(MASTER, 0, "0xabc", SK())
		await expect(unsealImportedSigningKey(OTHER, 0, "0xabc", sealed)).rejects.toThrow()
	})

	test("a corrupt envelope fails closed", async () => {
		await expect(unsealImportedSigningKey(MASTER, 0, "0xabc", "AAA=")).rejects.toThrow()
	})
})
