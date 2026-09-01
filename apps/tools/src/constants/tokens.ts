/*
 * Canonical drip token catalog. Plan-v2 §3 - pinned fixed amounts.
 *
 * `onchainAmount` is what the Dripper's `amount: u64` param receives.
 * Both values fit comfortably under u64 (max ≈ 1.844e19); Dripper casts
 * to u128 internally.
 */

export type TokenSymbol = "NULO" | "OLUN"

export interface DripToken {
	readonly symbol: TokenSymbol
	readonly decimals: number
	readonly displayAmount: string
	readonly onchainAmount: bigint
}

export const DRIP_TOKENS: readonly DripToken[] = [
	{ symbol: "NULO", decimals: 6, displayAmount: "1,000", onchainAmount: 1_000_000_000n },
	{ symbol: "OLUN", decimals: 18, displayAmount: "1", onchainAmount: 1_000_000_000_000_000_000n },
] as const

export function findDripToken(symbol: TokenSymbol): DripToken {
	const t = DRIP_TOKENS.find((t) => t.symbol === symbol)
	if (!t) throw new Error(`DRIP_TOKENS missing entry for ${symbol}`)
	return t
}
