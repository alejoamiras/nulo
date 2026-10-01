import { describe, expect, test } from "vitest"
import { CHAIN_IDS } from "@/utils/chain-ids"
import type { Network } from "@/wallet/services/network/client"
import { type VerifyHeaderInput, verifyHeaderLabels } from "./header-labels"

const row = (chainId: number, name: string): Network =>
	({ id: `n-${chainId}`, profileId: "p1", chainId, l1ChainId: 1, name, primaryEndpointId: "e", endpoints: [] }) as Network

/** The seeded networks, as a fresh profile has them. */
const NETWORKS = [row(CHAIN_IDS.TESTNET, "Testnet"), row(0, "Local Network")]

/** Addresses as the wire carries them: `0x` + 64 hex, below the BN254 modulus. */
const ADDRESS_A = `0x${"0a".repeat(32)}`
const ADDRESS_B = `0x${"0b".repeat(32)}`
const onLocal = (address: string) => `aztec:0:${address}`
const onTestnet = (address: string) => `aztec:${CHAIN_IDS.TESTNET}:${address}`

const input = (over: Partial<VerifyHeaderInput> = {}): VerifyHeaderInput => ({
	sessionChainId: "0",
	sharedAccounts: [],
	resolvedAccounts: [],
	networks: NETWORKS,
	...over,
})

describe("windows/verify/header-labels — the network", () => {
	test("chain 0 names the seeded Local Network", () => {
		expect(verifyHeaderLabels(input()).network).toBe("Local Network")
	})

	test("testnet's id names Testnet", () => {
		expect(verifyHeaderLabels(input({ sessionChainId: String(CHAIN_IDS.TESTNET) })).network).toBe("Testnet")
	})

	test("an unconfigured chain names its generic label", () => {
		expect(verifyHeaderLabels(input({ sessionChainId: "424242", networks: [] })).network).toBe("Aztec:424242")
	})
})

describe("windows/verify/header-labels — the account", () => {
	test("with nothing shared it says so beside the session's network, never in orange", () => {
		expect(verifyHeaderLabels(input())).toEqual({ account: "No account shared", network: "Local Network", warn: false })
		expect(verifyHeaderLabels(input({ sessionChainId: String(CHAIN_IDS.TESTNET) }))).toEqual({
			account: "No account shared",
			network: "Testnet",
			warn: false,
		})
	})

	test("once shared, one account is named, two are counted, and unresolved ones show the first address", () => {
		const shared = [onLocal(ADDRESS_A), onLocal(ADDRESS_B)]
		expect(verifyHeaderLabels(input({ sharedAccounts: shared.slice(0, 1), resolvedAccounts: [{ name: "Savings" }] }))).toEqual({
			account: "Savings",
			network: "Local Network",
			warn: false,
		})
		expect(verifyHeaderLabels(input({ sharedAccounts: shared, resolvedAccounts: [{ name: "Savings" }, { name: "Daily" }] }))).toEqual({
			account: "2 accounts",
			network: "Local Network",
			warn: false,
		})
		expect(verifyHeaderLabels(input({ sharedAccounts: shared, resolvedAccounts: [] })).account).toBe("0x0a0a...0a0a")
	})

	test("a shared account on another chain than the session's warns", () => {
		const mixed = input({
			sharedAccounts: [onLocal(ADDRESS_A), onTestnet(ADDRESS_B)],
			resolvedAccounts: [{ name: "Savings" }, { name: "Daily" }],
		})
		expect(verifyHeaderLabels(mixed)).toEqual({ account: "2 accounts", network: "Local Network", warn: true })
	})
})
