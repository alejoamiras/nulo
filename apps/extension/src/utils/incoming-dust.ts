/**
 * USD-value dust filter, shared by the incoming-receive feed and the Holdings fold. Pure integer
 * math — the only float is the provider's `usd` rate, snapped once to micro-USD via
 * `rateToMicroUsd`. The threshold/value comparison is by CROSS-MULTIPLICATION so there is NO
 * half-up value rounding at the boundary (rounding the value to micro-USD would carry a ±0.5
 * micro-USD ambiguity; cross-multiplication is exact). Fail-OPEN everywhere: a missing mapping /
 * unavailable quote / unparseable amount / invalid decimals → shown.
 */
import { USD_MICRO_PER_USD, rateToMicroUsd } from "@/wallet/services/price/convert"
import { isValidDecimals } from "@/utils/token-amount"

/** Convert the `incomingDustUsdThreshold` config number (USD) to micro-USD. `0`/invalid → `0n` (off). */
export function usdThresholdToMicro(threshold: number): bigint {
	if (!Number.isFinite(threshold) || threshold <= 0) return 0n
	return BigInt(Math.round(threshold * Number(USD_MICRO_PER_USD)))
}

/**
 * Whether an amount is AT OR ABOVE the dust threshold (i.e. SHOWN). Returns `true` (shown) when
 * the filter is off (`thresholdMicro <= 0`), the token has no fresh USD rate (`usdRate ===
 * undefined` — no CoinGecko mapping OR only a stale quote), the amount is unparseable/negative, or
 * `decimals` is not an integer in 0..77 (the exponent is never computed for those). Otherwise
 * SHOWN iff `amountRaw × rateMicro >= thresholdMicro × 10^decimals`.
 */
export function isAmountAboveDustThreshold(params: {
	amountRaw: string
	decimals: number
	/** Fresh USD-per-whole-token rate, or `undefined` when unavailable (→ fail open). */
	usdRate: number | undefined
	thresholdMicro: bigint
}): boolean {
	if (params.thresholdMicro <= 0n) return true
	if (params.usdRate === undefined) return true
	if (!isValidDecimals(params.decimals)) return true
	try {
		const amount = BigInt(params.amountRaw)
		if (amount < 0n) return true
		const rateMicro = rateToMicroUsd(params.usdRate)
		return amount * rateMicro >= params.thresholdMicro * 10n ** BigInt(params.decimals)
	} catch {
		return true
	}
}

/** The incoming feed's name for the same predicate — a receipt is an amount. */
export const isReceiptAboveDustThreshold = isAmountAboveDustThreshold
