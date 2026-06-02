import { describe, expect, test } from "vitest"
import { OriginType } from "@/wallet/services/transaction/spec"
import {
	FEE_METHODS,
	formatCallSummary,
	formatTransferType,
	getCallCountLabel,
	getMethodLabel,
	getOriginLabel,
	getPrimaryCall,
	getTxCategory,
	getTxTitle,
	humanizeMethodName,
} from "./tx-enrichment"

describe("FEE_METHODS — re-exported from primary-method", () => {
	test("re-exports the same set instance", () => {
		expect(FEE_METHODS.has("sponsor_unconditionally")).toBe(true)
		expect(FEE_METHODS.has("transfer")).toBe(false)
	})
})

describe("getMethodLabel — exact-match lookup", () => {
	test("known method gets its friendly label", () => {
		expect(getMethodLabel("transfer")).toBe("Transfer (private)")
		expect(getMethodLabel("mint_to_public")).toBe("Mint (public)")
		expect(getMethodLabel("transfer_to_private")).toBe("Transfer to private")
	})
	test("unknown method → null (NOT title-cased; caller picks the fallback)", () => {
		expect(getMethodLabel("drip_to_private")).toBeNull()
		expect(getMethodLabel("anything_else")).toBeNull()
	})
})

describe("humanizeMethodName — fallback when no label exists", () => {
	test("known method gets the friendly label", () => {
		expect(humanizeMethodName("transfer_in_private")).toBe("Transfer (private)")
		expect(humanizeMethodName("mint_to_private")).toBe("Mint (private)")
	})
	test("empty / falsy input → Unknown", () => {
		expect(humanizeMethodName("")).toBe("Unknown")
	})
	test("hex selector longer than 10 chars → truncated with ellipsis", () => {
		expect(humanizeMethodName("0x1234567890abcdef")).toBe("0x12345678...")
	})
	test("short hex selector → unchanged", () => {
		expect(humanizeMethodName("0xabcd")).toBe("0xabcd")
	})
	test("snake_case unknown → title-cased with spaces", () => {
		expect(humanizeMethodName("drip_to_private")).toBe("Drip To Private")
		expect(humanizeMethodName("custom_method")).toBe("Custom Method")
	})
})

describe("getPrimaryCall — TxCall wrapper around pickPrimaryMethod", () => {
	test("empty array → undefined", () => {
		expect(getPrimaryCall([])).toBeUndefined()
	})
	test("[sponsor, drip] → drip call object", () => {
		const calls = [
			{ contract: "0x1", method: "sponsor_unconditionally" },
			{ contract: "0x2", method: "drip_to_private" },
		]
		expect(getPrimaryCall(calls)?.method).toBe("drip_to_private")
		expect(getPrimaryCall(calls)?.contract).toBe("0x2")
	})
	test("mint heuristic preserved", () => {
		const calls = [
			{ contract: "0x1", method: "transfer_in_public" },
			{ contract: "0x2", method: "mint_to_private" },
		]
		expect(getPrimaryCall(calls)?.method).toBe("mint_to_private")
	})
	test("(BUG PIN) all-fee-only list returns the first call verbatim", () => {
		const calls = [
			{ contract: "0x1", method: "sponsor_unconditionally" },
			{ contract: "0x2", method: "pay_fee" },
		]
		expect(getPrimaryCall(calls)?.method).toBe("sponsor_unconditionally")
	})
})

describe("getTxCategory — branch on primary call's method prefix", () => {
	test("transfer family → 'transfer'", () => {
		expect(getTxCategory([{ contract: "0x1", method: "transfer_in_private" }])).toBe("transfer")
		expect(getTxCategory([{ contract: "0x1", method: "transfer_to_public" }])).toBe("transfer")
	})
	test("mint_to family → 'mint'", () => {
		expect(getTxCategory([{ contract: "0x1", method: "mint_to_private" }])).toBe("mint")
		expect(getTxCategory([{ contract: "0x1", method: "mint_to_public" }])).toBe("mint")
	})
	test("anything else → 'tx'", () => {
		expect(getTxCategory([{ contract: "0x1", method: "drip_to_private" }])).toBe("tx")
		expect(getTxCategory([{ contract: "0x1", method: "shield" }])).toBe("tx")
	})
	test("empty → 'tx' (no primary call)", () => {
		expect(getTxCategory([])).toBe("tx")
	})
})

