import type { BridgeJournalRecord } from "@nulo/bridge-core"
import { describe, expect, it } from "vitest"
import { assetDecimals, assetSymbol, recordTokenBlock } from "./asset-label"

const TOKEN = { displaySymbol: "WBTC", decimals: 8 }

describe("asset-label", () => {
	it("fee-juice records render as Fee Juice (18-dec), never the token bridge asset", () => {
		expect(assetSymbol("fee-juice", false)).toBe("FJ")
		expect(assetSymbol("fee-juice", true)).toBe("Private FJ")
		expect(assetDecimals("fee-juice")).toBe(18)
	})

	it("a record with no token block of its own is named generically, never as some other token", () => {
		expect(assetSymbol("bridge-token", false)).toBe("TOKEN")
		expect(assetSymbol(undefined, true)).toBe("TOKEN")
		expect(assetDecimals("bridge-token")).toBe(18)
		expect(assetDecimals(undefined)).toBe(18)
	})

	it("a send's own token block names the asset", () => {
		expect(assetSymbol("bridge-token", false, TOKEN)).toBe("WBTC")
		expect(assetDecimals("bridge-token", TOKEN)).toBe(8)
	})

	it("a token block never overrides Fee Juice (a gas leg is 18-dec FJ whatever was sent)", () => {
		expect(assetSymbol("fee-juice", true, TOKEN)).toBe("Private FJ")
		expect(assetDecimals("fee-juice", TOKEN)).toBe(18)
	})

	it("recordTokenBlock reads schema-3 blocks and nothing else", () => {
		const send = { schema: 3, token: { displaySymbol: "WBTC", decimals: 8 } } as unknown as BridgeJournalRecord
		const gasOnly = { schema: 3, intent: "gas" } as unknown as BridgeJournalRecord
		const v1 = { schema: 2, token: { displaySymbol: "NOPE", decimals: 2 } } as unknown as BridgeJournalRecord
		expect(recordTokenBlock(send)).toEqual({ displaySymbol: "WBTC", decimals: 8 })
		expect(recordTokenBlock(gasOnly)).toBeUndefined()
		expect(recordTokenBlock(v1)).toBeUndefined()
	})
})
