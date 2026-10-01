import { describe, expect, test } from "vitest"
import { CHAIN_IDS, MAINNET_L1_CHAIN_ID, TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION, walletChainId } from "./chain-ids"

// The literals are pinned beside the derivation because a pair edit re-keys every seeded network,
// explorer, price and default-token entry, so it must never land unnoticed.
describe("CHAIN_IDS derives from its recorded pair", () => {
	test("testnet → 2904119610", () => {
		expect(CHAIN_IDS.TESTNET).toBe(walletChainId(TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION))
		expect(CHAIN_IDS.TESTNET).toBe(2904119610)
	})

	test("a mainnet-kind row is checked against Ethereum mainnet", () => {
		expect(MAINNET_L1_CHAIN_ID).toBe(1)
	})
})
