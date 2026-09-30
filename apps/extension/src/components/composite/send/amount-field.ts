import { formatBaseUnits, parseAmountToBaseUnits } from "@/utils/amount"

/** The amount field's resting form: a plain decimal the token can hold comes back grouped with
 *  every digit kept; anything else, a comma included, comes back as typed, so the validator reads
 *  the same amount it would have, and a second call changes nothing. */
export function restingAmount(value: string, decimals: number): string {
	try {
		return formatBaseUnits(parseAmountToBaseUnits(value.trim(), decimals), decimals, { thousandsSep: ",", decimalSep: "." })
	} catch {
		return value
	}
}
