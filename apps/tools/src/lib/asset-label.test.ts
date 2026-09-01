import { describe, expect, it } from "vitest"
import { BRIDGE_TOKEN_DECIMALS, BRIDGE_TOKEN_SYMBOL } from "@/contracts/bridge-deployments"
import { assetDecimals, assetSymbol } from "./asset-label"

describe("asset-label", () => {
	it("fee-juice records render as Fee Juice (18-dec), never the token bridge asset", () => {
		expect(assetSymbol("fee-juice", false)).toBe("FJ")
		expect(assetSymbol("fee-juice", true)).toBe("Private FJ")
		expect(assetDecimals("fee-juice")).toBe(18)
	})

	it("token / undefined records fall through to the configured bridge symbol + decimals", () => {
		expect(assetSymbol("bridge-token", false)).toBe(BRIDGE_TOKEN_SYMBOL)
		expect(assetSymbol(undefined, true)).toBe(BRIDGE_TOKEN_SYMBOL)
		expect(assetDecimals("bridge-token")).toBe(BRIDGE_TOKEN_DECIMALS)
		expect(assetDecimals(undefined)).toBe(BRIDGE_TOKEN_DECIMALS)
	})
})
