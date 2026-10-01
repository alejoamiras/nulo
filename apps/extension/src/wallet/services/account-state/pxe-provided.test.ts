import { readFileSync } from "node:fs"
import { ProtocolContractAddress } from "@aztec-labs/protocol-contracts"
import { getStandardAuthRegistry } from "@aztec-labs/standard-contracts/auth-registry"
import { getStandardHandshakeRegistry } from "@aztec-labs/standard-contracts/handshake-registry"
import { getStandardMultiCallEntrypoint } from "@aztec-labs/standard-contracts/multi-call-entrypoint"
import { resolvePackageAsset } from "@nulo/resolve-asset"
import { describe, expect, test } from "vitest"
import { isPxeProvidedAddress, isPxeProvidedContract, PRELOADED_CONTRACT_ADDRESSES } from "./pxe-provided"

const hex64 = (value: bigint) => value.toString(16).padStart(64, "0")

describe("the upstream pins", () => {
	test("the preloaded set is the three standard contracts, at their artifact-derived addresses", async () => {
		const upstream = await Promise.all([getStandardMultiCallEntrypoint(), getStandardAuthRegistry(), getStandardHandshakeRegistry()])
		expect(PRELOADED_CONTRACT_ADDRESSES).toEqual(new Set(upstream.map((c) => c.address.toBigInt())))
	})

	test("createPXE still preloads exactly those three", () => {
		// Upstream exports no list of what it preloads, so the default provider's source is the record.
		const source = readFileSync(
			resolvePackageAsset("@aztec-labs/pxe", "dest/entrypoints/client/bundle/utils.js", { from: import.meta.url }),
			"utf8",
		)
		const provider = /getPreloadedContracts:\s*async\s*\(\)\s*=>\s*\[([^\]]*)\]/.exec(source)?.[1] ?? ""
		const getters = [...provider.matchAll(/\b(getStandard\w+)\(\)/g)].map((m) => m[1])
		expect(getters).toEqual(["getStandardMultiCallEntrypoint", "getStandardAuthRegistry", "getStandardHandshakeRegistry"])
	})

	test("every protocol contract address sits inside the protocol range", () => {
		for (const address of Object.values(ProtocolContractAddress)) expect(address.toBigInt()).toBeLessThanOrEqual(6n)
	})
})

describe("isPxeProvidedContract", () => {
	test("the protocol range, and every preloaded address in either hex case", () => {
		for (const value of [1n, 6n]) expect(isPxeProvidedContract(`0x${hex64(value)}`)).toBe(true)
		for (const value of PRELOADED_CONTRACT_ADDRESSES) {
			expect(isPxeProvidedContract(`0x${hex64(value)}`)).toBe(true)
			expect(isPxeProvidedContract(`0x${hex64(value).toUpperCase()}`)).toBe(true)
		}
	})

	test("an address just past the range, a dApp's address and an unparsable spelling are not provided", () => {
		expect(isPxeProvidedContract(`0x${hex64(7n)}`)).toBe(false)
		expect(isPxeProvidedContract(`0x${"07".repeat(32)}`)).toBe(false)
		expect(isPxeProvidedContract("0x05")).toBe(false)
		expect(isPxeProvidedAddress(7n)).toBe(false)
	})
})
