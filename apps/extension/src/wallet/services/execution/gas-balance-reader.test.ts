/**
 * `GasBalanceReader` — ported facade pins (TTL, forceRefresh,
 * single-flight) plus the invalidation primitives the facade's event
 * subscriptions call (settled-tx per-account eviction, PrivateFPC clear).
 *
 * `compute` is exercised through `get` with a faked batched-view layer
 * via `vi.mock` — the module's value is cache/dedup/invalidations, not
 * the simulation plumbing (covered by batched-view-simulation tests).
 */

import { describe, expect, test, vi } from "vitest"
import { FpcType } from "@/wallet/services/fpc/service"
import { GAS_BALANCE_TTL_MS, GasBalanceReader, type GasBalanceReaderDeps } from "./gas-balance-reader"

const bvsMock = vi.hoisted(() => vi.fn())
vi.mock("./helpers/batched-view-simulation", () => ({
	batchedViewSimulation: bvsMock,
}))

const _BALANCES = { publicFeeJuice: "100", privateFeeJuice: null }

function makeDeps(overrides: Partial<GasBalanceReaderDeps> = {}): GasBalanceReaderDeps {
	return {
		getChainId: async () => 0,
		getViewDeps: async () => ({}) as never,
		getFpcs: async () => [],
		logDebug: () => {},
		logError: () => {},
		...overrides,
	}
}

function encodedResult(value: bigint) {
	return { encoded: [[{ toBigInt: () => value }]], decoded: [] }
}

describe("GasBalanceReader cache contract", () => {
	test("fresh entry served from cache — compute not re-run", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		const first = await reader.get("net-1", "0xacc")
		expect(first.publicFeeJuice).toBe("100")
		const callsAfterFirst = bvsMock.mock.calls.length
		const second = await reader.get("net-1", "0xacc")
		expect(second).toBe(first)
		expect(bvsMock.mock.calls.length).toBe(callsAfterFirst)
	})

	test("TTL expiry forces recompute", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		await reader.get("net-1", "0xacc")
		// Backdate the cached entry past the TTL.
		const cache = (reader as unknown as { cache: Map<string, { result: unknown; fetchedAt: number }> }).cache
		const entry = cache.get("net-1:0xacc")
		if (!entry) throw new Error("entry missing")
		cache.set("net-1:0xacc", { ...entry, fetchedAt: Date.now() - GAS_BALANCE_TTL_MS - 1 })
		const callsBefore = bvsMock.mock.calls.length
		await reader.get("net-1", "0xacc")
		expect(bvsMock.mock.calls.length).toBeGreaterThan(callsBefore)
	})

	test("forceRefresh bypasses a fresh entry", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		await reader.get("net-1", "0xacc")
		const callsBefore = bvsMock.mock.calls.length
		await reader.get("net-1", "0xacc", true)
		expect(bvsMock.mock.calls.length).toBeGreaterThan(callsBefore)
	})

	test("single-flight: concurrent callers share one compute", async () => {
		bvsMock.mockReset().mockImplementation(async () => {
			await new Promise((r) => setTimeout(r, 10))
			return encodedResult(100n)
		})
		const reader = new GasBalanceReader(makeDeps())
		const [a, b] = await Promise.all([reader.get("net-1", "0xacc"), reader.get("net-1", "0xacc")])
		expect(a).toBe(b)
		// One public-balance call total (no PrivateFPC registered).
		expect(bvsMock.mock.calls.length).toBe(1)
	})

	test("invalidateAccount forces recompute for only that account's keys", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		await reader.get("net-1", "0xacc")
		await reader.get("net-1", "0xother")
		reader.invalidateAccount("0xacc")
		const callsBefore = bvsMock.mock.calls.length
		await reader.get("net-1", "0xother") // still cached
		expect(bvsMock.mock.calls.length).toBe(callsBefore)
		await reader.get("net-1", "0xacc") // evicted → recompute
		expect(bvsMock.mock.calls.length).toBeGreaterThan(callsBefore)
	})

	test("invalidateAll() forces recompute for every key (PrivateFPC mutation path)", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		await reader.get("net-1", "0xacc")
		reader.invalidateAll()
		const callsBefore = bvsMock.mock.calls.length
		await reader.get("net-1", "0xacc")
		expect(bvsMock.mock.calls.length).toBeGreaterThan(callsBefore)
	})

	test("PrivateFPC present → ONE batched simulation carries both reads, public leading", async () => {
		// Public first so it stays fast-arm eligible (direct-to-node leading
		// prefix); one invocation instead of two halves the per-read setup
		// (block-header anchor) and the SW→offscreen round-trips.
		bvsMock.mockReset().mockResolvedValue({ encoded: [[{ toBigInt: () => 100n }], [{ toBigInt: () => 55n }]], decoded: [] })
		const reader = new GasBalanceReader(
			makeDeps({
				getFpcs: async () => [{ type: FpcType.PrivateFpc, address: "0xfpc" } as never],
			}),
		)
		const result = await reader.get("net-1", "0xacc")
		expect(result).toEqual({ publicFeeJuice: "100", privateFeeJuice: "55" })
		expect(bvsMock.mock.calls.length).toBe(1)
		const calls = bvsMock.mock.calls[0][0] as Array<{ method: string; contract: unknown }>
		expect(calls).toHaveLength(2)
		expect(calls[0].method).toBe("balance_of_public")
		expect(calls[1].method).toBe("balance_of")
		expect(String(calls[1].contract)).toBe("0xfpc")
	})

	test("public-balance failure degrades to '0' without throwing (error-path parity)", async () => {
		bvsMock.mockReset().mockRejectedValue(new Error("sim down"))
		const reader = new GasBalanceReader(makeDeps())
		const result = await reader.get("net-1", "0xacc")
		expect(result).toEqual({ publicFeeJuice: "0", privateFeeJuice: null })
	})

	test("FPC discovery failure still reads the public balance", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(
			makeDeps({
				getFpcs: async () => {
					throw new Error("fpc svc down")
				},
			}),
		)
		const result = await reader.get("net-1", "0xacc")
		expect(result).toEqual({ publicFeeJuice: "100", privateFeeJuice: null })
	})
})

