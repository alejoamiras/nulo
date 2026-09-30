import { ProtocolContractAddress } from "@aztec/protocol-contracts"
import { getDefaultStandardPreloadedContracts } from "@aztec/standard-contracts/preloaded"
import { describe, expect, test } from "vitest"
import { isPxeProvidedAddress, isPxeProvidedContract, PRELOADED_CONTRACT_ADDRESSES } from "./pxe-provided"

const hex64 = (value: bigint) => value.toString(16).padStart(64, "0")

describe("the upstream pins", () => {
	test("the preloaded set is exactly what the PXE registers at boot", async () => {
		const upstream = await getDefaultStandardPreloadedContracts()
		expect(PRELOADED_CONTRACT_ADDRESSES).toEqual(new Set(upstream.map((c) => c.address.toBigInt())))
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
