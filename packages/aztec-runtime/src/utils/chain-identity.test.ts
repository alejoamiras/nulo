import { describe, expect, test } from "vitest"
import { assertLiveChainIdentity } from "./chain-identity"

describe("assertLiveChainIdentity (F-012 / Phase 5)", () => {
	test("passes when network.chainId === nodeInfo.l1ChainId", () => {
		expect(() => assertLiveChainIdentity({ chainId: 1 }, { l1ChainId: 1, rollupVersion: 4 })).not.toThrow()
	})

	test("throws when the live node reports a different chainId (chain spoofing defense)", () => {
		expect(() => assertLiveChainIdentity({ chainId: 1 }, { l1ChainId: 31337, rollupVersion: 4 })).toThrow(/Chain identity mismatch/)
	})

	test("error message includes both values so the caller can diagnose", () => {
		expect(() => assertLiveChainIdentity({ chainId: 11155111 }, { l1ChainId: 1, rollupVersion: 4 })).toThrow(/chainId=11155111/)
		expect(() => assertLiveChainIdentity({ chainId: 11155111 }, { l1ChainId: 1, rollupVersion: 4 })).toThrow(/l1ChainId=1/)
	})
})
