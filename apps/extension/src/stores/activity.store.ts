/**
 * Per-scope activity state.
 *
 * The feed used to be one flat list keyed on "whoever is active right now", so
 * anything arriving late — a broadcast event, a settling transaction, a fetch
 * that resolved after a switch — landed wherever the user happened to be. This
 * store keeps one slice per `(profileId, networkId, chainId, accountAddress)`
 * and routes every record into the slice for the record's OWN scope. A foreign
 * record cannot reach the active view because it is not in that map entry at
 * all, which is a stronger guarantee than a filter someone has to remember.
 *
 * Switching scope is a pointer move, so the previous view reappears from cache
 * instead of clearing and refetching. (The DOM still has to render; only the
 * state swap is free.)
 */

import { type ActivityScope, activityScopeKey } from "@nulo/wallet-core/activity"
import { defineStore } from "pinia"
import { computed, ref, shallowRef, triggerRef } from "vue"
import type { Tx } from "@/wallet/services/transaction/spec"

/** An optimistic placeholder for a send with no transaction row yet. */
export type AwaitingTx = {
	/** Unique per submission so the rejection path removes exactly the placeholder
	 *  it created — never a by-destination/contract search that could hit a
	 *  same-recipient sibling or another account's row. */
	id: string
	account: string
	contract: string
	destination: string
}

/** How many inactive slices to keep before evicting the least recently used. */
const MAX_CACHED_SLICES = 32

export interface ActivitySlice {
	scope: ActivityScope
	/** Settled + pending transactions, newest first when read. */
	transactions: Tx[]
	/** Optimistic placeholders for sends that have no transaction row yet. */
	awaiting: AwaitingTx[]
	lastAccessedAt: number
}

const EMPTY_SLICE: ActivitySlice = Object.freeze({
	scope: { profileId: "", networkId: "", chainId: -1, accountAddress: "" },
	transactions: [],
	awaiting: [],
	lastAccessedAt: 0,
}) as ActivitySlice

function newSlice(scope: ActivityScope): ActivitySlice {
	return { scope, transactions: [], awaiting: [], lastAccessedAt: Date.now() }
}

/**
 * The scope a transaction belongs to.
 *
 * Rows written before scope stamping carry no profile or network. Those are
 * attributed to the reference scope only when their account and chain match it
 * — the same rule the flat feed used, so nothing regresses — while rows that DO
 * carry a scope are always routed by their own, whatever is active.
 */
export function txScope(tx: Tx, reference: ActivityScope | null): ActivityScope | null {
	if (tx.profileId && tx.networkId) {
		return { profileId: tx.profileId, networkId: tx.networkId, chainId: tx.chainId, accountAddress: tx.account }
	}
	if (!reference) return null
	if (tx.account !== reference.accountAddress || tx.chainId !== reference.chainId) return null
	return { ...reference, accountAddress: tx.account }
}

