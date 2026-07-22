/**
 * `usePrices` composable: reactive quote plumbing (event + initial refresh),
 * price-map resolution, fiat math delegation, ticker-driven staleness, and
 * dispose semantics. The client is faked at the composable's seam.
 */

import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, describe, expect, test, vi } from "vitest"
import { defineComponent, h } from "vue"
import { EventHandler } from "@nulo/wallet-core/utils"
import { CHAIN_IDS } from "@/utils/chain-ids"
import { QUOTE_TTL_MS, type PriceState } from "@/wallet/services/price/spec"
import type { PriceServiceClient } from "@/wallet/services/price/client"
import { usePrices } from "./usePrices"

const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"

function quoteState(now: number, overrides?: Partial<PriceState>): PriceState {
	return {
		"usd-coin": { coingeckoId: "usd-coin", usd: 0.999857, fetchedAt: now, providerUpdatedAt: null },
		aztec: { coingeckoId: "aztec", usd: 0.0147, fetchedAt: now, providerUpdatedAt: null },
		...overrides,
	}
}

function fakeClient(initial: PriceState = {}) {
	return {
		onQuotesUpdated: new EventHandler<PriceState>(),
		onConnected: new EventHandler<void>(),
		refreshIfStale: vi.fn().mockResolvedValue(initial),
	} as unknown as PriceServiceClient & { onQuotesUpdated: EventHandler<PriceState>; refreshIfStale: ReturnType<typeof vi.fn> }
}

/** Mount a host component so useTicker's onUnmounted has a scope. Hosts are
 *  unmounted per-test so the SHARED ticker registry (keyed by period) never
 *  leaks a real-timer interval into a fake-timer test. */
const hosts: { unmount(): void }[] = []
async function withPrices(client: ReturnType<typeof fakeClient>) {
	let api: ReturnType<typeof usePrices> = null as never
	const host = mount(
		defineComponent({
			setup() {
				api = usePrices(client as unknown as PriceServiceClient)
				return () => h("div")
			},
		}),
	)
	hosts.push(host)
	await flushPromises()
	return { api, host }
}

afterEach(() => {
	for (const host of hosts.splice(0)) host.unmount()
	vi.useRealTimers()
})

describe("composables/usePrices", () => {
	test("initial mount refreshes stale-on-connect and adopts the result", async () => {
		const client = fakeClient(quoteState(Date.now()))
		const { api } = await withPrices(client)
		expect(client.refreshIfStale).toHaveBeenCalledTimes(1)
		expect(Object.keys(api.usableQuotes.value).sort()).toEqual(["aztec", "usd-coin"])
	})

	test("a refreshIfStale rejection is swallowed (surfaces render token-only)", async () => {
		const client = fakeClient()
		client.refreshIfStale.mockRejectedValue(new Error("offline"))
		const { api } = await withPrices(client)
		expect(api.usableQuotes.value).toEqual({})
	})

	test("onQuotesUpdated events replace the quote state", async () => {
		const client = fakeClient()
		const { api } = await withPrices(client)
		expect(api.usableQuotes.value).toEqual({})
		client.onQuotesUpdated.invoke(quoteState(Date.now()))
		expect(api.usableQuotes.value["usd-coin"]).toBeDefined()
	})

	test("an empty broadcast (kill-switch) clears every quote", async () => {
		const client = fakeClient(quoteState(Date.now()))
		const { api } = await withPrices(client)
		client.onQuotesUpdated.invoke({})
		expect(api.usableQuotes.value).toEqual({})
	})

	test("quoteFor resolves mapped tokens through the price map", async () => {
		const client = fakeClient(quoteState(Date.now()))
		const { api } = await withPrices(client)
		expect(api.quoteFor(CHAIN_IDS.MAINNET, CUSD)?.coingeckoId).toBe("usd-coin")
		// Case-insensitive contract match.
		expect(api.quoteFor(CHAIN_IDS.MAINNET, CUSD.toUpperCase().replace("0X", "0x"))?.coingeckoId).toBe("usd-coin")
	})

	test("quoteFor is undefined for unmapped tokens and missing args", async () => {
		const client = fakeClient(quoteState(Date.now()))
		const { api } = await withPrices(client)
		expect(api.quoteFor(CHAIN_IDS.MAINNET, "0xdeadbeef")).toBeUndefined()
		expect(api.quoteFor(12345, CUSD)).toBeUndefined()
		expect(api.quoteFor(undefined, undefined)).toBeUndefined()
	})

	test("feeJuiceQuote resolves the chain-independent aztec mapping", async () => {
		const client = fakeClient(quoteState(Date.now()))
		const { api } = await withPrices(client)
		expect(api.feeJuiceQuote.value?.usd).toBe(0.0147)
	})

	test("tokenFiatMicro computes bigint fiat for a priced token, undefined otherwise", async () => {
		const client = fakeClient(quoteState(Date.now()))
		const { api } = await withPrices(client)
		const token = { chainId: CHAIN_IDS.MAINNET, contract: CUSD, decimals: 18 }
		expect(api.tokenFiatMicro(token, 1_250n * 10n ** 18n)).toBe(1_249_821_250n)
		expect(api.tokenFiatMicro({ chainId: 1, contract: "0x1", decimals: 18 }, 10n ** 18n)).toBeUndefined()
		expect(api.tokenFiatMicro(undefined, 10n ** 18n)).toBeUndefined()
	})

	test("tokenFiatLabel renders the ≈-prefixed display string", async () => {
		const client = fakeClient(quoteState(Date.now()))
		const { api } = await withPrices(client)
		const token = { chainId: CHAIN_IDS.MAINNET, contract: CUSD, decimals: 18 }
		expect(api.tokenFiatLabel(token, 1_250n * 10n ** 18n)).toBe("≈ $1,249.82")
		expect(api.tokenFiatLabel({ chainId: 1, contract: "0x1", decimals: 18 }, 1n)).toBeUndefined()
	})

	test("staleness flips reactively via the ticker — a quote crossing the TTL disappears", async () => {
		vi.useFakeTimers()
		const now = Date.now()
		// One quote 30s from expiry, one far from it.
		const client = fakeClient(
			quoteState(now, {
				"usd-coin": { coingeckoId: "usd-coin", usd: 0.999857, fetchedAt: now - QUOTE_TTL_MS + 30_000, providerUpdatedAt: null },
			}),
		)
		const { api } = await withPrices(client)
		expect(api.usableQuotes.value["usd-coin"]).toBeDefined()

		await vi.advanceTimersByTimeAsync(61_000) // two ticker periods past expiry
		expect(api.usableQuotes.value["usd-coin"]).toBeUndefined()
		expect(api.usableQuotes.value.aztec).toBeDefined()
	})

	test("dispose unsubscribes from quote events", async () => {
		const client = fakeClient()
		const { api } = await withPrices(client)
		api.dispose()
		client.onQuotesUpdated.invoke(quoteState(Date.now()))
		expect(api.usableQuotes.value).toEqual({})
	})

	test("client RECONNECT re-snapshots: quotes invalidated while detached are dropped (kill-switch honored)", async () => {
		const client = fakeClient(quoteState(Date.now()))
		const { api } = await withPrices(client)
		expect(Object.keys(api.usableQuotes.value)).toHaveLength(2)

		// While the port was down, fiat was disabled elsewhere — the new SW
		// returns {} on the reconnect resnapshot.
		client.refreshIfStale.mockResolvedValue({})
		;(client as unknown as { onConnected: EventHandler<void> }).onConnected.invoke()
		await flushPromises()

		expect(api.usableQuotes.value).toEqual({})
	})
})