describe("GasBalanceReader peek (stale-while-revalidate)", () => {
	test("peek with no cached entry returns null", () => {
		const reader = new GasBalanceReader(makeDeps())
		expect(reader.peek("net-1", "0xacc")).toBeNull()
	})

	test("peek after a fetch returns the balances, stale: false", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		await reader.get("net-1", "0xacc")
		expect(reader.peek("net-1", "0xacc")).toEqual({
			balances: { publicFeeJuice: "100", privateFeeJuice: null },
			stale: false,
		})
	})

	test("peek past the TTL returns the last-known balances, stale: true", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		await reader.get("net-1", "0xacc")
		const cache = (reader as unknown as { cache: Map<string, { result: unknown; fetchedAt: number }> }).cache
		const entry = cache.get("net-1:0xacc")
		if (!entry) throw new Error("entry missing")
		cache.set("net-1:0xacc", { ...entry, fetchedAt: Date.now() - GAS_BALANCE_TTL_MS - 1 })
		expect(reader.peek("net-1", "0xacc")).toEqual({
			balances: { publicFeeJuice: "100", privateFeeJuice: null },
			stale: true,
		})
	})

	test("invalidateAccount marks stale instead of deleting — peek keeps serving last-known", async () => {
		// A settled tx must trigger a refresh, but the card should keep the
		// last-known value dimmed rather than fall back to a skeleton.
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		await reader.get("net-1", "0xacc")
		reader.invalidateAccount("0xacc")
		expect(reader.peek("net-1", "0xacc")).toEqual({
			balances: { publicFeeJuice: "100", privateFeeJuice: null },
			stale: true,
		})
	})

	test("invalidateAll() marks everything stale — peek keeps serving last-known", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		await reader.get("net-1", "0xacc")
		reader.invalidateAll()
		expect(reader.peek("net-1", "0xacc")).toEqual({
			balances: { publicFeeJuice: "100", privateFeeJuice: null },
			stale: true,
		})
	})
})
