/**
 * Fiat aggregate over held tokens: Σ balance × price in micro-USD. A zero-balance row is worth
 * exactly $0.00 whether priced or not, so it is neither a holding nor a pricing gap; a malformed
 * row IS a holding with no price, so the total reads as partial rather than complete.
 */
import { type FiatOf, isValidDecimals, parseRawBalance } from "@/utils/token-amount"

export type Aggregate = { micro: bigint; priced: number; holdings: number; partial: boolean }

export function aggregateFiat<T extends { publicBalance?: string; privateBalance?: string; token?: { decimals?: unknown } }>(
	rows: readonly T[],
	fiatOf: FiatOf<T>,
): Aggregate {
	let micro = 0n
	let priced = 0
	let holdings = 0
	for (const tb of rows) {
		const raw = parseRawBalance(tb)
		// Invalid decimals make the row unreadable even when its raw balance parses to zero.
		const malformed = raw === undefined || !isValidDecimals(tb.token?.decimals)
		if (raw === 0n && !malformed) continue
		holdings += 1
		if (malformed) continue
		const value = fiatOf(tb)
		if (value === undefined) continue
		micro += value
		priced += 1
	}
	return { micro, priced, holdings, partial: priced < holdings }
}