describe("getTxTitle — display title by category", () => {
	test("transfer → 'Transfer'", () => {
		expect(getTxTitle([{ contract: "0x1", method: "transfer" }])).toBe("Transfer")
	})
	test("mint → 'Mint'", () => {
		expect(getTxTitle([{ contract: "0x1", method: "mint_to_private" }])).toBe("Mint")
	})
	test("generic tx → humanized primary method", () => {
		expect(getTxTitle([{ contract: "0x1", method: "drip_to_private" }])).toBe("Drip To Private")
	})
	test("empty calls → 'Transaction'", () => {
		expect(getTxTitle([])).toBe("Transaction")
	})
	test("fee + user call → uses user call's humanized name", () => {
		expect(
			getTxTitle([
				{ contract: "0x1", method: "sponsor_unconditionally" },
				{ contract: "0x2", method: "drip_to_private" },
			]),
		).toBe("Drip To Private")
	})
})

describe("getCallCountLabel — excludes fee/entrypoint calls", () => {
	test("single user call → null", () => {
		expect(getCallCountLabel([{ contract: "0x1", method: "transfer" }])).toBeNull()
	})
	test("fee + single user call → null (still 1 user call)", () => {
		expect(
			getCallCountLabel([
				{ contract: "0x1", method: "sponsor_unconditionally" },
				{ contract: "0x2", method: "transfer" },
			]),
		).toBeNull()
	})
	test("2 user calls → '2 calls'", () => {
		expect(
			getCallCountLabel([
				{ contract: "0x1", method: "transfer" },
				{ contract: "0x2", method: "shield" },
			]),
		).toBe("2 calls")
	})
	test("fee + 2 user calls → '2 calls'", () => {
		expect(
			getCallCountLabel([
				{ contract: "0x1", method: "sponsor_unconditionally" },
				{ contract: "0x2", method: "transfer" },
				{ contract: "0x3", method: "shield" },
			]),
		).toBe("2 calls")
	})
	test("null / undefined input → null", () => {
		// biome-ignore lint/suspicious/noExplicitAny: pinning defensive guard for the runtime-null case
		expect(getCallCountLabel(null as any)).toBeNull()
	})
})

describe("getOriginLabel — dApp identity for DAPP origin only", () => {
	test("DAPP origin with name → name", () => {
		expect(getOriginLabel({ type: OriginType.DAPP, name: "Faucet" })).toBe("Faucet")
	})
	test("DAPP origin without name → 'dApp'", () => {
		expect(getOriginLabel({ type: OriginType.DAPP })).toBe("dApp")
	})
	test("UI origin → null", () => {
		expect(getOriginLabel({ type: OriginType.UI })).toBeNull()
	})
	test("undefined origin → null", () => {
		expect(getOriginLabel(undefined)).toBeNull()
	})
})

describe("formatTransferType — enum and string keys", () => {
	test("numeric enum values", () => {
		expect(formatTransferType(0)).toBe("Private → Private")
		expect(formatTransferType(1)).toBe("Private → Public")
		expect(formatTransferType(2)).toBe("Public → Public")
		expect(formatTransferType(3)).toBe("Public → Private")
	})
	test("string keys", () => {
		expect(formatTransferType("Private")).toBe("Private → Private")
		expect(formatTransferType("PrivateToPublic")).toBe("Private → Public")
	})
	test("unknown → stringified input", () => {
		expect(formatTransferType(999)).toBe("999")
		expect(formatTransferType("bogus")).toBe("bogus")
	})
})

describe("formatCallSummary — compact 'Method on 0xabcd..ef' format", () => {
	test("known method + long contract → humanized + trimmed", () => {
		expect(formatCallSummary("transfer", "0x1234567890abcdef1234567890abcdef12345678")).toBe("Transfer (private) on 0x1234..5678")
	})
	test("unknown method → title-cased + trimmed contract", () => {
		expect(formatCallSummary("drip_to_private", "0x1234567890abcdef1234567890abcdef12345678")).toBe("Drip To Private on 0x1234..5678")
	})
})
