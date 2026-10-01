/** The Send page's one amount gate: the field's text, read whole, as base units the token can hold
 *  and the balance covers, or the reason it cannot send. */

import { parseAmountToBaseUnits, readAmountText } from "@/utils/amount"
import { errorMessageFromUnknown } from "@nulo/wallet-core/utils"

export type ValidateSendAmountReason = "empty" | "invalid" | "tooManyDecimals" | "belowMinimum" | "exceedsBalance" | "decimalsUnknown"

export type ValidateSendAmount = { valid: true; integerized: bigint } | { valid: false; reason: ValidateSendAmountReason }

export interface ValidateSendAmountInput {
	/** Raw user-typed string (e.g. "1.5", "14.0234375"). */
	input: string | undefined | null
	/** The text the field last wrote at rest, whose commas are its own grouping; null otherwise. */
	rested?: string | null
	/** Token's `decimals` field. `undefined` means token list still loading. */
	tokenDecimals: number | undefined
	/** Account's available balance in base units (raw bigint or string). `undefined`
	 *  means balance not loaded yet — caller should not enable submission. */
	balanceRaw: bigint | string | undefined | null
}

const MIN_BASE_UNITS = 1n

/** Result-shaped wrapper over `parseAmountToBaseUnits`: its throw is the only signal, and
 *  the too-many-decimals case gets its own user-facing reason. */
function parseToBaseUnits(
	plain: string,
	tokenDecimals: number,
): { ok: true; value: bigint } | { ok: false; reason: "tooManyDecimals" | "invalid" } {
	try {
		return { ok: true, value: parseAmountToBaseUnits(plain, tokenDecimals) }
	} catch (err) {
		const msg = errorMessageFromUnknown(err)
		return { ok: false, reason: msg.includes("too many decimals") ? "tooManyDecimals" : "invalid" }
	}
}

export function validateSendAmount(opts: ValidateSendAmountInput): ValidateSendAmount {
	const { input, rested = null, tokenDecimals, balanceRaw } = opts

	if (typeof input !== "string" || input.trim() === "" || input.trim() === ".") {
		return { valid: false, reason: "empty" }
	}

	if (tokenDecimals === undefined || tokenDecimals === null) {
		return { valid: false, reason: "decimalsUnknown" }
	}

	const read = readAmountText(input, { rested })
	if (!read.ok) {
		return { valid: false, reason: "invalid" }
	}

	const parsed = parseToBaseUnits(read.plain, tokenDecimals)
	if (!parsed.ok) {
		return { valid: false, reason: parsed.reason }
	}
	const integerized = parsed.value

	if (integerized < MIN_BASE_UNITS) {
		return { valid: false, reason: "belowMinimum" }
	}

	if (balanceRaw === undefined || balanceRaw === null) {
		// No balance loaded — treat as unknown rather than 0; caller should
		// also gate UI on its own loading state.
		return { valid: false, reason: "exceedsBalance" }
	}

	const balanceBigint = typeof balanceRaw === "bigint" ? balanceRaw : safeBigInt(balanceRaw)
	if (balanceBigint === undefined || integerized > balanceBigint) {
		return { valid: false, reason: "exceedsBalance" }
	}

	return { valid: true, integerized }
}

function safeBigInt(value: string): bigint | undefined {
	if (!/^\d+$/.test(value)) return undefined
	return BigInt(value)
}
