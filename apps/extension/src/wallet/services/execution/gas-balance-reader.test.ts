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

	test("invalidateAccount evicts only that account's keys", async () => {
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

	test("clear() drops everything (PrivateFPC mutation path)", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		await reader.get("net-1", "0xacc")
		reader.clear()
		const callsBefore = bvsMock.mock.calls.length
		await reader.get("net-1", "0xacc")
		expect(bvsMock.mock.calls.length).toBeGreaterThan(callsBefore)
	})

	test("PrivateFPC present → second balance_of call populates privateFeeJuice", async () => {
		bvsMock
			.mockReset()
			.mockResolvedValueOnce(encodedResult(100n)) // public
			.mockResolvedValueOnce(encodedResult(55n)) // private via FPC
		const reader = new GasBalanceReader(
			makeDeps({
				getFpcs: async () => [{ type: FpcType.PrivateFpc, address: "0xfpc" } as never],
			}),
		)
		const result = await reader.get("net-1", "0xacc")
		expect(result).toEqual({ publicFeeJuice: "100", privateFeeJuice: "55" })
		expect(bvsMock.mock.calls.length).toBe(2)
	})

	test("public-balance failure degrades to '0' without throwing (error-path parity)", async () => {
		bvsMock.mockReset().mockRejectedValue(new Error("sim down"))
		const reader = new GasBalanceReader(makeDeps())
		const result = await reader.get("net-1", "0xacc")
		expect(result).toEqual({ publicFeeJuice: "0", privateFeeJuice: null })
	})
})
