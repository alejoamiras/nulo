/**
 * Formatting helpers. Tiny and stable — no Aztec deps.
 */

/**
 * Format a fixed-decimal bigint amount into a human-readable string.
 *
 *   formatBigInt(1_000_000_000n, 6) === "1,000.00"
 *   formatBigInt(1_000_000_000_000_000_000n, 18) === "1.00"
 *   formatBigInt(0n, 18) === "0.00"
 *
 * `displayPlaces` clamps the fractional digits shown (default 2).
 * Trailing zeros within `displayPlaces` are kept — predictable column
 * alignment matters more than terse output for a faucet.
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

export function trimAddress(addr: string, head = 6, tail = 4): string {
	if (!addr) return "—"
	if (addr.length <= head + tail + 2) return addr
	return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}

export function trimTxHash(hash: string, head = 8, tail = 4): string {
	return trimAddress(hash, head, tail)
}
