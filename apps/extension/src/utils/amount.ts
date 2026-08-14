export const getDecimalSeparator = (): string => {
	const s = (1.1).toLocaleString()
	return s.substring(1, s.length - 1)
}

export const getThousandSeparator = (): string => {
	const s = (1111).toLocaleString()
	return s.substring(1, s.length - 3)
}

export const comma = (target: unknown, symbol = ",", fixed = 2): string | number => {
	if (!target) return 0

	let num: string | number = Number.parseFloat(target as string)

	if ((num as number) % 1 === 0) {
		num = (num as number).toFixed(0)
	} else {
		num = (num as number).toFixed(fixed)
	}

	if (num.includes(".")) {
		while (num[num.length - 1] === "0") {
			num = num.slice(0, num.length - 1)
		}
		if (num[num.length - 1] === ".") {
			num = num.slice(0, num.length - 1)
		}
	}

	if (num.split(".").length > 1 && fixed !== 2) {
		return `${num
			.split(".")[0]
			.toString()
			.replace(/\B(?=(\d{3})+(?!\d))/g, symbol)}.${num.split(".")[1]}`
	}

	return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, symbol)
}

export const purgeNumber = (target: string): string => {
	if (/^(0|[1-9]\d*)(\.\d+)?$/.test(target)) return target
	return target.replace(/[^0-9.]/g, "")
}

export const normalizeAmount = (target: string): string | undefined => {
	if (target === ".") return "0."

	let dotCounter = 0
	for (const char of target) {
		if (char === ".") dotCounter++
	}

	if (dotCounter > 1) return target.slice(0, target.length - 1)

	if (target[target.length - 1] === ".") return target
	if (!target.length) return ""
	if (target.length === 1 && !/^(0|[1-9]\d*)(\.\d+)?$/.test(target)) return ""
	if (Number.parseFloat(purgeNumber(target)) >= 9_999_999_999_999) return "9999999999999"
}

/**
 * Format a base-units value for display, with optional total-string-length
 * truncation + small-value hint. Returns `{ value, slashed }` so callers
 * can render an "expand" affordance when truncation fired (BalanceView).
 *
 * `length` is the OUTPUT-string length cap, not a decimal-places count:
 * - String shorter than `length`  → returned as-is, slashed=false.
 * - Value > 0 but smaller than `10^-(length-2)` after scaling → renders
 *   `<0.0001` (length-3 zeros + `1`), slashed=true. UX hint that the
 *   actual amount is non-zero but too small to show at this width.
 * - String exceeds `length`       → sliced to `length` chars, slashed=true.
 *   No "..." suffix — callers that need an affordance use the `slashed`
 *   flag to render their own (e.g. a "Show full" button).
 *
 * Uses `formatBaseUnits` (TRUNCATE-only rounding) under the hood — display
 * always shows ≤ actual.
 */
export const balanceFormatted = (
	units: bigint | string | null | undefined,
	decimals: number,
	length?: number,
): { value: string; slashed: boolean } => {
	if (units == null || units === "") return { value: "0", slashed: false }
	const u = typeof units === "bigint" ? units : BigInt(units)
	if (u === 0n) return { value: "0", slashed: false }

	const decimalSep = getDecimalSeparator()
	const fullValue = formatBaseUnits(u, decimals)

	if (!length) {
		return { value: fullValue, slashed: false }
	}

	// Small-value hint: value > 0 but smaller than the smallest representable
	// at this output width. Threshold: 10^(decimals - (length - 2)) base units.
	// If `length-2 >= decimals`, the threshold collapses to 0 and the hint
	// branch is unreachable (which is correct — at that width the full value
	// fits trivially).
	const hintDigits = length - 2
	if (hintDigits > 0 && hintDigits < decimals) {
		const threshold = 10n ** BigInt(decimals - hintDigits)
		if (u < threshold) {
			return {
				value: `<0${decimalSep}${"0".repeat(length - 3)}1`,
				slashed: true,
			}
		}
	}

	if (fullValue.length > length) {
		return { value: fullValue.slice(0, length), slashed: true }
	}

	return { value: fullValue, slashed: false }
}

