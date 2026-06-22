/**
 * Pins the token→balance purge cascade: when a token is deleted,
 * `TokenBalanceService.onTokenDeleted` must remove every token-balance row for
 * that token (and emit a delete per row) while leaving other tokens' balances
 * untouched. This is the load-bearing data-integrity hop reached transitively
 * by `NetworkService.purgeChain` → `TokenService.clearChainState` →
 * `onTokenDeleted`; the network coordinator and the `purgeRows` helper are
 * tested elsewhere, but this final hop (a plain loop, not a purgeRows site) had
 * no direct coverage — a broken version would orphan balances from a
 * deleted/purged token. Exercises the REAL handler + REAL BalanceRepository
 * over an in-memory chrome.storage shim (the established repo-test pattern).
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { BalanceRepository } from "./balance-repository"
import { TokenBalanceService } from "./service"
import type { TokenBalanceRaw } from "./spec"

const balance = (id: number, token: number, overrides: Partial<TokenBalanceRaw> = {}): TokenBalanceRaw => ({
	id,
	token,
	account: "0xaccount",
	privateBalance: "0",
	publicBalance: "0",
	updatedAt: 0,
	...overrides,
})

// A token deletion only needs a shape carrying `id` (the filter key) plus the
// fields the projection embeds; the handler is passed the token so
// getTokenBalanceInfo never reaches into the tokens map.
const tokenInfo = (id: number) => ({ id, chainId: 1, name: `T${id}`, symbol: `T${id}`, decimals: 18, contract: `0xtok${id}` }) as never

describe("TokenBalanceService.onTokenDeleted purge cascade", () => {
	let service: TokenBalanceService
	let seedRepo: BalanceRepository

	beforeEach(() => {
		// EntityStorage talks to chrome.storage.local directly; the global setup
		// only stubs chrome.* shallowly. Supply an in-memory backing (the same
		// shim balance-repository.test.ts uses) so the real repo round-trips.
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
						if (keys == null) for (const [k, v] of backing) result[k] = v
						else if (typeof keys === "string") {
							if (backing.has(keys)) result[keys] = backing.get(keys)
						} else if (Array.isArray(keys)) for (const k of keys) if (backing.has(k)) result[k] = backing.get(k)
						return result
					},
					set: async (items: Record<string, unknown>) => {
						for (const [k, v] of Object.entries(items)) backing.set(k, v)
					},
					remove: async (keys: string | string[]) => {
						for (const k of Array.isArray(keys) ? keys : [keys]) backing.delete(k)
					},
					getKeys: async () => Array.from(backing.keys()),
				},
			},
		}
		// A separate repo over the same fixed storage key as the service's
		// internal repo — lets the test seed + assert without reaching privates.
		seedRepo = new BalanceRepository()
		service = new TokenBalanceService(new LoggerStore(new ConfigStore()))
	})

	const invokeDelete = (id: number) =>
		(service as unknown as { onTokenDeleted: (t: ReturnType<typeof tokenInfo>) => Promise<void> }).onTokenDeleted(tokenInfo(id))

	test("removes every balance row for the deleted token, leaves other tokens' rows", async () => {
		await seedRepo.set(balance(1, 1))
		await seedRepo.set(balance(2, 1))
		await seedRepo.set(balance(3, 2))

		await invokeDelete(1)

		const remaining = await seedRepo.getAll()
		expect(remaining.map((b) => b.id).sort()).toEqual([3])
		expect(remaining.every((b) => b.token !== 1)).toBe(true)
	})

	test("emits onTokenBalanceDeleted once per purged row", async () => {
		await seedRepo.set(balance(1, 1))
		await seedRepo.set(balance(2, 1))
		await seedRepo.set(balance(3, 2))

		const emit = vi.spyOn(service as unknown as { emit: (e: string, p: unknown) => void }, "emit")
		await invokeDelete(1)

		const deletes = emit.mock.calls.filter(([e]) => e === "onTokenBalanceDeleted")
		expect(deletes).toHaveLength(2)
	})

	test("deleting a token with no balances is a no-op", async () => {
		await seedRepo.set(balance(3, 2))

		await invokeDelete(1)

		expect((await seedRepo.getAll()).map((b) => b.id)).toEqual([3])
	})
})
