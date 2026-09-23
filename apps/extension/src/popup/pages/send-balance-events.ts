/**
 * Pure reducers for the Send page's live token-balance events. `send.vue`
 * subscribes to the balance service's add/update streams; these apply an event
 * to the page's `tokenBalances` array WITHOUT reaching into Vue reactivity, so
 * the logic is unit-testable in isolation.
 *
 * B-25: `onBalanceAdded` previously called `.push` on the singular
 * `tokenBalance` COMPUTED (a `ComputedRef`, no `.push`) — every live add event
 * threw `tokenBalance.push is not a function`. The append target is the
 * `tokenBalances` ARRAY, which this helper makes explicit.
 */

/** A live token-balance event carries at least an owning account and a numeric id. */
export interface TokenBalanceEvent {
	account: string
	id: number
}

/**
 * Append a newly-added balance to the active account's list. A balance for a
 * different account is ignored (the page is scoped to one account at a time).
 * Mutates `list` in place (the caller passes `tokenBalances.value`).
 */
export function applyBalanceAdd<T extends TokenBalanceEvent>(list: T[], activeAccountAddress: string, balance: T): void {
	if (balance.account !== activeAccountAddress) return
	list.push(balance)
}

/**
 * Replace an existing balance in place, matched by id. An unknown id is ignored
 * (adds arrive via {@link applyBalanceAdd}). Mutates `list` in place.
 */
export function applyBalanceUpdate<T extends TokenBalanceEvent>(list: T[], balance: T): void {
	const idx = list.findIndex((tb) => tb.id === balance.id)
	if (idx === -1) return
	list[idx] = balance
}
