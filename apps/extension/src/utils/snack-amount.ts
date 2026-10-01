import { balanceFormatted, getDecimalSeparator } from "./amount"

/**
 * The amount a snack or chip prints: the activity row's 8-character form while it spells every
 * whole-number digit (its `<0.000001` hint keeps the one it has), otherwise the full amount, never
 * the row's K/M/B/T form.
 */
export function formatSnackAmount(amount: bigint, decimals: number): string {
	const full = balanceFormatted(amount, decimals).value
	const short = balanceFormatted(amount, decimals, 8, { compact: true }).value
	const whole = full.split(getDecimalSeparator())[0] ?? full
	return short.replace(/^</, "").startsWith(whole) ? short : full
}
