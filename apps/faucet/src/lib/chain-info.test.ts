import { Fr } from "@aztec/aztec.js/fields"
import { describe, expect, it } from "vitest"
import { TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION, TESTNET_WALLET_CHAIN_ID } from "./chain-constants"
import { readChainInfo } from "./chain-info"

describe("chain-constants", () => {
	it("canonical V5 testnet wallet chainId is 2793892258", () => {
		expect(TESTNET_WALLET_CHAIN_ID).toBe(2793892258)
		expect((TESTNET_L1_CHAIN_ID ^ TESTNET_ROLLUP_VERSION) >>> 0).toBe(2793892258)
	})

	it("(BUG PIN) the stale rollup version would have given 4138294185", () => {
		// The value a stale VITE_CHAIN_VERSION=4127419662 produced in prod.
		expect((TESTNET_L1_CHAIN_ID ^ 4127419662) >>> 0).toBe(4138294185)
	})
})

describe("readChainInfo", () => {
	const url = (qs: string) => new URL(`https://faucet.nulo.sh/${qs}`)

	it("defaults to the testnet constants (no env override path exists)", () => {
		const info = readChainInfo(url(""))
		expect(info.chainId.equals(new Fr(TESTNET_L1_CHAIN_ID))).toBe(true)
		expect(info.version.equals(new Fr(TESTNET_ROLLUP_VERSION))).toBe(true)
	})

	it("never resolves to the Fr.ZERO wildcard (the prior no-accounts UX hole)", () => {
		const info = readChainInfo(url(""))
		expect(info.chainId.isZero()).toBe(false)
		expect(info.version.isZero()).toBe(false)
	})

	it("honors the ?chainId=&version= URL override (e2e test driver)", () => {
		const info = readChainInfo(url("?chainId=999&version=888"))
		expect(info.chainId.equals(new Fr(999))).toBe(true)
		expect(info.version.equals(new Fr(888))).toBe(true)
	})

	it("a partial override falls back to the constant for the missing field", () => {
		const info = readChainInfo(url("?chainId=999"))
		expect(info.chainId.equals(new Fr(999))).toBe(true)
		expect(info.version.equals(new Fr(TESTNET_ROLLUP_VERSION))).toBe(true)
	})
})
