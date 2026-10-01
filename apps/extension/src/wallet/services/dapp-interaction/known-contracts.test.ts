import { describe, expect, test, vi } from "vitest"
import { CHAIN_IDS } from "@/utils/chain-ids"
import { knownContracts } from "./known-contracts"

/** A fixture seed: the shipped seed list can be empty, and this pins how any seed is listed. */
const SEED = vi.hoisted(() => ({ chainId: 7, contract: `0x${"EF".repeat(32)}`, displayName: "Test USDC" }))
vi.mock("@/wallet/services/token/default-tokens", () => ({
	seedsForChain: (chainId: number) => (chainId === SEED.chainId ? [SEED] : []),
}))

const FPCS = { sponsored: `0x${"AB".repeat(32)}`, private: `0x${"CD".repeat(32)}` }
const FEE_JUICE = `0x${"0".repeat(63)}3`
const AUTH_REGISTRY = "0x1ec33912c9f14470513e0eb23db81ddb2aa1ae3395e6ab4d3cba383f68dec3c5"

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
		expect(knownContracts(SEED.chainId, FPCS).slice(4)).toEqual([{ address: `0x${"ef".repeat(32)}`, name: "Test USDC" }])
	})
})