/**
 * Truncate a typed-input string to at most `maxDecimals` digits after the
 * decimal point. Pure string operation — no BN, no float, no rounding.
 *
 * - `clampDecimals("1.234567", 4)` → `"1.2345"`
 * - `clampDecimals("1.5", 4)` → `"1.5"` (under the limit, untouched)
 * - `clampDecimals("1.", 4)` → `"1."` (trailing dot preserved while typing)
 * - `clampDecimals("123", 4)` → `"123"` (no dot, untouched)
 * - `clampDecimals("1.234", 0)` → `"1"` (zero-decimal token strips the dot)
 *
 * Returns the input unchanged when `maxDecimals < 0` (defensive).
 */
export const clampDecimals = (value: string, maxDecimals: number): string => {
	if (maxDecimals < 0) return value
	const dotIdx = value.indexOf(".")
	if (dotIdx === -1) return value
	if (maxDecimals === 0) return value.slice(0, dotIdx)
	const allowed = dotIdx + 1 + maxDecimals
	return value.length <= allowed ? value : value.slice(0, allowed)
}

/**
 * Parse a decimal-string user input to base-units `bigint` for a token of
 * `decimals`. Pure native bigint via string padding — no BigNumber, no
 * float math, no precision-loss footgun (`10 ** decimals` is JS-number
 * math and starts losing precision around `decimals > 15`).
 *
 * Throws on:
 *   - Empty string or lone "."
 *   - Non-numeric characters
 *   - More fractional digits than the token supports (caller should
 *     `clampDecimals` first if it wants silent truncation)
 *
 * Examples:
 *   parseAmountToBaseUnits("1.5", 6)    → 1500000n
 *   parseAmountToBaseUnits("0.0001", 18) → 100000000000000n
 *   parseAmountToBaseUnits("1.5", 0)    → throws  (token has 0 decimals; `1.5` invalid)
 *   parseAmountToBaseUnits("1", 0)      → 1n
 *   parseAmountToBaseUnits("1.234", 2)  → throws  (3 frac digits > 2)
 */
export const parseAmountToBaseUnits = (value: string, decimals: number): bigint => {
	if (decimals < 0 || !Number.isInteger(decimals)) {
		throw new Error("Invalid decimals: must be a non-negative integer")
	}
	if (typeof value !== "string" || value === "" || value === ".") {
		throw new Error("Invalid amount: empty")
	}
	// Match digits + at most one dot. Tolerates "1.", ".5", "1", "1.5".
	// Rejects garbage like "1.2.3", "abc", "-1", "1e5".
	if (!/^\d*\.?\d*$/.test(value)) {
		throw new Error("Invalid amount: non-numeric characters")
	}
	const [intPart = "", fracPart = ""] = value.split(".")
	if (fracPart.length > decimals) {
		throw new Error("Invalid amount: too many decimals for token")
	}
	const padded = fracPart.padEnd(decimals, "0")
	const composed = (intPart || "0") + padded
	// Strip leading zeros (BigInt accepts them; keeps the contract clean).
	const stripped = composed.replace(/^0+(?=\d)/, "")
	return BigInt(stripped)
}

/**
 * Validate a typed-input string is a positive numeric amount (regardless of
 * token decimals — for that, use `parseAmountToBaseUnits`).
 *
 * Returns `true` for anything that `parseAmountToBaseUnits(value, 18)` would
 * parse successfully into a non-zero bigint.
 */
export const isValidAmount = (value: unknown): boolean => {
	if (typeof value !== "string") return false
	try {
		const units = parseAmountToBaseUnits(value, 18)
		return units > 0n
	} catch {
		return false
	}
}

