import type { TokenInfo } from "@/wallet/services/token/spec"

import { z } from "zod"

export const TOKEN_BALANCE_SERVICE_NAME = "token-balance"

/** EntityStorage root for balance rows (keyed by `String(balance.id)`). Frozen:
 *  renaming detaches every existing row; the backup-migration registry pins it. */
export const TOKEN_BALANCE_STORAGE_ROOT = "nulo:core:token-balances"

/** Single owner of the persisted failure-text bound: live queue writes AND the
 *  storage/restore codec truncate with the SAME cap so they can never drift. */
export const MAX_SYNC_FAILURE_MESSAGE_LENGTH = 200
export function boundSyncFailureMessage(message: string): string {
	return message.length <= MAX_SYNC_FAILURE_MESSAGE_LENGTH ? message : `${message.slice(0, MAX_SYNC_FAILURE_MESSAGE_LENGTH - 1)}…`
}

/** Persisted record of the row's LAST FAILED projection. Cleared by the next
 *  successful one. Without it, a failed refresh is indistinguishable from a
 *  still-running one via storage (the only other signal is an in-memory,
 *  60-min-TTL TaskService record that dies with the SW) — a gap that once
 *  starved a write-gated retry. `message` is bounded
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
	/** The paired token's immutable identity triple — stamped service-side at every write, never client-authored. */
	profileId: string
	chainId: number
	contract: string
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
	profileId: z.string(),
	chainId: z.number(),
	contract: z.string(),
	publicBalance: z.string().optional(),
	privateBalance: z.string().optional(),
	updatedAt: z.number(),
	syncFailure: z
		.object({
			at: z.number(),
			// Imported/restored rows are untrusted: bound the persisted text at
			// the schema so a hostile backup can't smuggle megabyte messages
			// (truncate, never reject — rejection would hide the whole row).
			message: z.string().transform(boundSyncFailureMessage),
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
