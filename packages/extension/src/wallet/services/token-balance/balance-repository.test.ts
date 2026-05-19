import { describe, test, expect, beforeEach } from "vitest"
import { BalanceRepository } from "./balance-repository"
import type { TokenBalanceRaw } from "./spec"

/** The repo uses EntityStorage<TokenBalanceRaw> under the hood, backed
 *  by chrome.storage.local. The global test setup stubs chrome.*. */

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
	let repo: BalanceRepository

	beforeEach(() => {
		// chrome.storage.local is stubbed globally in vitest.setup.ts via
		// chrome.runtime, but EntityStorage talks to chrome.storage.local
		// directly. Supply a minimal in-memory shim so tests can round-trip.
		const backing = new Map<string, unknown>()
		// biome-ignore lint/suspicious/noExplicitAny: test-only global stub
		;(globalThis as any).chrome = {
			// biome-ignore lint/suspicious/noExplicitAny: test-only global stub
			...(globalThis as any).chrome,
			storage: {
				local: {
					QUOTA_BYTES: 10485760,
					get: async (keys: string | string[] | null | undefined) => {
						const result: Record<string, unknown> = {}
						if (keys == null) {
							for (const [k, v] of backing) result[k] = v
						} else if (typeof keys === "string") {
							if (backing.has(keys)) result[keys] = backing.get(keys)
						} else if (Array.isArray(keys)) {
							for (const k of keys) if (backing.has(k)) result[k] = backing.get(k)
						}
						return result
					},
					set: async (items: Record<string, unknown>) => {
						for (const [k, v] of Object.entries(items)) backing.set(k, v)
					},
					remove: async (keys: string | string[]) => {
						const list = Array.isArray(keys) ? keys : [keys]
						for (const k of list) backing.delete(k)
					},
					getKeys: async () => Array.from(backing.keys()),
				},
			},
		}
		repo = new BalanceRepository()
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
		// biome-ignore lint/suspicious/noExplicitAny: inspect the chrome stub
		const local = (globalThis as any).chrome.storage.local
		const keys = await local.getKeys()
		expect(keys.some((k: string) => k.startsWith("nulo:core:token-balances"))).toBe(true)
	})
})
