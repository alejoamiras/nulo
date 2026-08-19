import { describe, expect, test } from "vitest"
import {
	sealImportedSigningKey,
	sealImportedSigningKeyV2,
	unsealImportedSigningKey,
	unsealImportedSigningKeyV2,
} from "./imported-account-key-box"
import { asImportedKeysDek, asMasterSecretBytes } from "./secret-types"

const MASTER = asMasterSecretBytes(new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>)
const OTHER = asMasterSecretBytes(new Uint8Array(32).fill(8) as Uint8Array<ArrayBuffer>)
const DEK = asImportedKeysDek(new Uint8Array(32).fill(0x11) as Uint8Array<ArrayBuffer>)
const OTHER_DEK = asImportedKeysDek(new Uint8Array(32).fill(0x12) as Uint8Array<ArrayBuffer>)
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

	test("v1↔v2 info domains never coincide: the SAME 32 bytes as master (v1) vs dek (v2) reject", async () => {
		// The heart of the root swap: even if an attacker feeds the master bytes into the v2
		// unseal (or a DEK into v1), the bumped info prefix derives a different row key.
		const sameBytesAsDek = asImportedKeysDek(new Uint8Array(MASTER) as Uint8Array<ArrayBuffer>)
		const v1Sealed = await sealImportedSigningKey(MASTER, 0, "0xabc", SK())
		await expect(unsealImportedSigningKeyV2(sameBytesAsDek, 0, "0xabc", v1Sealed)).rejects.toThrow()
		const v2Sealed = await sealImportedSigningKeyV2(sameBytesAsDek, 0, "0xabc", SK())
		await expect(unsealImportedSigningKey(MASTER, 0, "0xabc", v2Sealed)).rejects.toThrow()
	})

	test("a corrupt envelope fails closed", async () => {
		await expect(unsealImportedSigningKeyV2(DEK, 0, "0xabc", "AAA=")).rejects.toThrow()
	})
})
