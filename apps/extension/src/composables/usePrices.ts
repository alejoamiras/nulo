/** Vendor */
import { computed, ref } from "vue"

/** Composables */
import { useTicker } from "@/composables/ticker"

/** Services */
import type { PriceServiceClient, PriceState, PriceQuote } from "@/wallet/services/price/client"
import { isQuoteFresh } from "@/wallet/services/price/spec"
import { getPriceMapEntry, FEE_JUICE_ENTRY } from "@/wallet/services/price/price-map"
import { tokenAmountToUsdMicro, formatUsdMicro } from "@/wallet/services/price/convert"

/**
 * C1 composable over the price feed. Receives the CONNECTED client from the
 * parent (which owns connect/disconnect per the composable conventions) and
 * exposes reactive, freshness-aware quotes.
 *
 * Staleness is re-evaluated against a shared 30s ticker, not only on service
 * events — a quote crossing the 15-min TTL flips to absent without any
 * broadcast. Every fiat surface hides rather than showing a stale number.
 */
export function usePrices(priceService: PriceServiceClient) {
	const quotes = ref<PriceState>({})
	const now = useTicker(30_000)

	const onQuotesUpdated = (state: PriceState) => {
		quotes.value = state
	}
	priceService.onQuotesUpdated.add(onQuotesUpdated)

	// Stale-on-connect refresh; the service no-ops when the cache is fresh
	// (and returns {} when fiat display is disabled).
	const resnapshot = () => {
		priceService
			.refreshIfStale()
			.then(onQuotesUpdated)
			.catch(() => {
				// Price data is best-effort; surfaces render token-only without it.
			})
	}
	resnapshot()
	// Re-snapshot after every reconnect (MV3 SW restarts drop the port): the
	// held quotes may have been invalidated while we were detached — e.g. the
	// kill-switch flipped from another context, whose {} broadcast we missed.
	priceService.onConnected.add(resnapshot)

	/** Fresh usable quotes only (ticker-reactive). */
	const usableQuotes = computed<PriceState>(() => {
		const nowMs = now.value ?? Date.now()
		const usable: PriceState = {}
		for (const [id, quote] of Object.entries(quotes.value)) {
			if (isQuoteFresh(quote, nowMs)) usable[id] = quote
		}
		return usable
	})

	/** Quote for a mapped token, or undefined (unmapped / unpriced / stale / disabled). */
	const quoteFor = (chainId: number | undefined, contract: string | undefined): PriceQuote | undefined => {
		if (chainId === undefined || contract === undefined) return undefined
		const entry = getPriceMapEntry(chainId, contract)
		if (!entry) return undefined
		return usableQuotes.value[entry.coingeckoId]
	}

	/** Fee Juice quote (chain-independent mapping). */
	const feeJuiceQuote = computed<PriceQuote | undefined>(() => usableQuotes.value[FEE_JUICE_ENTRY.coingeckoId])

	/**
	 * Fiat value (micro-USD, summable) of `raw` base units of a token —
	 * undefined when the token has no usable quote.
	 */
	const tokenFiatMicro = (
		token: { chainId?: number; contract?: string; decimals?: number } | undefined,
		raw: bigint,
	): bigint | undefined => {
		if (!token) return undefined
		const quote = quoteFor(token.chainId, token.contract)
		if (!quote) return undefined
		return tokenAmountToUsdMicro(raw, token.decimals ?? 0, quote.usd)
	}

	/** `≈ $1,249.38`-style display string, or undefined when unpriced. */
	const tokenFiatLabel = (
		token: { chainId?: number; contract?: string; decimals?: number } | undefined,
		raw: bigint,
	): string | undefined => {
		const micro = tokenFiatMicro(token, raw)
		if (micro === undefined) return undefined
		return `≈ ${formatUsdMicro(micro)}`
	}

	const dispose = () => {
		priceService.onQuotesUpdated.remove(onQuotesUpdated)
		priceService.onConnected.remove(resnapshot)
	}

	return { usableQuotes, quoteFor, feeJuiceQuote, tokenFiatMicro, tokenFiatLabel, formatUsdMicro, dispose }
}
