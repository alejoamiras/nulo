/**
 * Pure fiat conversion helpers. Everything stays in the bigint domain — the
 * only float is the provider's `usd` rate, snapped once to micro-USD
 * precision (1e-6), mirroring `feeToUsd`'s scaled-rate approach.
 *
 * Rounding contract:
 * - token → USD (display): half-up. A cost/value label may round either way;
 *   half-up matches the existing fee display.
 * - USD → token (C3 send input): round DOWN, always. The wallet must never
 *   derive MORE token units than the typed dollars are worth.
 */

import { formatBaseUnits } from "@/utils/amount"

/** Micro-USD: all USD math runs at 1e-6 precision. */
export const USD_MICRO_PER_USD = 1_000_000n

/**
 * Snap a provider rate (USD per whole token) to micro-USD-per-token.
 * Throws on rates that don't survive the snap — callers only hold rates
 * that already passed the price-map sanity bands, so a throw here means
 * a programming error, not bad provider data.
 */
export function rateToMicroUsd(usd: number): bigint {
	if (!Number.isFinite(usd) || usd <= 0) {
		throw new Error("invalid usd rate")
	}
	const micro = BigInt(Math.round(usd * 1_000_000))
	if (micro <= 0n) {
		throw new Error("usd rate below micro-USD precision")
	}
	return micro
}

/** Ceiling variant for the C3 INVERSE only: a rate rounded DOWN would let the
 *  derived token amount exceed the typed dollars' true worth by a hair — the
 *  inverse must divide by a rate ≥ the real one (fewer tokens, never more). */
export function rateToMicroUsdCeil(usd: number): bigint {
	if (!Number.isFinite(usd) || usd <= 0) {
		throw new Error("invalid usd rate")
	}
	const micro = BigInt(Math.ceil(usd * 1_000_000))
	if (micro <= 0n) {
		throw new Error("usd rate below micro-USD precision")
	}
	return micro
}

/**
 * Machine-format micro-USD as a PLAIN decimal string ("1250.5" — dot decimal,
 * no separators, no symbols) for seeding input fields. NEVER feed an input
 * from `formatUsdMicro`: it emits locale separators, and a de-DE "1.250,00"
 * round-trips into a 1000×-corrupted figure.
 */
export function usdMicroToPlainString(micro: bigint): string {
	if (micro < 0n) throw new Error("negative usd value")
	const whole = micro / USD_MICRO_PER_USD
	const frac = (micro % USD_MICRO_PER_USD).toString().padStart(6, "0").replace(/0+$/, "")
	return frac ? `${whole}.${frac}` : `${whole}`
}

/** Half-up integer division for non-negative operands. */
function divHalfUp(num: bigint, div: bigint): bigint {
	return (num + div / 2n) / div
}

/**
 * Value of `raw` base units (non-negative) in micro-USD, half-up.
 * Summable across tokens for the account aggregate.
 */
export function tokenAmountToUsdMicro(raw: bigint, decimals: number, usd: number): bigint {
	if (raw < 0n) throw new Error("negative amount")
	if (raw === 0n) return 0n
	const rate = rateToMicroUsd(usd)
	return divHalfUp(raw * rate, 10n ** BigInt(decimals))
}

/**
 * Render micro-USD for display: `$1,249.38` (half-up to cents),
 * `<$0.01` when positive but under a cent, `$0.00` for zero.
 * Locale separators follow the rest of the app via `formatBaseUnits`.
 */
export function formatUsdMicro(micro: bigint): string {
	if (micro < 0n) throw new Error("negative usd value")
	if (micro === 0n) return "$0.00"
	if (micro < 10_000n) return "<$0.01"
	const cents = divHalfUp(micro, 10_000n)
	return `$${formatBaseUnits(cents, 2, { minDecimals: 2, trimTrailingZeros: false })}`
}

/**
 * Parse a user-typed USD amount ("125", "125.5", "0.004999") into micro-USD.
 * Digits beyond micro precision are TRUNCATED (round-down — never credit the
 * user with more dollars than they typed). Returns null on anything that
 * isn't a plain non-negative decimal number.
 */
export function parseUsdToMicro(input: string): bigint | null {
	const match = /^(\d+)(?:\.(\d*))?$/.exec(input.trim())
	if (!match) return null
	const whole = BigInt(match[1])
	const fracDigits = (match[2] ?? "").slice(0, 6).padEnd(6, "0")
	return whole * USD_MICRO_PER_USD + BigInt(fracDigits)
}

/**
 * Convert micro-USD into token base units at `usd` per whole token,
 * rounding DOWN to the token's precision.
 */
export function usdMicroToTokenAmount(micro: bigint, decimals: number, usd: number): bigint {
	if (micro < 0n) throw new Error("negative usd value")
	const rate = rateToMicroUsdCeil(usd)
	return (micro * 10n ** BigInt(decimals)) / rate
}

/**
 * End-to-end C3 conversion: typed USD string → token base units, round-down
 * at every step. Returns null when the input isn't parseable.
 */
export function usdToTokenAmount(usdInput: string, decimals: number, usd: number): bigint | null {
	const micro = parseUsdToMicro(usdInput)
	if (micro === null) return null
	return usdMicroToTokenAmount(micro, decimals, usd)
}
