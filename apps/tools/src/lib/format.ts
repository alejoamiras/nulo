/**
 * Formatting helpers. Tiny and stable - no Aztec deps.
 */

/**
 * Format a fixed-decimal bigint amount into a human-readable string.
 *
 *   formatBigInt(1_000_000_000n, 6) === "1,000.00"
 *   formatBigInt(1_000_000_000_000_000_000n, 18) === "1.00"
 *   formatBigInt(0n, 18) === "0.00"
 *
 * `displayPlaces` clamps the fractional digits shown (default 2).
 * Trailing zeros within `displayPlaces` are kept - predictable column
 * alignment matters more than terse output for a tools app.
 */
export function formatBigInt(value: bigint, decimals: number, displayPlaces = 2): string {
	const divisor = 10n ** BigInt(decimals)
	const whole = value / divisor
	const fraction = value % divisor
	const fractionStr = fraction.toString().padStart(decimals, "0")
	const fractionTruncated = decimals === 0 ? "" : fractionStr.slice(0, displayPlaces)
	const wholeFormatted = whole.toLocaleString("en-US")
	if (!fractionTruncated) return wholeFormatted
	return `${wholeFormatted}.${fractionTruncated}`
}

/**
 * Parse a human-entered decimal string into fixed-decimal base units.
 *
 *   parseAmount("1.5", 18) === 1_500_000_000_000_000_000n
 *   parseAmount("100", 6) === 100_000_000n
 *
 * BigInt end to end - `Number()` loses integer precision past 2^53, which
 * 18-decimal base units exceed at ~9.01 tokens. Excess fractional digits
 * truncate (never round up someone's spend); junk returns 0n.
 */
export function parseAmount(text: string | number, decimals: number): bigint {
	const trimmed = String(text ?? "").trim()
	if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === ".") return 0n
	const [whole = "0", fraction = ""] = trimmed.split(".")
	const fractionPadded = fraction.slice(0, decimals).padEnd(decimals, "0")
	return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fractionPadded || "0")
}

/**
 * Strict counterpart of `parseAmount`: `null` for anything that is not a plain decimal number the
 * token can represent exactly.
 *
 *   parseAmountStrict("1.5", 18) === 1_500_000_000_000_000_000n
 *   parseAmountStrict("1.234", 2) === null   // more places than the token has
 *   parseAmountStrict("abc", 6) === null
 *
 * `parseAmount` answers `0n` to junk and silently truncates excess places — safe for a display
 * helper, wrong for a field that must tell "typed nothing usable" apart from "typed zero".
 */
export function parseAmountStrict(text: string, decimals: number): bigint | null {
	if (decimals < 0) return null
	const trimmed = String(text ?? "").trim()
	if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
	const [whole = "0", fraction = ""] = trimmed.split(".")
	if (fraction.length > decimals) return null
	return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0")
}

/**
 * Full-precision, ungrouped text for an amount FIELD - `formatBigInt` groups thousands and clamps the
 * fraction, so its output cannot be typed back into an input without changing the number.
 */
export function toDecimalString(value: bigint, decimals: number): string {
	if (decimals <= 0) return value.toString()
	const divisor = 10n ** BigInt(decimals)
	const fraction = (value % divisor).toString().padStart(decimals, "0").replace(/0+$/, "")
	const whole = (value / divisor).toString()
	return fraction === "" ? whole : `${whole}.${fraction}`
}

export function trimAddress(addr: string, head = 6, tail = 4): string {
	if (!addr) return "-"
	if (addr.length <= head + tail + 2) return addr
	return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}

export function trimTxHash(hash: string, head = 8, tail = 4): string {
	return trimAddress(hash, head, tail)
}