export interface FormatBaseUnitsOpts {
	/** Truncate (round down) to N digits after the decimal point. Default:
	 *  full precision. **TRUNCATES** — never rounds up — so a balance display
	 *  always shows ≤ the actual amount. Important: rounding-up would invite
	 *  a UX where the user sees "1.50" while only holding 1.4999, then types
	 *  "1.5" expecting it to send and gets a misleading "exceeds balance"
	 *  error. */
	maxDecimals?: number
	/** Pad to at least N digits after the decimal (with trailing zeros).
	 *  Default: 0. Use for fixed-width displays (e.g. always 4 decimals). */
	minDecimals?: number
	/** Strip trailing zeros past `minDecimals`. Default: true when
	 *  `minDecimals` is 0/undefined; false otherwise. */
	trimTrailingZeros?: boolean
	/** Decimal separator. Default: locale (`getDecimalSeparator()`). */
	decimalSep?: string
	/** Thousands separator on the integer part. Default: locale
	 *  (`getThousandSeparator()`). */
	thousandsSep?: string
}

/**
 * Format a base-units integer value as a decimal-string for display.
 * Pure native bigint; no `bignumber.js` dependency.
 *
 * **Rounding contract**: `maxDecimals` always TRUNCATES (round-down). Never
 * rounds up. For amounts this matters: showing a rounded-up value can
 * mislead the user into thinking they hold more than they actually do.
 * Cost-only displays (e.g. fee-to-USD) that prefer half-up should compute
 * their own rounding before calling here.
 *
 * Example:
 *   formatBaseUnits(15000000n, 6)                       → "15"
 *   formatBaseUnits(15500000n, 6)                       → "15.5"
 *   formatBaseUnits(14999999n, 6, { maxDecimals: 4 })   → "14.9999"  (truncated, NOT 15.0000)
 *   formatBaseUnits(1500n, 6, { maxDecimals: 4 })       → "0.0015"
 *   formatBaseUnits(1500000000n, 6, { thousandsSep: "," }) → "1,500"
 *   formatBaseUnits(150n, 6, { minDecimals: 4 })        → "0.0001"  (truncated; trailing zero kept by minDecimals)
 */
export const formatBaseUnits = (units: bigint | string | null | undefined, decimals: number, opts: FormatBaseUnitsOpts = {}): string => {
	if (decimals < 0 || !Number.isInteger(decimals)) {
		throw new Error("Invalid decimals: must be a non-negative integer")
	}
	if (units == null || units === "") return "0"
	const u = typeof units === "bigint" ? units : BigInt(units)

	const sign = u < 0n ? "-" : ""
	const abs = sign === "-" ? -u : u

	const factor = decimals === 0 ? 1n : 10n ** BigInt(decimals)
	const wholePart = abs / factor
	let fracStr = decimals === 0 ? "" : (abs % factor).toString().padStart(decimals, "0")

	// `maxDecimals`: truncate (round down) the fractional part.
	if (opts.maxDecimals !== undefined && opts.maxDecimals < fracStr.length) {
		fracStr = fracStr.slice(0, opts.maxDecimals)
	}

	const minDecimals = opts.minDecimals ?? 0
	if (fracStr.length < minDecimals) {
		fracStr = fracStr.padEnd(minDecimals, "0")
	}

	const trimDefault = minDecimals === 0
	const trim = opts.trimTrailingZeros ?? trimDefault
	if (trim) {
		while (fracStr.length > minDecimals && fracStr.endsWith("0")) {
			fracStr = fracStr.slice(0, -1)
		}
	}

	const thousandsSep = opts.thousandsSep ?? getThousandSeparator()
	let wholeStr = wholePart.toString()
	if (thousandsSep) {
		wholeStr = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep)
	}

	const decimalSep = opts.decimalSep ?? getDecimalSeparator()
	return sign + wholeStr + (fracStr ? decimalSep + fracStr : "")
}
