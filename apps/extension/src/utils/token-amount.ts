/**
 * The one place a token row's numbers are parsed. Balance strings and `decimals` come from
 * storage rows that contracts fed; a malformed value must never reach `BigInt` or an exponent
 * unchecked, and must never throw out of a render. Everything downstream (ordering, folding,
 * aggregation, the row itself) reads through these helpers.
 */

/** Largest `decimals` that keeps `10n ** BigInt(decimals)` cheap; anything above is rejected. */
export const MAX_DECIMALS = 77

type BalanceLike = { publicBalance?: string; privateBalance?: string }
type TokenLike = { token?: { decimals?: unknown } }

export function isValidDecimals(d: unknown): d is number {
	return typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= MAX_DECIMALS
}

/** Absent → 0n (a side the row never had); a non-negative integer literal → its bigint; anything else → undefined. */
function parseSide(s: string | undefined): bigint | undefined {
	if (s === undefined || s === null) return 0n
	if (typeof s !== "string" || !/^\d{1,80}$/.test(s)) return undefined
	return BigInt(s)
}

/** Public + private raw units, or undefined when either side is malformed. */
export function parseRawBalance(tb: BalanceLike): bigint | undefined {
	const pub = parseSide(tb.publicBalance)
	const priv = parseSide(tb.privateBalance)
	if (pub === undefined || priv === undefined) return undefined
	return pub + priv
}

export type FiatOf<T extends BalanceLike & TokenLike = BalanceLike & TokenLike> = (tb: T) => bigint | undefined

/**
 * Wraps a fiat lookup so it is only ever called on a well-formed row: a malformed balance or an
 * invalid `decimals` yields `undefined` (unpriced) without the lookup running, and a throwing
 * lookup is swallowed the same way.
 */
export function safeFiatOf<T extends BalanceLike & TokenLike>(fiatOf: FiatOf<T>): FiatOf<T> {
	return (tb) => {
		if (parseRawBalance(tb) === undefined || !isValidDecimals(tb.token?.decimals)) return undefined
		try {
			return fiatOf(tb)
		} catch {
			return undefined
		}
	}
}
