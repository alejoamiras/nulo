import { describe, expect, test } from "vitest"
import { assertLiveChainIdentity, chainInfoFrom } from "./chain-identity"

const MAINNET_L1 = 1
const MAINNET_ROLLUP = 4248422647
const MAINNET = { chainId: (MAINNET_L1 ^ MAINNET_ROLLUP) >>> 0, l1ChainId: MAINNET_L1 }
const SEPOLIA = { chainId: (11155111 ^ 1) >>> 0, l1ChainId: 11155111 }

describe("assertLiveChainIdentity", () => {
	test("passes when both the exact l1ChainId and the composite match", () => {
		expect(() => assertLiveChainIdentity({ chainId: 5, l1ChainId: 1 }, { l1ChainId: 1, rollupVersion: 4 })).not.toThrow()
		expect(() => assertLiveChainIdentity(SEPOLIA, { l1ChainId: 11155111, rollupVersion: 1 })).not.toThrow()
		expect(() => assertLiveChainIdentity(MAINNET, { l1ChainId: MAINNET_L1, rollupVersion: MAINNET_ROLLUP })).not.toThrow()
	})

	test("throws when the live l1ChainId drifts", () => {
		expect(() => assertLiveChainIdentity({ chainId: 5, l1ChainId: 1 }, { l1ChainId: 31337, rollupVersion: 4 })).toThrow(
			/Chain identity mismatch.*l1ChainId=1 but live node reports l1ChainId=31337/,
		)
	})

	test("throws when the live rollupVersion drifts with the same l1ChainId", () => {
		expect(() => assertLiveChainIdentity({ chainId: 5, l1ChainId: 1 }, { l1ChainId: 1, rollupVersion: 99 })).toThrow(
			/Chain identity mismatch/,
		)
	})

	test("rejects the two-coordinate XOR collision (l1ChainId=2, rollupVersion chosen to reproduce mainnet's composite)", () => {
		const collidingRollup = (MAINNET.chainId ^ 2) >>> 0
		expect((2 ^ collidingRollup) >>> 0 === MAINNET.chainId).toBe(true)
		expect(() => assertLiveChainIdentity(MAINNET, { l1ChainId: 2, rollupVersion: collidingRollup })).toThrow(/l1ChainId=2/)
	})

	test("rejects the rollup-version alias above bit 32 (same low 32 bits as the genuine version)", () => {
		const alias = MAINNET_ROLLUP + 2 ** 32
		expect((MAINNET_L1 ^ alias) >>> 0 === MAINNET.chainId).toBe(true)
		expect(() => assertLiveChainIdentity(MAINNET, { l1ChainId: MAINNET_L1, rollupVersion: alias })).toThrow(
			/non-canonical rollupVersion/,
		)
	})

	test("rejects non-canonical live values (negative, fractional, above u32)", () => {
		expect(() => assertLiveChainIdentity(MAINNET, { l1ChainId: -1, rollupVersion: MAINNET_ROLLUP })).toThrow(/Non-canonical l1ChainId/)
		expect(() => assertLiveChainIdentity(MAINNET, { l1ChainId: 1.5, rollupVersion: MAINNET_ROLLUP })).toThrow(/Non-canonical l1ChainId/)
		expect(() => assertLiveChainIdentity(MAINNET, { l1ChainId: 2 ** 32, rollupVersion: MAINNET_ROLLUP })).toThrow(
			/Non-canonical l1ChainId/,
		)
		expect(() => assertLiveChainIdentity(MAINNET, { l1ChainId: MAINNET_L1, rollupVersion: -1 })).toThrow(/non-canonical rollupVersion/)
		expect(() => assertLiveChainIdentity(MAINNET, { l1ChainId: MAINNET_L1, rollupVersion: 0.5 })).toThrow(/non-canonical rollupVersion/)
	})

	test("local networks (stored chainId === 0) skip only the composite: the exact l1ChainId still binds", () => {
		expect(() => assertLiveChainIdentity({ chainId: 0, l1ChainId: 31337 }, { l1ChainId: 31337, rollupVersion: 0 })).not.toThrow()
		expect(() => assertLiveChainIdentity({ chainId: 0, l1ChainId: 31337 }, { l1ChainId: 31337, rollupVersion: 42 })).not.toThrow()
		expect(() => assertLiveChainIdentity({ chainId: 0, l1ChainId: 1337 }, { l1ChainId: 1337, rollupVersion: 7 })).not.toThrow()
		expect(() => assertLiveChainIdentity({ chainId: 0, l1ChainId: 31337 }, { l1ChainId: 1337, rollupVersion: 0 })).toThrow(
			/l1ChainId=31337 but live node reports l1ChainId=1337/,
		)
	})

	test("error message includes both values so the caller can diagnose", () => {
		expect(() => assertLiveChainIdentity(SEPOLIA, { l1ChainId: 11155111, rollupVersion: 2 })).toThrow(/chainId=11155110/)
		expect(() => assertLiveChainIdentity(SEPOLIA, { l1ChainId: 11155111, rollupVersion: 2 })).toThrow(/rollupVersion=2/)
	})
})

describe("chainInfoFrom", () => {
	test("maps l1ChainId → chainId and rollupVersion → version (distinct values; no swap)", () => {
		const ci = chainInfoFrom({ l1ChainId: 31337, rollupVersion: 4 })
		expect(ci.chainId.toBigInt()).toBe(31337n)
		expect(ci.version.toBigInt()).toBe(4n)
	})

	test("encodes a realistic identity as Fr", () => {
		const ci = chainInfoFrom({ l1ChainId: 11155111, rollupVersion: 1 })
		expect(ci.chainId.toBigInt()).toBe(11155111n)
		expect(ci.version.toBigInt()).toBe(1n)
	})
})