export const useActivityStore = defineStore("activity", () => {
	// `shallowRef` + explicit trigger: slices are mutated in place on a hot event
	// path, and deep reactivity over every transaction row is pure overhead.
	const slices = shallowRef(new Map<string, ActivitySlice>())
	const activeKey = ref<string | null>(null)
	const activeScope = ref<ActivityScope | null>(null)

	const activeSlice = computed<ActivitySlice>(() => {
		const key = activeKey.value
		return (key && slices.value.get(key)) || EMPTY_SLICE
	})

	/** Newest first. The store keeps insertion order; ordering is a read concern. */
	const transactions = computed<Tx[]>(() => [...activeSlice.value.transactions].sort((a, b) => b.updatedAt - a.updatedAt))
	const awaitingTransactions = computed<AwaitingTx[]>(() => activeSlice.value.awaiting)

	/**
	 * Replace a slice with an updated copy.
	 *
	 * Copy-on-write rather than in-place mutation: `activeSlice` is a computed,
	 * and Vue skips notifying dependents when a computed re-evaluates to the same
	 * value. Mutating the slice object in place leaves that identity unchanged, so
	 * anything that had already read the feed would never see the update.
	 */
	function updateSlice(scope: ActivityScope, mutate: (slice: ActivitySlice) => void): void {
		const key = activityScopeKey(scope)
		const current = slices.value.get(key) ?? newSlice(scope)
		const next: ActivitySlice = { ...current, transactions: [...current.transactions], awaiting: [...current.awaiting] }
		mutate(next)
		slices.value.set(key, next)
		evictIfNeeded()
		triggerRef(slices)
	}

	function touch(): void {
		triggerRef(slices)
	}

	function evictIfNeeded(): void {
		if (slices.value.size <= MAX_CACHED_SLICES) return
		const evictable = [...slices.value.entries()]
			.filter(([key]) => key !== activeKey.value)
			.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)
		// Dropping an inactive slice only drops a cache: the rows are durable and
		// the scope re-populates from storage the next time it is activated.
		for (const [key] of evictable.slice(0, slices.value.size - MAX_CACHED_SLICES)) slices.value.delete(key)
	}

	function ensureSlice(scope: ActivityScope): ActivitySlice {
		const key = activityScopeKey(scope)
		let slice = slices.value.get(key)
		if (!slice) {
			slice = newSlice(scope)
			slices.value.set(key, slice)
			evictIfNeeded()
		}
		return slice
	}

	/** Point the view at a scope. Its cached rows render immediately. */
	function activateScope(scope: ActivityScope | null): void {
		if (!scope) {
			activeKey.value = null
			activeScope.value = null
			return
		}
		ensureSlice(scope)
		updateSlice(scope, (slice) => {
			slice.lastAccessedAt = Date.now()
		})
		activeScope.value = scope
		activeKey.value = activityScopeKey(scope)
		touch()
	}

	/** Replace a scope's transactions wholesale (a completed fetch for that scope). */
	function setTransactions(scope: ActivityScope, rows: Tx[]): void {
		updateSlice(scope, (slice) => {
			slice.transactions = [...rows]
		})
	}

	/**
	 * Route a transaction to its own scope.
	 *
	 * `reference` only ever supplies the profile/network for a legacy row that
	 * carries neither; it never overrides a row that knows its own scope.
	 */
	function ingestTransaction(tx: Tx, reference: ActivityScope | null): void {
		const scope = txScope(tx, reference)
		if (!scope) return
		updateSlice(scope, (slice) => {
			const existing = slice.transactions.findIndex((row) => row.hash === tx.hash && row.account === tx.account)
			if (existing === -1) slice.transactions.push(tx)
			else slice.transactions.splice(existing, 1, tx)
		})
	}

	function addAwaiting(scope: ActivityScope, row: AwaitingTx): void {
		updateSlice(scope, (slice) => {
			slice.awaiting.push(row)
		})
	}

	/** Remove a placeholder by its unique id, from whichever scope holds it. */
	function removeAwaiting(id: string): void {
		for (const slice of [...slices.value.values()]) {
			if (!slice.awaiting.some((row) => row.id === id)) continue
			updateSlice(slice.scope, (next) => {
				next.awaiting = next.awaiting.filter((row) => row.id !== id)
			})
			return
		}
	}

	/** Drop the placeholder a settled transaction fulfils, in that transaction's own scope. */
	function settleAwaiting(scope: ActivityScope, match: (row: AwaitingTx) => boolean): void {
		const slice = slices.value.get(activityScopeKey(scope))
		if (!slice || slice.awaiting.findIndex(match) === -1) return
		updateSlice(scope, (next) => {
			const idx = next.awaiting.findIndex(match)
			if (idx !== -1) next.awaiting.splice(idx, 1)
		})
	}

	function clearScope(scope: ActivityScope): void {
		slices.value.delete(activityScopeKey(scope))
		touch()
	}

	function clearProfile(profileId: string): void {
		for (const [key, slice] of [...slices.value]) {
			if (slice.scope.profileId === profileId) slices.value.delete(key)
		}
		touch()
	}

	/**
	 * Forget everything.
	 *
	 * Called on wallet lock. Switching profiles today goes through lock/unlock,
	 * so this deliberately means a profile switch starts cold — no other
	 * profile's activity outlives a lock in memory.
	 */
	function clearAll(): void {
		slices.value.clear()
		activeKey.value = null
		activeScope.value = null
		touch()
	}

	return {
		activeScope,
		activeSlice,
		transactions,
		awaitingTransactions,
		activateScope,
		setTransactions,
		ingestTransaction,
		addAwaiting,
		removeAwaiting,
		settleAwaiting,
		clearScope,
		clearProfile,
		clearAll,
		/** Test/debug only — the UI must read `activeSlice`. */
		_slices: slices,
	}
})
