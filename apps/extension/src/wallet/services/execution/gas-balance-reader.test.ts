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

	// The two legs are SEPARATE invocations on purpose: the public read rides
	// the direct-to-node fast arm while the PrivateFPC read executes through
	// PXE — different failure domains, so one leg's rejection must never
	// discard the other's result. They launch concurrently.
	function perMethodBvs(impl: { public: () => Promise<unknown>; private: () => Promise<unknown> }) {
		bvsMock.mockReset().mockImplementation((calls: Array<{ method: string }>) => {
			return calls[0]?.method === "balance_of_public" ? impl.public() : impl.private()
		})
	}
	const PRIVATE_FPC_DEPS = { getFpcs: async () => [{ type: FpcType.PrivateFpc, address: "0xfpc" } as never] }

	test("PrivateFPC present → both legs read, result assembled from both", async () => {
		perMethodBvs({ public: async () => encodedResult(100n), private: async () => encodedResult(55n) })
		const reader = new GasBalanceReader(makeDeps(PRIVATE_FPC_DEPS))
		expect(await reader.get("net-1", "0xacc")).toEqual({ publicFeeJuice: "100", privateFeeJuice: "55" })
		expect(bvsMock.mock.calls.length).toBe(2)
	})

	test("a private-leg rejection keeps the successful public balance", async () => {
		perMethodBvs({
			public: async () => encodedResult(100n),
			private: async () => {
				throw new Error("utility sim down")
			},
		})
		const reader = new GasBalanceReader(makeDeps(PRIVATE_FPC_DEPS))
		expect(await reader.get("net-1", "0xacc")).toEqual({ publicFeeJuice: "100", privateFeeJuice: null })
	})

	test("a public-leg rejection keeps the successful private balance", async () => {
		perMethodBvs({
			public: async () => {
				throw new Error("node down")
			},
			private: async () => encodedResult(55n),
		})
		const reader = new GasBalanceReader(makeDeps(PRIVATE_FPC_DEPS))
		expect(await reader.get("net-1", "0xacc")).toEqual({ publicFeeJuice: null, privateFeeJuice: "55" })
	})

	test("legs launch concurrently — FPC discovery is not serialized behind the public read", async () => {
		let resolvePublic!: (v: unknown) => void
		const fpcsSpy = vi.fn(async () => [])
		perMethodBvs({
			public: () =>
				new Promise((r) => {
					resolvePublic = r
				}),
			private: async () => encodedResult(55n),
		})
		const reader = new GasBalanceReader(makeDeps({ getFpcs: fpcsSpy }))
		const pending = reader.get("net-1", "0xacc")
		// Give the concurrent legs a tick to launch, then assert FPC discovery
		// already ran while the public read is still pending.
		await new Promise((r) => setTimeout(r, 0))
		expect(fpcsSpy).toHaveBeenCalled()
		resolvePublic(encodedResult(100n))
		expect(await pending).toEqual({ publicFeeJuice: "100", privateFeeJuice: null })
	})

	test("public-balance failure degrades to NULL (unknown) without throwing", async () => {
		bvsMock.mockReset().mockRejectedValue(new Error("sim down"))
		const reader = new GasBalanceReader(makeDeps())
		const result = await reader.get("net-1", "0xacc")
		expect(result).toEqual({ publicFeeJuice: null, privateFeeJuice: null })
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

	test("an invalidation landing mid-compute stamps that snapshot already-stale", async () => {
		let resolveBvs!: (v: unknown) => void
		bvsMock.mockReset().mockImplementation(
			() =>
				new Promise((r) => {
					resolveBvs = r
				}),
		)
		const reader = new GasBalanceReader(makeDeps())
		const pending = reader.get("net-1", "0xacc")
		await new Promise((r) => setTimeout(r, 0))
		reader.invalidateAccount("0xacc")
		resolveBvs(encodedResult(100n))
		await pending
		// Peekable (dimmed display) but the next get() must recompute.
		expect(reader.peek("net-1", "0xacc")).toEqual({
			balances: { publicFeeJuice: "100", privateFeeJuice: null },
			stale: true,
		})
	})

	test("a forced refresh never joins a pre-invalidation flight — it resolves to post-settlement values", async () => {
		let resolveFirst!: (v: unknown) => void
		bvsMock
			.mockReset()
			.mockImplementationOnce(
				() =>
					new Promise((r) => {
						resolveFirst = r
					}),
			)
			.mockResolvedValue(encodedResult(200n))
		const reader = new GasBalanceReader(makeDeps())
		const preSettlement = reader.get("net-1", "0xacc")
		await new Promise((r) => setTimeout(r, 0))

		// Settlement: facade invalidates, popup force-refreshes.
		reader.invalidateAccount("0xacc")
		const forced = reader.get("net-1", "0xacc", true)

		resolveFirst(encodedResult(100n))
		expect((await preSettlement).publicFeeJuice).toBe("100")
		// The forced read waited out the old flight and recomputed.
		expect((await forced).publicFeeJuice).toBe("200")
		expect(reader.peek("net-1", "0xacc")).toEqual({
			balances: { publicFeeJuice: "200", privateFeeJuice: null },
			stale: false,
		})
	})
})
