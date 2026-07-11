import type { TokenInfo } from "@/wallet/services/token/spec"

import { z } from "zod"

export const TOKEN_BALANCE_SERVICE_NAME = "token-balance"

/** EntityStorage root for balance rows (keyed by `String(balance.id)`). Frozen:
 *  renaming detaches every existing row; the backup-migration registry pins it. */
export const TOKEN_BALANCE_STORAGE_ROOT = "nulo:core:token-balances"

export type TokenBalanceRaw = {
	id: number
	token: number
	account: string
	publicBalance?: string
	privateBalance?: string
	updatedAt: number
}

/** Storage codec row schema — mirrors `TokenBalanceRaw` exactly. */
export const TokenBalanceRawSchema: z.ZodType<TokenBalanceRaw> = z.object({
	id: z.number(),
	token: z.number(),
	account: z.string(),
	publicBalance: z.string().optional(),
	privateBalance: z.string().optional(),
	updatedAt: z.number(),
})

export type TokenBalanceInfo = {
	id: number
	token: TokenInfo
	account: string
	publicBalance?: string
	privateBalance?: string
	updatedAt: number
}

export type Methods = {
	/**
	 * Returns a token balance with the specified id.
	 * @param id Token balance id.
	 */
	getTokenBalance(id: number): TokenBalanceInfo

	/**
	 * Returns a list of token balances.
	 * @param tokenId Token id.
	 * @param accountAddress Account address.
	 */
	getTokenBalances(tokenId?: number, accountAddress?: string): TokenBalanceInfo[]

	/**
	 * Enqueues the token balance for immediate syncing.
	 * @param id Token balance id.
	 */
	refreshTokenBalance(id: number): void
}

export type Events = {
	onTokenBalanceAdded: TokenBalanceInfo
	onTokenBalanceUpdated: TokenBalanceInfo
	onTokenBalanceDeleted: TokenBalanceInfo
}
