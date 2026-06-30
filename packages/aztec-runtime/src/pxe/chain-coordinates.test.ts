import { describe, expect, test } from "vitest"
import { PXE_DATA_DIR_ROOT, chainDataDir, chainDataDirPrefix, chainRegistryKey, chainRegistryKeyPrefix } from "./chain-coordinates"

describe("chain-coordinates codec", () => {
	const c = { profileId: "p1", chainId: 31337 }

	test("registryKey is byte-identical to the prior profileId:chainId inline literal", () => {
		expect(chainRegistryKey(c)).toBe("p1:31337")
		expect(chainRegistryKey(c)).toBe(`${c.profileId}:${c.chainId}`)
	})

	test("registryKeyPrefix matches every key under the profile", () => {
		expect(chainRegistryKeyPrefix("p1")).toBe("p1:")
		expect(chainRegistryKey(c).startsWith(chainRegistryKeyPrefix("p1"))).toBe(true)
		// must NOT match a different profile whose id shares a prefix
		expect(chainRegistryKey({ profileId: "p10", chainId: 1 }).startsWith(chainRegistryKeyPrefix("p1"))).toBe(false)
	})

	test("dataDir is byte-identical to the prior pxe/profileId/chainId literal (PERSISTED)", () => {
		expect(chainDataDir(c)).toBe("pxe/p1/31337")
		expect(chainDataDir(c)).toBe(`pxe/${c.profileId}/${c.chainId}`)
	})

	test("dataDirPrefix + root match the persisted name", () => {
		expect(PXE_DATA_DIR_ROOT).toBe("pxe/")
		expect(chainDataDirPrefix("p1")).toBe("pxe/p1/")
		expect(chainDataDir(c).startsWith(chainDataDirPrefix("p1"))).toBe(true)
		expect(chainDataDir(c).startsWith(PXE_DATA_DIR_ROOT)).toBe(true)
		expect(chainDataDir({ profileId: "p10", chainId: 1 }).startsWith(chainDataDirPrefix("p1"))).toBe(false)
	})
})
