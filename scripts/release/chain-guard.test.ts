import { describe, expect, test } from "bun:test"
import {
	assertTestnetIdentity,
	TESTNET_L1_CHAIN_ID,
	TESTNET_ROLLUP_VERSION,
	TESTNET_WALLET_CHAIN_ID,
	walletChainId,
} from "./chain-guard"

describe("walletChainId (the XOR the wallet uses)", () => {
	test("canonical 5.0.0 testnet — single-sourced from chain-constants → 1816023401", () => {
		// Canary: chain-guard now imports the pair from apps/faucet/src/lib/chain-constants.ts,
		// so a testnet redeploy that bumps that file surfaces HERE too (no silent drift).
		expect(TESTNET_L1_CHAIN_ID).toBe(11155111)
		expect(TESTNET_ROLLUP_VERSION).toBe(1821665230)
		expect(TESTNET_WALLET_CHAIN_ID).toBe(1816023401)
		expect(walletChainId(TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION)).toBe(TESTNET_WALLET_CHAIN_ID)
	})

	test("(BUG PIN) the stale 4127419662 → 4138294185 (the exact prod failure)", () => {
		// This is the "No network configured for chainId 4138294185" we shipped.
		expect(walletChainId(11155111, 4127419662)).toBe(4138294185)
	})

	test("result is an unsigned 32-bit int (>>> 0)", () => {
		expect(walletChainId(0xffffffff, 0x1)).toBeGreaterThanOrEqual(0)
	})

	test("formula generalizes — mainnet seed (1 ^ 2934756905) → 2934756904", () => {
		expect(walletChainId(1, 2934756905)).toBe(2934756904)
	})

	test("TESTNET_WALLET_CHAIN_ID is the canonical the guard accepts", () => {
		expect(() =>
			assertTestnetIdentity({ l1ChainId: TESTNET_L1_CHAIN_ID, rollupVersion: TESTNET_ROLLUP_VERSION }),
		).not.toThrow()
	})
})

describe("assertTestnetIdentity", () => {
	test("canonical pair passes", () => {
		expect(() => assertTestnetIdentity({ l1ChainId: TESTNET_L1_CHAIN_ID, rollupVersion: TESTNET_ROLLUP_VERSION })).not.toThrow()
	})

	test("the stale V4 rollup version is rejected (the bug that broke prod)", () => {
		expect(() => assertTestnetIdentity({ l1ChainId: 11155111, rollupVersion: 4127419662 })).toThrow(/drift/)
	})

	test("the PRE-#248 V5 rollup (4239416255) is now rejected (testnet redeployed)", () => {
		// Regression: chain-guard would have ACCEPTED this before #248; single-sourcing
		// from chain-constants means it now correctly rejects the superseded value.
		expect(() => assertTestnetIdentity({ l1ChainId: 11155111, rollupVersion: 4239416255 })).toThrow(/drift/)
	})

	test("the error names both the got + expected wallet chainId", () => {
		// Assert BOTH the got (4138294185) AND the current expected (1816023401) appear, so a stale
		// expected in the message can't be masked by matching only the supplied bad value.
		const run = () => assertTestnetIdentity({ l1ChainId: 11155111, rollupVersion: 4127419662 })
		expect(run).toThrow(/4138294185/)
		expect(run).toThrow(/1816023401/)
	})

	test("wrong L1 chain id is rejected", () => {
		expect(() => assertTestnetIdentity({ l1ChainId: 1, rollupVersion: TESTNET_ROLLUP_VERSION })).toThrow(/drift/)
	})

	test("both wrong is rejected", () => {
		expect(() => assertTestnetIdentity({ l1ChainId: 1, rollupVersion: 1 })).toThrow(/drift/)
	})

	test("the remediation tells you not to override via VITE_CHAIN_*", () => {
		expect(() => assertTestnetIdentity({ l1ChainId: 1, rollupVersion: 1 })).toThrow(/VITE_CHAIN_/)
	})
})
