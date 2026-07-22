/**
 * USD-value dust filter for the incoming-receive feed (D8). Pure integer math — the only float is
 * the provider's `usd` rate, snapped once to micro-USD via `rateToMicroUsd`. The threshold/value
 * comparison is by CROSS-MULTIPLICATION so there is NO half-up value rounding at the boundary
 * (rounding the value to micro-USD would carry a ±0.5 micro-USD ambiguity; cross-multiplication is
 * exact). Fail-OPEN everywhere: a missing mapping / unavailable quote / unparseable amount → shown.
 */
import { USD_MICRO_PER_USD, rateToMicroUsd } from "@/wallet/services/price/convert"

/** Convert the `incomingDustUsdThreshold` config number (USD) to micro-USD. `0`/invalid → `0n` (off). */
export function usdThresholdToMicro(threshold: number): bigint {
	if (!Number.isFinite(threshold) || threshold <= 0) return 0n
	return BigInt(Math.round(threshold * Number(USD_MICRO_PER_USD)))
}

/**
 * Whether a receipt is AT OR ABOVE the dust threshold (i.e. SHOWN in the feed). Returns `true`
 * (shown) when the filter is off (`thresholdMicro <= 0`), the token has no fresh USD rate
 * (`usdRate === undefined` — no CoinGecko mapping OR only a stale quote), or the amount is
 * unparseable/negative. Otherwise SHOWN iff `amountRaw × rateMicro >= thresholdMicro × 10^decimals`.
 */
export function isReceiptAboveDustThreshold(params: {
	amountRaw: string
	decimals: number
	/** Fresh USD-per-whole-token rate, or `undefined` when unavailable (→ fail open). */
	usdRate: number | undefined
	thresholdMicro: bigint
}): boolean {
	if (params.thresholdMicro <= 0n) return true
	if (params.usdRate === undefined) return true
	let amount: bigint
	try {
		amount = BigInt(params.amountRaw)
	} catch {
		return true
	}
	if (amount < 0n) return true
	let rateMicro: bigint
	try {
		rateMicro = rateToMicroUsd(params.usdRate)
	} catch {
		return true
	}
	return amount * rateMicro >= params.thresholdMicro * 10n ** BigInt(params.decimals)
}
