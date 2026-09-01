/**
 * The pure half of balance-row reconciliation: given the active profile's
 * tokens, its accounts, and the balance rows that already exist, decide which
 * `(token, account)` pairs are missing and which existing rows were never
 * projected.
 *
 * No storage, no chrome, no service — everything the caller must serialize
 * lives on the other side of this boundary.
 */

import { rowMatchesToken } from "./balance-identity"

/** Narrower than `Token` so this module is exercisable without the storage codec. */
export type ReconcileToken = {
	id: number
	profileId: string
	chainId: number
	contract: string
}

/** `index` participates only as a sort tiebreak before address. */
export type ReconcileAccount = {
	address: string
	chainId: number
	index: number
}

export type ReconcileRow = {
	token: number
	account: string
	profileId: string
	chainId: number
	contract: string
	updatedAt: number
	syncFailure?: unknown
}

/** Generic over the caller's real row types so the plan hands back the exact
 *  objects it was given — the service needs full `Token`/`Account`/`TokenBalanceRaw`
 *  to write, and narrowing here would force a cast at the call site. */
export type ReconcilePlan<T extends ReconcileToken, A extends ReconcileAccount, R extends ReconcileRow> = {
	/** Pairs with no row at all — the worker died before `repo.set`. */
	missing: { token: T; account: A }[]
	/** Rows that exist but were never projected — the worker died after
	 *  `repo.set` and before `enqueue`, stranding the card mid-load. */
	staleTokens: R[]
	/** Rows of THIS profile whose token id resolves to a live token but whose
	 *  chain/contract identity mismatches it — a dead incarnation left behind
	 *  by id reuse. Provably stale; safe to delete. Rows whose token id has no
	 *  live token (possibly just codec-hidden) and foreign-profile rows are
	 *  deliberately NOT here. */
	staleIdentity: R[]
}

/** `${tokenId}:${address}` — the pair key, meaningful against a caller-supplied
 *  active-profile token set; rows must ALSO match the token's full identity to
 *  count as satisfying a pair. */
function pairKey(token: number, account: string): string {
	return `${token}:${account}`
}

/**
 * Both halves of the repair, computed in one pass.
 *
 * Pairs are formed only where `token.chainId === account.chainId` — a mainnet
 * token must never pair with a testnet account.
 *
 * Existing rows are indexed only under keys the desired set actually contains,
 * so a foreign profile's rows are never materialized. A row counts toward a
 * desired pair only on FULL identity (the schema-carried incarnation): a stale
 * row from a dead token incarnation at a reused id no longer suppresses repair
 * — it is reported in `staleIdentity` for deletion instead.
 *
 * Output order is total and deterministic — chainId, token id, account index,
 * then address — so a repair batch allocates ids in a reproducible sequence.
 */
export function reconcilePlan<T extends ReconcileToken, A extends ReconcileAccount, R extends ReconcileRow>(input: {
	tokens: readonly T[]
	accounts: readonly A[]
	existing: readonly R[]
}): ReconcilePlan<T, A, R> {
	const { tokens, accounts, existing } = input
	const { desired, pairs } = buildDesiredPairs(tokens, groupAccountsByChain(accounts))
	const tokenById = new Map<number, T>()
	for (const token of tokens) tokenById.set(token.id, token)
	const { seen, staleTokens, staleIdentity } = classifyExistingRows(existing, tokenById, desired)
	const missing = pairs.filter(({ token, account }) => !seen.has(pairKey(token.id, account.address)))
	missing.sort(comparePairs)
	return { missing, staleTokens, staleIdentity }
}

function groupAccountsByChain<A extends ReconcileAccount>(accounts: readonly A[]): Map<number, A[]> {
	const accountsByChain = new Map<number, A[]>()
	for (const account of accounts) {
		const bucket = accountsByChain.get(account.chainId)
		if (bucket) bucket.push(account)
		else accountsByChain.set(account.chainId, [account])
	}
	return accountsByChain
}

/** Pairs form only where `token.chainId === account.chainId`; the first
 *  (token, account) occurrence wins so duplicates never double-pair. */
function buildDesiredPairs<T extends ReconcileToken, A extends ReconcileAccount>(
	tokens: readonly T[],
	accountsByChain: Map<number, A[]>,
): { desired: Set<string>; pairs: { token: T; account: A }[] } {
	const desired = new Set<string>()
	const pairs: { token: T; account: A }[] = []
	for (const token of tokens) {
		for (const account of accountsByChain.get(token.chainId) ?? []) {
			const key = pairKey(token.id, account.address)
			if (desired.has(key)) continue
			desired.add(key)
			pairs.push({ token, account })
		}
	}
	return { desired, pairs }
}

/** A row counts toward a desired pair only on FULL identity; a same-profile
 *  row at a reused id whose identity no longer matches is `staleIdentity`. */
function classifyExistingRows<T extends ReconcileToken, R extends ReconcileRow>(
	existing: readonly R[],
	tokenById: Map<number, T>,
	desired: Set<string>,
): { seen: Set<string>; staleTokens: R[]; staleIdentity: R[] } {
	const seen = new Set<string>()
	const staleTokens: R[] = []
	const staleIdentity: R[] = []
	for (const row of existing) {
		const live = tokenById.get(row.token)
		if (live && row.profileId === live.profileId && !rowMatchesToken(row, live)) {
			staleIdentity.push(row)
			continue
		}
		const key = pairKey(row.token, row.account)
		if (!desired.has(key) || !live || !rowMatchesToken(row, live)) continue
		seen.add(key)
		// `syncFailure` set means the projector ran and failed — the queue owns
		// that retry. Only a row with neither a timestamp nor a failure has no
		// durable evidence the projection ever started.
		if (row.updatedAt === 0 && row.syncFailure === undefined) staleTokens.push(row)
	}
	return { seen, staleTokens, staleIdentity }
}

/** Total, deterministic order — chainId, token id, account index, then address. */
function comparePairs<T extends ReconcileToken, A extends ReconcileAccount>(
	a: { token: T; account: A },
	b: { token: T; account: A },
): number {
	return (
		a.token.chainId - b.token.chainId ||
		a.token.id - b.token.id ||
		a.account.index - b.account.index ||
		compareAddress(a.account.address, b.account.address)
	)
}

function compareAddress(a: string, b: string): number {
	if (a < b) return -1
	return a > b ? 1 : 0
}
