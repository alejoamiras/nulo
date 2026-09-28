import { balanceFormatted, getDecimalSeparator } from "./amount"

/**
 * The amount a snack or chip prints: the activity row's 8-character form while it keeps every
 * whole-number digit (its `<0.000001` hint keeps the one it has), otherwise the full amount. The
 * 8-character form slices the formatted string, so a whole number past it would lose digits, and
 * an amount is never cut.
 */
export function formatSnackAmount(amount: bigint, decimals: number): string {
	const full = balanceFormatted(amount, decimals).value
	const short = balanceFormatted(amount, decimals, 8).value
	const whole = full.split(getDecimalSeparator())[0] ?? full
	return short.replace(/^</, "").startsWith(whole) ? short : full
}
