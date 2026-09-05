import { describe, expect, test } from "vitest"
import { CHAIN_IDS } from "@/utils/chain-ids"
import type { Network } from "@/wallet/services/network/client"
import { resolveDappChain } from "./chain-mismatch"

const row = (chainId: number, name: string): Network =>
	({ id: `n-${chainId}`, profileId: "p1", chainId, l1ChainId: 1, name, primaryEndpointId: "e", endpoints: [] }) as Network

const networks = [row(CHAIN_IDS.MAINNET, "Alpha V5"), row(CHAIN_IDS.TESTNET, "Testnet"), row(0, "Local Network")]

describe("windows/capabilities/chain-mismatch", () => {
	test("a known chain resolves to its row, its name, and mismatch against another active chain", () => {
		const view = resolveDappChain(String(CHAIN_IDS.TESTNET), networks, CHAIN_IDS.MAINNET)
		expect(view).toMatchObject({ chainId: CHAIN_IDS.TESTNET, name: "Testnet", mismatch: true })
		expect(view.network?.id).toBe(`n-${CHAIN_IDS.TESTNET}`)
	})

	test("the same active chain is not a mismatch", () => {
		expect(resolveDappChain(String(CHAIN_IDS.TESTNET), networks, CHAIN_IDS.TESTNET).mismatch).toBe(false)
	})

	test("a renamed row wins over the built-in label", () => {
		const renamed = [row(CHAIN_IDS.TESTNET, "My testnet")]
		expect(resolveDappChain(String(CHAIN_IDS.TESTNET), renamed, undefined).name).toBe("My testnet")
	})

	test("an id with no row falls back to the built-in label and has no switch target", () => {
		const view = resolveDappChain(String(CHAIN_IDS.TESTNET), [], CHAIN_IDS.MAINNET)
		expect(view.name).toBe("Testnet")
		expect(view.network).toBeUndefined()
		expect(view.mismatch).toBe(true)
	})

	test("an unknown id gets the generic label", () => {
		expect(resolveDappChain("424242", networks, CHAIN_IDS.MAINNET).name).toBe("Aztec:424242")
	})

	test("no active network yet → no mismatch", () => {
		expect(resolveDappChain("0", networks, undefined).mismatch).toBe(false)
	})

	test("chain 0 (Local Network) is a real chain, not a falsy miss", () => {
		const view = resolveDappChain("0", networks, CHAIN_IDS.TESTNET)
		expect(view).toMatchObject({ chainId: 0, name: "Local Network", mismatch: true })
		expect(view.network?.id).toBe("n-0")
	})
})
