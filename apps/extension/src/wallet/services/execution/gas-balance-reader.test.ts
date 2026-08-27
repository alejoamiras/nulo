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
		failedLegRetryDelayMs: 0,
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

describe("GasBalanceReader failed-leg retry + degraded caching (cold-start recovery)", () => {
	test("a leg that throws once recovers on the in-compute retry — value present, cached FRESH", async () => {
		// The cold-start shape: the offscreen transport rejects the first read,
		// then is up milliseconds later. The retry converts the would-be "—"
		// into a correct first paint.
		let publicCalls = 0
		bvsMock.mockReset().mockImplementation(() => {
			publicCalls += 1
			if (publicCalls === 1) throw new Error("Offscreen document closed before fully loading")
			return encodedResult(100n)
		})
		const logError = vi.fn()
		const reader = new GasBalanceReader(makeDeps({ logError }))
		expect(await reader.get("net-1", "0xacc")).toEqual({ publicFeeJuice: "100", privateFeeJuice: null })
		expect(publicCalls).toBe(2)
		// A recovered retry is not error-worthy — the old single-shot always
		// paid an error log for a race that healed itself.
		expect(logError).not.toHaveBeenCalled()
		// Recovered snapshot is a normal fresh entry: next get serves the cache.
		await reader.get("net-1", "0xacc")
		expect(publicCalls).toBe(2)
	})

	test("a leg that fails BOTH attempts caches already-stale — next get recomputes instead of serving '—' for the TTL", async () => {
		let fail = true
		bvsMock.mockReset().mockImplementation(() => {
			if (fail) throw new Error("node down")
			return encodedResult(100n)
		})
		const logError = vi.fn()
		const reader = new GasBalanceReader(makeDeps({ logError }))
		expect(await reader.get("net-1", "0xacc")).toEqual({ publicFeeJuice: null, privateFeeJuice: null })
		expect(logError).toHaveBeenCalledTimes(1)
		// Degraded snapshot is peekable (dimmed last-known) but already stale.
		expect(reader.peek("net-1", "0xacc")).toEqual({ balances: { publicFeeJuice: null, privateFeeJuice: null }, stale: true })
		// The transport recovers — the very next get recomputes and repairs.
		fail = false
		expect(await reader.get("net-1", "0xacc")).toEqual({ publicFeeJuice: "100", privateFeeJuice: null })
		expect(reader.peek("net-1", "0xacc")).toEqual({ balances: { publicFeeJuice: "100", privateFeeJuice: null }, stale: false })
	})

	test("a structural null (no PrivateFPC registered) is NOT degraded: no retry, cached fresh", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		expect(await reader.get("net-1", "0xacc")).toEqual({ publicFeeJuice: "100", privateFeeJuice: null })
		// One public read only — the private leg answered definitively (no FPC)
		// without a read, and definitive nulls must not trigger the retry.
		expect(bvsMock.mock.calls.length).toBe(1)
		await reader.get("net-1", "0xacc")
		expect(bvsMock.mock.calls.length).toBe(1)
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

	test("evictAll clears peek — a cross-profile switch leaves no other-profile last-knowns", async () => {
		bvsMock.mockReset().mockResolvedValue(encodedResult(100n))
		const reader = new GasBalanceReader(makeDeps())
		await reader.get("net-1", "0xacc")
		reader.evictAll()
		// No dimmed paint of another profile's figures — cold start.
		expect(reader.peek("net-1", "0xacc")).toBeNull()
		const callsBefore = bvsMock.mock.calls.length
		await reader.get("net-1", "0xacc")
		expect(bvsMock.mock.calls.length).toBeGreaterThan(callsBefore)
	})

	test("a compute in flight across evictAll never writes back — no resurrected peekable entry", async () => {
		// A stale-marked write-back after eviction would resurrect another
		// profile's figures as peekable last-knowns — the exact leak evictAll
		// exists to close.
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
		reader.evictAll()
		resolveBvs(encodedResult(100n))
		// The pre-switch caller still receives its value...
		expect((await pending).publicFeeJuice).toBe("100")
		// ...but nothing survives as a last-known.
		expect(reader.peek("net-1", "0xacc")).toBeNull()
	})

	test("a plain get() after an invalidation never joins the pre-invalidation flight — the value must not cross the fence", async () => {
		// The stale-marking commit only demotes the CACHE entry; the promise
		// value still crosses to joiners. A post-switch joiner would receive
		// balances computed under the previous profile's FPC context.
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
		const preSwitch = reader.get("net-1", "0xacc")
		await new Promise((r) => setTimeout(r, 0))

		// Profile switch mid-flight: facade evicts; the new profile reads.
		reader.evictAll()
		const postSwitch = reader.get("net-1", "0xacc")

		resolveFirst(encodedResult(100n))
		expect((await preSwitch).publicFeeJuice).toBe("100")
		// The post-switch read waited the old flight out and recomputed.
		expect((await postSwitch).publicFeeJuice).toBe("200")
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
