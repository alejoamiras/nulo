/**
 * Pure validation helper for the Send page's amount input. Owns the
 * "user-typed string + token decimals + raw balance → bigint or reason"
 * invariant so `send.vue` doesn't need to inline `BN.times(10 ** d)` at
 * multiple sites (the source of the QA-surfaced decimal-overflow bug).
 *
 * Returns a discriminated `ValidateSendAmount` result: callers either
 * get a usable `integerized: bigint` or a typed `reason` for the failure
 * (mappable to UI copy if we want inline error text later).
 */

import { parseAmountToBaseUnits } from "@/utils/amount"

export type ValidateSendAmountReason = "empty" | "invalid" | "tooManyDecimals" | "belowMinimum" | "exceedsBalance" | "decimalsUnknown"

export type ValidateSendAmount = { valid: true; integerized: bigint } | { valid: false; reason: ValidateSendAmountReason }

export interface ValidateSendAmountInput {
	/** Raw user-typed string (e.g. "1.5", "14.0234375"). */
	input: string | undefined | null
	/** Token's `decimals` field. `undefined` means token list still loading. */
	tokenDecimals: number | undefined
	/** Account's available balance in base units (raw bigint or string). `undefined`
	 *  means balance not loaded yet — caller should not enable submission. */
	balanceRaw: bigint | string | undefined | null
}

const MIN_BASE_UNITS = 1n

export function validateSendAmount(opts: ValidateSendAmountInput): ValidateSendAmount {
	const { input, tokenDecimals, balanceRaw } = opts

	if (typeof input !== "string" || input.trim() === "") {
		return { valid: false, reason: "empty" }
	}
	const trimmed = input.trim().replace(",", "")
	if (trimmed === "" || trimmed === ".") {
		return { valid: false, reason: "empty" }
	}

	if (tokenDecimals === undefined || tokenDecimals === null) {
		return { valid: false, reason: "decimalsUnknown" }
	}

	let integerized: bigint
	try {
		integerized = parseAmountToBaseUnits(trimmed, tokenDecimals)
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		if (msg.includes("too many decimals")) {
			return { valid: false, reason: "tooManyDecimals" }
		}
		return { valid: false, reason: "invalid" }
	}

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
