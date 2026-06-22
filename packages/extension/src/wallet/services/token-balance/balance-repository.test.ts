import { describe, test, expect, beforeEach } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { BalanceRepository } from "./balance-repository"
import type { TokenBalanceRaw } from "./spec"

/** The repo uses EntityStorage<TokenBalanceRaw> backed by the injected
 *  `browserApi.storage.local`; tests pass an in-memory `FakeBrowserApi`. */

const balance = (id: number, overrides: Partial<TokenBalanceRaw> = {}): TokenBalanceRaw => ({
	id,
	token: 1,
	account: "0xaccount",
	privateBalance: "0",
	publicBalance: "0",
	updatedAt: 0,
	...overrides,
})

describe("BalanceRepository", () => {
	let api: FakeBrowserApi
	let repo: BalanceRepository

	beforeEach(() => {
		api = new FakeBrowserApi()
		api.reset()
		repo = new BalanceRepository(api)
	})

	test("set then get round-trips a balance", async () => {
		await repo.set(balance(1, { privateBalance: "100", publicBalance: "50" }))
		const got = await repo.get(1)
		expect(got).toEqual(balance(1, { privateBalance: "100", publicBalance: "50" }))
	})

	test("get returns undefined for an unknown id", async () => {
		expect(await repo.get(42)).toBeUndefined()
	})

	test("getAll returns every stored balance", async () => {
		await repo.set(balance(1))
		await repo.set(balance(2, { token: 2 }))
		const all = await repo.getAll()
		expect(all).toHaveLength(2)
		expect(all.map((b) => b.id).sort()).toEqual([1, 2])
	})

	test("delete removes a balance", async () => {
		await repo.set(balance(1))
		await repo.delete(1)
		expect(await repo.get(1)).toBeUndefined()
	})

	test("allocateId returns max+1", async () => {
		expect(await repo.allocateId()).toBe(1) // empty map → 0 + 1
		await repo.set(balance(1))
		await repo.set(balance(7))
		await repo.set(balance(3))
		expect(await repo.allocateId()).toBe(8)
	})

	test("existsByTokenAndAccount", async () => {
		await repo.set(balance(1, { token: 5, account: "0xA" }))
		expect(await repo.existsByTokenAndAccount(5, "0xA")).toBe(true)
		expect(await repo.existsByTokenAndAccount(5, "0xB")).toBe(false)
		expect(await repo.existsByTokenAndAccount(6, "0xA")).toBe(false)
	})

	test("storage key is nulo:core:token-balances (frozen invariant)", async () => {
		await repo.set(balance(1))
		const all = await api.storage.local.get()
		expect(Object.keys(all).some((k) => k.startsWith("nulo:core:token-balances"))).toBe(true)
	})
})
