import { describe, expect, test } from "vitest"
import { CHAIN_IDS } from "@/utils/chain-ids"
import { knownContracts } from "./known-contracts"

const FPCS = { sponsored: `0x${"AB".repeat(32)}`, private: `0x${"CD".repeat(32)}` }
const FEE_JUICE = `0x${"0".repeat(63)}3`
const AUTH_REGISTRY = "0x1e8e7e73c592a1b1c9199b4b655ddc7a16fa8a8488df595610b71d3dc1cc666c"

describe("knownContracts", () => {
	test("the protocol contracts carry the drawn role names, in the drawn order, lower-cased", () => {
		expect(knownContracts(CHAIN_IDS.SANDBOX, FPCS)).toEqual([
			{ address: FEE_JUICE, name: "Fee Juice" },
			{ address: `0x${"ab".repeat(32)}`, name: "Sponsored fee payer" },
			{ address: `0x${"cd".repeat(32)}`, name: "Private fee payer" },
			{ address: AUTH_REGISTRY, name: "Auth registry" },
		])
	})

	test("a chain's default tokens follow, by their built-in names", () => {
		const names = (chainId: number) => knownContracts(chainId, FPCS).slice(4)
		expect(names(CHAIN_IDS.TESTNET)).toEqual([
			{ address: "0x1c81a6d581e065e82d4d3b969020e9d0f899b975ae844f6e4305031ff62be9ae", name: "Test USDC" },
		])
		expect(names(CHAIN_IDS.MAINNET).map((entry) => entry.name)).toEqual(["Clean USDC", "USD Coin"])
	})
})
