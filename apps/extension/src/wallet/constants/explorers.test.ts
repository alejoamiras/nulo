/**
 * D5-C: the received-detail page always-links the tx hash where an explorer URL exists, and
 * falls back to copy-hash on the sandbox (chainId 0 has no base URL). This pins the URL builder
 * that drives that branch.
 */
import { describe, expect, test } from "vitest"
import { CHAIN_IDS } from "@/utils/chain-ids"
import { getTransactionExplorerUrl } from "./explorers"

const TX = `0x${"ab".repeat(32)}`

describe("getTransactionExplorerUrl", () => {
	test("mainnet → aztecscan tx-effects URL (link renders)", () => {
		expect(getTransactionExplorerUrl(CHAIN_IDS.MAINNET, "aztecscan", TX)).toBe(`https://aztecscan.xyz/tx-effects/${TX}`)
	})

	test("testnet → testnet aztecscan URL", () => {
		expect(getTransactionExplorerUrl(CHAIN_IDS.TESTNET, "aztecscan", TX)).toBe(`https://testnet.aztecscan.xyz/tx-effects/${TX}`)
	})

	test("sandbox (chainId 0) → null (no base URL → copy-hash fallback)", () => {
		expect(getTransactionExplorerUrl(CHAIN_IDS.SANDBOX, "aztecscan", TX)).toBeNull()
	})

	test("explorer disabled (null) → null", () => {
		expect(getTransactionExplorerUrl(CHAIN_IDS.MAINNET, null, TX)).toBeNull()
	})
})
