/**
 * Boundary defense for the SW-side `executeTransfer` / `estimateTransferFee`
 * `amount` parameter.
 *
 * Why this exists: the TS signature `amount: bigint` is a runtime LIE.
 * `extension-messaging/src/background/client.ts:144` calls `jsonSanitize`
 * (`wallet-core/src/utils/serialization.ts`) which round-trips through
 * `JSON.parse(JSON.stringify(value, replacer))`, where the replacer turns
 * bigints into strings. So the SW receives `amount` as a STRING (or a
 * NUMBER if the caller passed a number, etc.), not a bigint.
 *
 * The pre-existing `amount = BigInt(amount)` works for clean integer
 * strings ("123") but throws on fractional strings ("123.5"), with a
 * cryptic native error message. This helper:
 *   - accepts the documented shapes (bigint, integer string, integer
 *     number, non-negative);
 *   - throws a clear, actionable error for anything else.
 *
 * Throwing (vs floor-on-overflow) is intentional: a wallet that silently
 * sends fewer tokens than the caller asked for is a worse footgun than
 * a loud error.
 */
export function coerceAmount(value: unknown): bigint {
	if (typeof value === "bigint") {
		if (value < 0n) throw new Error("Invalid amount: must be non-negative")
		return value
	}
	if (typeof value === "string") {
		// Allow only digit-strings. Reject fractional ("123.5"), scientific ("1e5"),
		// signed ("-123"), hex ("0x1"), empty.
		if (!/^\d+$/.test(value)) {
			throw new Error("Invalid amount: must be a non-negative integer (got non-integer string)")
		}
		return BigInt(value)
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
			throw new Error("Invalid amount: must be a non-negative integer (got fractional/garbage number)")
		}
		return BigInt(value)
	}
	throw new Error(`Invalid amount: unrecognized type (got ${typeof value})`)
}
