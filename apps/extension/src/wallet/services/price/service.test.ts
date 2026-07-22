/**
 * Unit tests for `PriceService`: fetch/validate/cache pipeline, the
 * `showFiatValues` kill-switch (generation guard), unlock-gated alarm
 * lifecycle, backoff, monotonic writes, and read-time staleness.
 *
 * Collaborators are faked at the ServiceCollection seam (config + profile)
 * and the network seam (`fetchFn`); storage + alarms run on FakeBrowserApi.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { fakeBrowser } from "@webext-core/fake-browser"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceCollection } from "@/wallet/base"
import { LoggerStore } from "@/wallet/logger"
import { ConfigStore } from "@/wallet/config"
import { CONFIG_SERVICE_NAME } from "@/wallet/services/config/spec"
import { PROFILE_SERVICE_NAME, type ProfileInfo } from "@/wallet/services/profile/spec"
import { PRICE_REFRESH_ALARM_NAME, PriceService, QUOTE_TTL_MS, type PriceState } from "./service"

type FetchResponse = { ok: boolean; status: number; json(): Promise<unknown> }

const PROFILE: ProfileInfo = { id: "p1", name: "Test" } as ProfileInfo

function goodBody(nowSec: number): unknown {
	return {
		aztec: { usd: 0.0147, last_updated_at: nowSec },
		"usd-coin": { usd: 0.9998, last_updated_at: nowSec },
	}
}

async function harness(opts?: { enabled?: boolean; profile?: ProfileInfo | undefined; body?: unknown; start?: boolean }) {
	await fakeBrowser.reset()
	const logger = new LoggerStore(new ConfigStore())
	const browserApi = new FakeBrowserApi()

	const state = {
		nowMs: 1_000_000_000,
		enabled: opts?.enabled ?? true,
		profile: "profile" in (opts ?? {}) ? opts?.profile : PROFILE,
		body: opts?.body ?? goodBody(1_000_000),
		fetchCalls: [] as string[],
		fetchImpl: undefined as undefined | (() => Promise<FetchResponse>),
	}

	const fakeConfig = {
		name: CONFIG_SERVICE_NAME,
		start: async () => {},
		onUpdate: new EventHandler<{ key: string; value: unknown }>(),
		getValue: async (key: string) => (key === "showFiatValues" ? state.enabled : undefined),
	}
	const fakeProfile = {
		name: PROFILE_SERVICE_NAME,
		start: async () => {},
		onActiveProfileChanged: new EventHandler<ProfileInfo | undefined>(),
		getActiveProfile: async () => state.profile,
	}

	const fetchFn = vi.fn(async (url: string): Promise<FetchResponse> => {
		state.fetchCalls.push(url)
		if (state.fetchImpl) return state.fetchImpl()
		return { ok: true, status: 200, json: async () => state.body }
	})

	const service = new PriceService(logger, browserApi, { fetchFn, now: () => state.nowMs })

	const services = new ServiceCollection()
	// biome-ignore lint/suspicious/noExplicitAny: minimal IService fakes at the collection seam
	services.add(fakeConfig as any)
	// biome-ignore lint/suspicious/noExplicitAny: minimal IService fakes at the collection seam
	services.add(fakeProfile as any)
	services.add(service)
	if (opts?.start !== false) {
		await services.start()
	}

	return { service, services, state, fetchFn, fakeConfig, fakeProfile, browserApi }
}

async function alarmExists(): Promise<boolean> {
	const alarm = await fakeBrowser.alarms.get(PRICE_REFRESH_ALARM_NAME)
	return alarm !== undefined
}

beforeEach(() => {
	vi.restoreAllMocks()
})

describe("PriceService — refresh pipeline", () => {
	test("fetches the full mapped id set in one batched, stable request", async () => {
		const { service, state } = await harness()
		const quotes = await service.refreshIfStale()
		expect(state.fetchCalls).toHaveLength(1)
		expect(state.fetchCalls[0]).toContain("ids=aztec,usd-coin")
		expect(state.fetchCalls[0]).toContain("vs_currencies=usd")
		expect(state.fetchCalls[0]).toContain("include_last_updated_at=true")
		expect(quotes.aztec?.usd).toBe(0.0147)
		expect(quotes["usd-coin"]?.usd).toBe(0.9998)
	})

	test("emits onQuotesUpdated after a successful refresh", async () => {
		const { service } = await harness()
		const seen: PriceState[] = []
		service.onQuotesUpdated.add((s) => seen.push(s))
		await service.refreshIfStale()
		expect(seen).toHaveLength(1)
		expect(Object.keys(seen[0]).sort()).toEqual(["aztec", "usd-coin"])
	})

	test("fresh cache short-circuits: second refreshIfStale does not fetch", async () => {
		const { service, state } = await harness()
		await service.refreshIfStale()
		await service.refreshIfStale()
		expect(state.fetchCalls).toHaveLength(1)
	})

	test("a permanently-missing id does NOT turn every refreshIfStale into a fetch (watermark)", async () => {
		// Provider only knows usd-coin; aztec is delisted.
		const { service, state } = await harness({ body: { "usd-coin": { usd: 0.9998 } } })
		await service.refreshIfStale()
		expect(state.fetchCalls).toHaveLength(1)
		// Cache is incomplete but the fetch just completed — no refetch storm.
		await service.refreshIfStale()
		await service.refreshIfStale()
		expect(state.fetchCalls).toHaveLength(1)
		// Past the refresh period the incomplete cache MAY refetch again.
		state.nowMs += 3 * 60_000 + 1
		await service.refreshIfStale()
		expect(state.fetchCalls).toHaveLength(2)
	})

	test("onAlarmTick while DISABLED reconciles the stray alarm away", async () => {
		const { service, state } = await harness()
		expect(await alarmExists()).toBe(true)
		state.enabled = false
		await service.onAlarmTick()
		expect(state.fetchCalls).toHaveLength(0)
		expect(await alarmExists()).toBe(false)
	})

	test("concurrent refreshes share one in-flight request", async () => {
		const { service, state } = await harness()
		await Promise.all([service.refreshIfStale(), service.refreshIfStale(), service.refreshIfStale()])
		expect(state.fetchCalls).toHaveLength(1)
	})

	test("malformed rows are dropped; a fully-invalid response counts as failure", async () => {
		const { service, state } = await harness({
			body: { aztec: { usd: "not-a-number" }, "usd-coin": { usd: -3 } },
		})
		const quotes = await service.refreshIfStale()
		expect(quotes).toEqual({})
		// Failure set a backoff window: an immediate retry must not fetch.
		await service.refreshIfStale()
		expect(state.fetchCalls).toHaveLength(1)
	})

	test("sanity bands reject out-of-band quotes per id", async () => {
		const { service } = await harness({
			body: { aztec: { usd: 0.0147 }, "usd-coin": { usd: 50 } }, // USDC at $50 is provider garbage.
		})
		const quotes = await service.refreshIfStale()
		expect(quotes.aztec).toBeDefined()
		expect(quotes["usd-coin"]).toBeUndefined()
	})

	test("HTTP failure backs off, then retries after the window", async () => {
		const { service, state } = await harness()
		state.fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) })
		expect(await service.refreshIfStale()).toEqual({})
		expect(state.fetchCalls).toHaveLength(1)

		// Within the backoff window: suppressed.
		await service.refreshIfStale()
		expect(state.fetchCalls).toHaveLength(1)

		// Past the (jittered ≤ 1.25×base) window: retried.
		state.nowMs += 60_000
		state.fetchImpl = undefined
		const quotes = await service.refreshIfStale()
		expect(state.fetchCalls).toHaveLength(2)
		expect(quotes.aztec).toBeDefined()
	})

	test("a newer stored quote is never overwritten by an older response (monotonic)", async () => {
		const { service, state } = await harness()
		await service.refreshIfStale()
		const first = await service.getQuotes()

		// Simulate a late response: rewind the clock so the incoming quote is older.
		state.nowMs -= 5_000
		state.body = { aztec: { usd: 0.5 }, "usd-coin": { usd: 0.5 } }
		// Force staleness check to still see fresh cache? No — drive refresh directly
		// via the alarm path, which always attempts when not backed off.
		await service.onAlarmTick()
		state.nowMs += 5_000

		const after = await service.getQuotes()
		expect(after.aztec?.usd).toBe(first.aztec?.usd)
	})
})

describe("PriceService — staleness", () => {
	test("quotes older than the TTL are absent from reads", async () => {
		const { service, state } = await harness()
		await service.refreshIfStale()
		state.nowMs += QUOTE_TTL_MS + 1
		expect(await service.getQuotes()).toEqual({})
	})

	test("provider-stale data (old last_updated_at) is treated as stale", async () => {
		const nowSec = 1_000_000
		const { service, state } = await harness({
			body: {
				aztec: { usd: 0.0147, last_updated_at: nowSec - (QUOTE_TTL_MS / 1000 + 60) },
				"usd-coin": { usd: 0.9998, last_updated_at: nowSec },
			},
		})
		state.nowMs = nowSec * 1000
		const quotes = await service.refreshIfStale()
		expect(quotes.aztec).toBeUndefined()
		expect(quotes["usd-coin"]).toBeDefined()
	})
})

describe("PriceService — kill switch (showFiatValues)", () => {
	test("disabled: getQuotes is empty and nothing is fetched", async () => {
		const { service, state } = await harness({ enabled: false })
		expect(await service.getQuotes()).toEqual({})
		expect(await service.refreshIfStale()).toEqual({})
		expect(state.fetchCalls).toHaveLength(0)
	})

	test("flipping off clears the alarm + cache and emits empty state", async () => {
		const { service, state, fakeConfig } = await harness()
		await service.refreshIfStale()
		expect(await alarmExists()).toBe(true)

		const seen: PriceState[] = []
		service.onQuotesUpdated.add((s) => seen.push(s))
		state.enabled = false
		fakeConfig.onUpdate.invoke({ key: "showFiatValues", value: false })
		await vi.waitFor(() => {
			expect(seen.at(-1)).toEqual({})
		})
		expect(await alarmExists()).toBe(false)
		expect(await service.getQuotes()).toEqual({})
	})

	test("a late in-flight response cannot repopulate a cleared cache", async () => {
		const { service, state, fakeConfig } = await harness()
		let release: (() => void) | undefined
		state.fetchImpl = () =>
			new Promise((resolve) => {
				release = () => resolve({ ok: true, status: 200, json: async () => goodBody(1_000_000) })
			})

		const pending = service.refreshIfStale()
		await vi.waitFor(() => expect(release).toBeDefined())

		state.enabled = false
		fakeConfig.onUpdate.invoke({ key: "showFiatValues", value: false })
		await vi.waitFor(async () => {
			expect(await alarmExists()).toBe(false)
		})

		release?.()
		await pending
		state.enabled = true
		expect(await service.getQuotes()).toEqual({})
	})

	test("flipping back on while unlocked re-creates the alarm and refreshes", async () => {
		const { service, state, fakeConfig, fetchFn } = await harness({ enabled: false })
		expect(await alarmExists()).toBe(false)
		state.enabled = true
		fakeConfig.onUpdate.invoke({ key: "showFiatValues", value: true })
		await vi.waitFor(async () => {
			expect(await alarmExists()).toBe(true)
			expect(fetchFn).toHaveBeenCalled()
		})
		expect(Object.keys(await service.getQuotes())).toHaveLength(2)
	})
})

describe("PriceService — unlock-gated alarm lifecycle", () => {
	test("boot reconcile: unlocked + enabled → alarm exists", async () => {
		await harness()
		expect(await alarmExists()).toBe(true)
	})

	test("boot reconcile: locked → stray alarm cleared", async () => {
		await fakeBrowser.reset()
		await fakeBrowser.alarms.create(PRICE_REFRESH_ALARM_NAME, { periodInMinutes: 3 })
		const logger = new LoggerStore(new ConfigStore())
		const browserApi = new FakeBrowserApi()
		const fakeConfig = {
			name: CONFIG_SERVICE_NAME,
			start: async () => {},
			onUpdate: new EventHandler<{ key: string; value: unknown }>(),
			getValue: async () => true,
		}
		const fakeProfile = {
			name: PROFILE_SERVICE_NAME,
			start: async () => {},
			onActiveProfileChanged: new EventHandler<ProfileInfo | undefined>(),
			getActiveProfile: async () => undefined,
		}
		const service = new PriceService(logger, browserApi, { fetchFn: async () => ({ ok: true, status: 200, json: async () => ({}) }) })
		const services = new ServiceCollection()
		// biome-ignore lint/suspicious/noExplicitAny: minimal IService fakes at the collection seam
		services.add(fakeConfig as any)
		// biome-ignore lint/suspicious/noExplicitAny: minimal IService fakes at the collection seam
		services.add(fakeProfile as any)
		services.add(service)
		await services.start()
		expect(await alarmExists()).toBe(false)
	})

	test("lock clears the alarm; unlock re-creates it and refreshes", async () => {
		const { state, fakeProfile, fetchFn } = await harness()
		fakeProfile.onActiveProfileChanged.invoke(undefined)
		await vi.waitFor(async () => {
			expect(await alarmExists()).toBe(false)
		})

		state.profile = PROFILE
		fakeProfile.onActiveProfileChanged.invoke(PROFILE)
		await vi.waitFor(async () => {
			expect(await alarmExists()).toBe(true)
			expect(fetchFn).toHaveBeenCalled()
		})
	})

	test("onAlarmTick while locked reconciles (clears) instead of fetching", async () => {
		const { service, state } = await harness()
		state.profile = undefined
		await service.onAlarmTick()
		expect(state.fetchCalls).toHaveLength(0)
		expect(await alarmExists()).toBe(false)
	})
})

describe("PriceService — SW-side reads", () => {
	test("getUsableQuote is cache-or-nothing: never fetches", async () => {
		const { service, state } = await harness()
		expect(await service.getUsableQuote("aztec")).toBeUndefined()
		expect(state.fetchCalls).toHaveLength(0)

		await service.refreshIfStale()
		const quote = await service.getUsableQuote("aztec")
		expect(quote?.usd).toBe(0.0147)
	})

	test("read-time validation drops tampered cache rows", async () => {
		const { service, browserApi } = await harness()
		await service.refreshIfStale()
		// Simulate another extension context poisoning the cache.
		await browserApi.storage.local.set({
			"nulo:core:token-prices": JSON.stringify({
				aztec: { coingeckoId: "aztec", usd: 9_999_999, fetchedAt: Date.now(), providerUpdatedAt: null },
				bogus: { coingeckoId: "bogus", usd: 1, fetchedAt: Date.now(), providerUpdatedAt: null },
			}),
		})
		const quotes = await service.getQuotes()
		expect(quotes.aztec).toBeUndefined()
		expect(quotes.bogus).toBeUndefined()
	})
})

describe("PriceService — post-ship audit pins (codex B)", () => {
	test("kill-switch flipping DURING a refreshIfStale entry aborts BEFORE the fetch fires", async () => {
		const { service, state, fakeConfig, fetchFn } = await harness()
		// Slow config read: the disable lands while refreshIfStale is awaiting
		// isEnabled() — after the entry-time generation was captured.
		const origGetValue = fakeConfig.getValue
		fakeConfig.getValue = async (key: string) => {
			const value = await origGetValue(key)
			// The user disables fiat display exactly here.
			state.enabled = false
			fakeConfig.onUpdate.invoke({ key: "showFiatValues", value: false })
			await new Promise((r) => setTimeout(r, 5))
			return value
		}
		const quotes = await service.refreshIfStale()
		expect(quotes).toEqual({})
		expect(fetchFn).not.toHaveBeenCalled()
	})

	test("future-dated cache rows are INVALID: they neither serve nor block a repair-refresh", async () => {
		const { service, state, browserApi } = await harness()
		// Attacker/corruption plants far-future rows for BOTH mapped ids —
		// in-band prices, so only the timestamp is wrong.
		await browserApi.storage.local.set({
			"nulo:core:token-prices": JSON.stringify({
				aztec: { coingeckoId: "aztec", usd: 90, fetchedAt: state.nowMs + 10 * 365 * 24 * 3_600_000, providerUpdatedAt: null },
				"usd-coin": {
					coingeckoId: "usd-coin",
					usd: 4,
					fetchedAt: state.nowMs + 10 * 365 * 24 * 3_600_000,
					providerUpdatedAt: null,
				},
			}),
		})
		expect(await service.getQuotes()).toEqual({})
		// A refresh repairs the cache: the merge must not let the planted
		// future rows win on their fetchedAt.
		const quotes = await service.refreshIfStale()
		expect(quotes.aztec?.usd).toBe(0.0147)
		expect(quotes["usd-coin"]?.usd).toBe(0.9998)
	})
})
