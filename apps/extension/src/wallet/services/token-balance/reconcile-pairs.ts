/**
 * The pure half of balance-row reconciliation: given the active profile's
 * tokens, its accounts, and the balance rows that already exist, decide which
 * `(token, account)` pairs are missing and which existing rows were never
 * projected.
 *
 * No storage, no chrome, no service — everything the caller must serialize
 * lives on the other side of this boundary.
 */

/** The token fields reconciliation needs. Deliberately narrower than `Token`
 *  so this module can be exercised without the storage codec. */
export type ReconcileToken = {
	id: number
	chainId: number
}

/** The account fields reconciliation needs. `index` participates in the sort
 *  only as a tiebreak-before-address. */
export type ReconcileAccount = {
	address: string
	chainId: number
	index: number
}

/** The existing-row fields reconciliation needs. */
export type ReconcileRow = {
	token: number
	account: string
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
}

/** `${tokenId}:${address}` — the pair identity. Balance rows carry no chainId
 *  or profileId, so the pair is only meaningful against a caller-supplied
 *  active-profile token set. */
function pairKey(token: number, account: string): string {
	return `${token}:${account}`
}

/**
 * Both halves of the repair, computed in one pass.
 *
 * Pairs are formed only where `token.chainId === account.chainId`: the row
 * schema cannot express chain scoping, so nothing downstream would catch a
 * mainnet token paired with a testnet account.
 *
 * Existing rows are indexed only under keys the desired set actually contains,
 * so a foreign profile's rows are never materialized. This cannot defend
 * against a stale row left by a DELETED token whose id was later reused —
 * ids are `max+1`, so reuse is possible and such a row would suppress repair.
 * Not solvable from this schema; tracked separately.
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

	const accountsByChain = new Map<number, A[]>()
	for (const account of accounts) {
		const bucket = accountsByChain.get(account.chainId)
		if (bucket) bucket.push(account)
		else accountsByChain.set(account.chainId, [account])
	}

	const desired = new Set<string>()
	const pairs: { token: T; account: A }[] = []
	for (const token of tokens) {
		for (const account of accountsByChain.get(token.chainId) ?? []) {
			const key = pairKey(token.id, account.address)
			// A duplicate token id or account address in the inputs must not
			// yield the same pair twice.
			if (desired.has(key)) continue
			desired.add(key)
			pairs.push({ token, account })
		}
	}

	const seen = new Set<string>()
	const staleTokens: R[] = []
	for (const row of existing) {
		const key = pairKey(row.token, row.account)
		if (!desired.has(key)) continue
		seen.add(key)
		// `syncFailure` set means the projector ran and failed — the queue owns
		// that retry. Only a row with neither a timestamp nor a failure has no
		// durable evidence the projection ever started.
		if (row.updatedAt === 0 && row.syncFailure === undefined) staleTokens.push(row)
	}

	const missing = pairs.filter(({ token, account }) => !seen.has(pairKey(token.id, account.address)))
	missing.sort(
		(a, b) =>
			a.token.chainId - b.token.chainId ||
			a.token.id - b.token.id ||
			a.account.index - b.account.index ||
			(a.account.address < b.account.address ? -1 : a.account.address > b.account.address ? 1 : 0),
	)

	return { missing, staleTokens }
}
