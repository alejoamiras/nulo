import {
	formatCaipAccount as bridgeFormatCaipAccount,
	formatCaipChain as bridgeFormatCaipChain,
	parseCaipAccount as bridgeParseCaipAccount,
	resolveNetworkByChainId as bridgeResolveNetworkByChainId,
} from "@nulo/wallet-bridge"
import { describe, expect, test } from "vitest"
import { AZTEC_NAMESPACE, formatCaipAccount, formatCaipChain, parseCaipAccount, parseCaipChain, resolveNetworkByChainId } from "./caip"

describe("CAIP helpers", () => {
	test("AZTEC_NAMESPACE is 'aztec'", () => {
		expect(AZTEC_NAMESPACE).toBe("aztec")
	})

	describe("formatCaipChain", () => {
		test("builds aztec:<chainId>", () => {
			expect(formatCaipChain(42)).toBe("aztec:42")
			expect(formatCaipChain(0)).toBe("aztec:0")
		})
	})

	describe("formatCaipAccount", () => {
		test("builds aztec:<chainId>:<address>", () => {
			expect(formatCaipAccount(31337, "0xdeadbeef")).toBe("aztec:31337:0xdeadbeef")
		})
	})

	describe("parseCaipChain", () => {
		test("parses valid chain identifier", () => {
			expect(parseCaipChain("aztec:31337")).toEqual({ chainId: 31337 })
			expect(parseCaipChain("aztec:0")).toEqual({ chainId: 0 })
		})

		test("throws on wrong namespace", () => {
			expect(() => parseCaipChain("eip155:1")).toThrow(/Invalid CAIP chain/)
		})

		test("throws on missing chainId", () => {
			expect(() => parseCaipChain("aztec:")).toThrow(/Invalid chainId/)
		})

		test("throws on non-numeric chainId", () => {
			expect(() => parseCaipChain("aztec:mainnet")).toThrow(/Invalid chainId/)
		})

		test("throws on extra segments", () => {
			expect(() => parseCaipChain("aztec:1:foo")).toThrow(/Invalid CAIP chain/)
		})
	})

	describe("parseCaipAccount", () => {
		test("parses valid account identifier", () => {
			expect(parseCaipAccount("aztec:31337:0xabc")).toEqual({ chainId: 31337, address: "0xabc" })
		})

		test("throws on wrong namespace", () => {
			expect(() => parseCaipAccount("eip155:1:0xabc")).toThrow(/Invalid CAIP account/)
		})

		test("throws on missing chainId", () => {
			expect(() => parseCaipAccount("aztec::0xabc")).toThrow(/Invalid chainId/)
		})

		test("throws on missing address", () => {
			expect(() => parseCaipAccount("aztec:1:")).toThrow(/Missing address/)
		})

		test("throws on chain-only identifier", () => {
			expect(() => parseCaipAccount("aztec:1")).toThrow(/Invalid CAIP account/)
		})
	})

	describe("resolveNetworkByChainId", () => {
		test("returns the only network for a chainId (M4.10: 1 Network per chain)", async () => {
			const networks = [{ id: "b", chainId: 1 }]
			const service = { getNetworks: async () => networks }
			await expect(resolveNetworkByChainId(service, 1)).resolves.toBe(networks[0])
		})

		test("returns the first network when multiple are present (transient)", async () => {
			// The current network model guarantees exactly one `Network` per
			// `(profileId, chainId)`, so `networks[0]` is the unambiguous
			// answer. This test guards against regressions if backing storage
			// temporarily returns multiple rows.
			const networks = [
				{ id: "a", chainId: 1 },
				{ id: "b", chainId: 1 },
			]
			const service = { getNetworks: async () => networks }
			await expect(resolveNetworkByChainId(service, 1)).resolves.toBe(networks[0])
		})

		test("throws when no networks are configured for the chainId", async () => {
			const service = { getNetworks: async () => [] }
			await expect(resolveNetworkByChainId(service, 42)).rejects.toThrow(/No network configured for chainId 42/)
		})

		test("passes chainId through to the service", async () => {
			let seen: number | undefined
			const service = {
				getNetworks: async (chainId: number) => {
					seen = chainId
					return [{ id: "a", chainId }]
				},
			}
			await resolveNetworkByChainId(service, 31337)
			expect(seen).toBe(31337)
		})
	})
})

describe("CAIP single-owner parity with @nulo/wallet-bridge", () => {
	// The format / parse-account / resolve helpers are single-owned by the bridge
	// and re-exported from `./caip`. Pin that the extension surface IS the
	// bridge's implementation — a divergent local re-copy would break the
	// reference identity (and, defensively, the fixed-vector output).
	test("re-exported helpers are the bridge's own references", () => {
		expect(formatCaipChain).toBe(bridgeFormatCaipChain)
		expect(formatCaipAccount).toBe(bridgeFormatCaipAccount)
		expect(parseCaipAccount).toBe(bridgeParseCaipAccount)
		expect(resolveNetworkByChainId).toBe(bridgeResolveNetworkByChainId)
	})

	test("identical output for a fixed vector", () => {
		expect(formatCaipChain(31337)).toBe(bridgeFormatCaipChain(31337))
		expect(formatCaipAccount(31337, "0xabc")).toBe(bridgeFormatCaipAccount(31337, "0xabc"))
		expect(parseCaipAccount("aztec:31337:0xabc")).toEqual(bridgeParseCaipAccount("aztec:31337:0xabc"))
	})
})
