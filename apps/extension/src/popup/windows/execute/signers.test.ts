import { describe, expect, test } from "vitest"
import { uniqueSignerAccounts, uniqueSignerNetworks } from "./signers"

const acc = (address: string, name: string, chainId: number) => ({ address, name, chainId })
const net = (chainId: number, name: string) => ({ id: `n-${chainId}`, chainId, name })

describe("execute/signers", () => {
	test("empty operations → empty signer lists", () => {
		expect(uniqueSignerAccounts([])).toEqual([])
		expect(uniqueSignerNetworks([])).toEqual([])
	})

	test("operation without an account contributes only its network", () => {
		const ops = [{ network: net(1, "n1") } as never]
		expect(uniqueSignerAccounts(ops)).toEqual([])
		expect(uniqueSignerNetworks(ops)).toHaveLength(1)
	})

	test("dedupes signer accounts by address+chain", () => {
		const a = acc("0xabc", "Alpha", 1)
		const ops = [{ network: net(1, "n1"), account: a } as never, { network: net(1, "n1"), account: a } as never]
		expect(uniqueSignerAccounts(ops)).toHaveLength(1)
	})

	test("same address on different chains counts as two signers", () => {
		const ops = [
			{ network: net(1, "n1"), account: acc("0xabc", "Alpha", 1) } as never,
			{ network: net(2, "n2"), account: acc("0xabc", "Alpha", 2) } as never,
		]
		expect(uniqueSignerAccounts(ops)).toHaveLength(2)
	})

	test("dedupes signer networks by chain id", () => {
		const ops = [
			{ network: net(1, "n1"), account: acc("0xabc", "Alpha", 1) } as never,
			{ network: net(1, "n1"), account: acc("0xdef", "Beta", 1) } as never,
		]
		expect(uniqueSignerNetworks(ops)).toHaveLength(1)
	})

	test("preserves first-seen ordering", () => {
		const ops = [
			{ network: net(2, "n2"), account: acc("0xb", "B", 2) } as never,
			{ network: net(1, "n1"), account: acc("0xa", "A", 1) } as never,
		]
		expect(uniqueSignerAccounts(ops).map((a) => a.name)).toEqual(["B", "A"])
		expect(uniqueSignerNetworks(ops).map((n) => n.chainId)).toEqual([2, 1])
	})
})
