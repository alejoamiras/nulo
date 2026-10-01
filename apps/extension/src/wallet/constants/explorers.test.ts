/**
 * D5-C: the received-detail page always-links the tx hash where an explorer URL exists, and
 * falls back to copy-hash where none does. This pins the URL builder that drives that branch.
 */
import { describe, expect, test } from "vitest"
import { CHAIN_IDS } from "@/utils/chain-ids"
import { getTransactionExplorerUrl } from "./explorers"

const TX = `0x${"ab".repeat(32)}`

describe("getTransactionExplorerUrl", () => {
	test("testnet → null until an explorer serves the V6 chain (copy-hash fallback)", () => {
		expect(getTransactionExplorerUrl(CHAIN_IDS.TESTNET, "aztecscan", TX)).toBeNull()
	})

	test("sandbox (chainId 0) → null (no base URL → copy-hash fallback)", () => {
		expect(getTransactionExplorerUrl(CHAIN_IDS.SANDBOX, "aztecscan", TX)).toBeNull()
	})

	test("explorer disabled (null) → null", () => {
		expect(getTransactionExplorerUrl(CHAIN_IDS.TESTNET, null, TX)).toBeNull()
	})
})
