/*
 * Canonical faucet token catalog. Plan-v2 §3 — pinned fixed amounts.
 *
 * `onchainAmount` is what the Dripper's `amount: u64` param receives.
 * Both values fit comfortably under u64 (max ≈ 1.844e19); Dripper casts
 * to u128 internally.
 */

export type TokenSymbol = "USDC" | "ETH"

export interface FaucetToken {
	readonly symbol: TokenSymbol
	readonly decimals: number
	readonly displayAmount: string
	readonly onchainAmount: bigint
}

export const FAUCET_TOKENS: readonly FaucetToken[] = [
	{ symbol: "USDC", decimals: 6, displayAmount: "1,000", onchainAmount: 1_000_000_000n },
	{ symbol: "ETH", decimals: 18, displayAmount: "1", onchainAmount: 1_000_000_000_000_000_000n },
] as const

export function findFaucetToken(symbol: TokenSymbol): FaucetToken {
	const t = FAUCET_TOKENS.find((t) => t.symbol === symbol)
	if (!t) throw new Error(`FAUCET_TOKENS missing entry for ${symbol}`)
	return t
}
