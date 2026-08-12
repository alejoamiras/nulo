import type { TokenInfo } from "@/wallet/services/token/spec"

import { z } from "zod"

export const TOKEN_BALANCE_SERVICE_NAME = "token-balance"

/** EntityStorage root for balance rows (keyed by `String(balance.id)`). Frozen:
 *  renaming detaches every existing row; the backup-migration registry pins it. */
export const TOKEN_BALANCE_STORAGE_ROOT = "nulo:core:token-balances"

/** Persisted record of the row's LAST FAILED projection. Cleared by the next
 *  successful one. Without it, a failed refresh is indistinguishable from a
 *  still-running one via storage (the only other signal is an in-memory,
 *  60-min-TTL TaskService record that dies with the SW) — the gap that
 *  starved a write-gated retry in the e2e-deflake arc. `message` is bounded
 *  at the write site; balances and `updatedAt` stay untouched on failure so
 *  the last-known value keeps rendering (gas-pipeline SWR precedent). */
export type TokenBalanceSyncFailure = {
	at: number
	message: string
}

export type TokenBalanceRaw = {
	id: number
	token: number
	account: string
	publicBalance?: string
	privateBalance?: string
	updatedAt: number
	syncFailure?: TokenBalanceSyncFailure
}

/** Storage codec row schema — mirrors `TokenBalanceRaw` exactly. */
export const TokenBalanceRawSchema: z.ZodType<TokenBalanceRaw> = z.object({
	id: z.number(),
	token: z.number(),
	account: z.string(),
	publicBalance: z.string().optional(),
	privateBalance: z.string().optional(),
	updatedAt: z.number(),
	syncFailure: z
		.object({
			at: z.number(),
			// Imported/restored rows are untrusted: bound the persisted text at
			// the schema so a hostile backup can't smuggle megabyte messages
			// (truncate, never reject — rejection would hide the whole row).
			message: z.string().transform((m) => (m.length <= 200 ? m : `${m.slice(0, 199)}…`)),
		})
		.optional(),
})

export type TokenBalanceInfo = {
	id: number
	token: TokenInfo
	account: string
	publicBalance?: string
	privateBalance?: string
	updatedAt: number
	syncFailure?: TokenBalanceSyncFailure
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
