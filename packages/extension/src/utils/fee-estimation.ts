import { formatBaseUnits } from "@/utils/amount"

/** FeeJuice has 18 decimals */
const FEE_JUICE_DECIMALS = 18

/** Default FeeJuice pricing — hardcoded for privacy (no external API) */
export const FEE_JUICE_USD_RATE = 0.02

export type AssetPricing = {
	address: string
	usdRate: number
	symbol: string
	decimals: number
}

export const FEE_JUICE_PRICING: AssetPricing = {
	address: "0x0000000000000000000000000000000000000000000000000000000000000005",
	usdRate: FEE_JUICE_USD_RATE,
	symbol: "FJ",
	decimals: FEE_JUICE_DECIMALS,
}

/** Compute max fee from gas limits and fees per gas */
export function computeMaxFee(
	gasLimits: { daGas: number; l2Gas: number },
	teardownLimits: { daGas: number; l2Gas: number },
	maxFeesPerGas: { feePerDaGas: bigint; feePerL2Gas: bigint },
): bigint {
	const totalDaGas = BigInt(gasLimits.daGas + teardownLimits.daGas)
	const totalL2Gas = BigInt(gasLimits.l2Gas + teardownLimits.l2Gas)
	return totalDaGas * maxFeesPerGas.feePerDaGas + totalL2Gas * maxFeesPerGas.feePerL2Gas
}

/**
 * Half-up round a base-units value to `targetDecimals` precision, returning
 * a bigint at the target scale. Pure bigint — no float, no BN.
 *
 * Example: halfUpRound(3454999999999999n, 18, 6) → 3455n
 *          (= 0.003455 in 6-decimal scale; was 0.003455 with rounding from 18-decimal raw)
 */
function halfUpRound(value: bigint, fromDecimals: number, toDecimals: number): bigint {
	const shift = fromDecimals - toDecimals
	if (shift <= 0) return value
	const divisor = 10n ** BigInt(shift)
	// Half-up only valid for non-negative; fees are always non-negative.
	return (value + divisor / 2n) / divisor
}

/**
 * Format a raw fee amount (18 decimals) for display. Half-up rounded to
 * `maxDecimals` digits, with trailing zeros trimmed. Costs (paid fee /
 * estimated fee) prefer half-up over truncate so the displayed value
 * doesn't systematically understate the actual paid amount.
 */
export function formatFeeJuice(amount: bigint, maxDecimals: number = 6): string {
	if (amount === 0n) return "0"
	if (maxDecimals < 0) maxDecimals = 0
	if (maxDecimals >= FEE_JUICE_DECIMALS) {
		return formatBaseUnits(amount, FEE_JUICE_DECIMALS)
	}
	const rounded = halfUpRound(amount, FEE_JUICE_DECIMALS, maxDecimals)
	if (rounded === 0n) return "0"
	return formatBaseUnits(rounded, maxDecimals)
}

/** USD rate scaled to 6 decimal precision so we can stay in bigint domain. */
const RATE_SCALE = 1_000_000n

/**
 * Compute USD value from a raw fee amount. Pure bigint via a scaled rate
 * (avoids `Number` precision loss when fees are 18-decimal). Half-up
 * rounded to 3 decimals (`$X.XXX` shape), with the `<$0.001` hint when
 * the unrounded USD value is below $0.001.
 */
export function feeToUsd(feeAmount: bigint, pricing: AssetPricing = FEE_JUICE_PRICING): string {
	if (feeAmount === 0n) return "$0.000"
	const scaledRate = BigInt(Math.round(pricing.usdRate * Number(RATE_SCALE)))
	const tokenScale = 10n ** BigInt(pricing.decimals)
	// USD * (RATE_SCALE * tokenScale) = feeAmount * scaledRate
	// USD * 1000 (milli) = feeAmount * scaledRate / (RATE_SCALE * tokenScale / 1000)
	//                    = feeAmount * scaledRate / (1000 * tokenScale)   [since RATE_SCALE = 1e6]
	const milliDivisor = 1_000n * tokenScale
	const num = feeAmount * scaledRate
	// Hint: unrounded USD < 0.001 ⟺ num < milliDivisor
	if (num < milliDivisor) return "<$0.001"
	const usdMilli = (num + milliDivisor / 2n) / milliDivisor
	return `$${formatBaseUnits(usdMilli, 3, { minDecimals: 3, trimTrailingZeros: false })}`
}

/** Format a gas amount with thousands separators */
export function formatGas(gas: number): string {
	return gas.toLocaleString("en-US")
}

export type FeeEstimate = {
	gasUsed: { daGas: number; l2Gas: number }
	maxFee: bigint
	maxFeeFormatted: string
	maxFeeUsd: string
}

/** Build a FeeEstimate from raw gas data */
export function buildFeeEstimate(daGas: number, l2Gas: number, feePerDaGas: bigint, feePerL2Gas: bigint): FeeEstimate {
	const maxFee = BigInt(daGas) * feePerDaGas + BigInt(l2Gas) * feePerL2Gas
	return {
		gasUsed: { daGas, l2Gas },
		maxFee,
		maxFeeFormatted: formatFeeJuice(maxFee),
		maxFeeUsd: feeToUsd(maxFee),
	}
}
