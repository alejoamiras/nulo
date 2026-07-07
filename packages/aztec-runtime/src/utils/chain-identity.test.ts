import { describe, expect, test } from "vitest"
import { assertLiveChainIdentity, chainInfoFrom } from "./chain-identity"

describe("assertLiveChainIdentity (F-012 / Phase 5)", () => {
	test("passes when live composite (l1ChainId XOR rollupVersion) matches stored chainId", () => {
		// 1 XOR 4 = 5
		expect(() => assertLiveChainIdentity({ chainId: 5 }, { l1ChainId: 1, rollupVersion: 4 })).not.toThrow()
		// Sepolia (11155111) XOR rollupVersion=1
		const sepoliaComposite = (11155111 ^ 1) >>> 0
		expect(() => assertLiveChainIdentity({ chainId: sepoliaComposite }, { l1ChainId: 11155111, rollupVersion: 1 })).not.toThrow()
	})

	test("throws when the live node's l1ChainId drifts (chain spoofing defense)", () => {
		expect(() => assertLiveChainIdentity({ chainId: 5 }, { l1ChainId: 31337, rollupVersion: 4 })).toThrow(/Chain identity mismatch/)
	})

	test("throws when the live node's rollupVersion drifts (rollup-version spoofing)", () => {
		// Stored 5 = 1 XOR 4. Live reports same l1ChainId but a different rollupVersion.
		expect(() => assertLiveChainIdentity({ chainId: 5 }, { l1ChainId: 1, rollupVersion: 99 })).toThrow(/Chain identity mismatch/)
	})

	test("skips check for local networks (stored chainId === 0)", () => {
		// Local networks store chainId=0 because the loopback URL allowlist is
		// the substitute defense; the live node's l1ChainId is whatever the
		// local devnet happens to be (anvil typically reports 31337).
		expect(() => assertLiveChainIdentity({ chainId: 0 }, { l1ChainId: 31337, rollupVersion: 0 })).not.toThrow()
		expect(() => assertLiveChainIdentity({ chainId: 0 }, { l1ChainId: 1337, rollupVersion: 42 })).not.toThrow()
	})

	test("error message includes both values so the caller can diagnose", () => {
		const sepoliaComposite = (11155111 ^ 1) >>> 0
		expect(() => assertLiveChainIdentity({ chainId: sepoliaComposite }, { l1ChainId: 1, rollupVersion: 1 })).toThrow(/chainId=11155110/)
		expect(() => assertLiveChainIdentity({ chainId: sepoliaComposite }, { l1ChainId: 1, rollupVersion: 1 })).toThrow(/l1ChainId=1/)
	})
})

describe("chainInfoFrom (F-03 — build the signed identity from a validated nodeInfo)", () => {
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
