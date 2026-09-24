import { describe, expect, test } from "vitest"
import {
	CHAIN_IDS,
	MAINNET_L1_CHAIN_ID,
	MAINNET_ROLLUP_VERSION,
	TESTNET_L1_CHAIN_ID,
	TESTNET_ROLLUP_VERSION,
	walletChainId,
} from "./chain-ids"

// The literals are pinned beside the derivation because a pair edit re-keys every seeded network,
// explorer, price and default-token entry, so it must never land unnoticed.
describe("CHAIN_IDS derives from its recorded pair", () => {
	test("mainnet → 4248422646", () => {
		expect(CHAIN_IDS.MAINNET).toBe(walletChainId(MAINNET_L1_CHAIN_ID, MAINNET_ROLLUP_VERSION))
		expect(CHAIN_IDS.MAINNET).toBe(4248422646)
	})

	test("testnet → 1816023401", () => {
		expect(CHAIN_IDS.TESTNET).toBe(walletChainId(TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION))
		expect(CHAIN_IDS.TESTNET).toBe(1816023401)
	})
})
