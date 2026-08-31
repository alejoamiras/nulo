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
 * The scope a transaction belongs to, or `null` if it cannot be established.
 *
 * A row that carries its own profile and network is always routed by those,
 * whatever is active. A row written before scope stamping carries neither, and
 * an address alone is NOT a profile identity: two profiles built from the same
 * mnemonic derive the same address, so attributing such a row by address and
 * chain would show one profile's history under the other.
 *
 * So an unscoped row is attributed to the reference scope only when the wallet
 * holds a single profile, where no other owner can exist. With more than one
 * profile the row is ambiguous and is dropped rather than guessed at — the
 * quarantine rule, applied to the one case that can actually collide.
 */
export function txScope(tx: Tx, reference: ActivityScope | null, opts: { soleProfile?: boolean } = {}): ActivityScope | null {
	if (tx.profileId && tx.networkId) {
		return { profileId: tx.profileId, networkId: tx.networkId, chainId: tx.chainId, accountAddress: tx.account }
	}
	if (!reference) return null
	// Marked at deletion time as belonging to a profile that can no longer be
	// determined. Being the last profile standing does not make it yours.
	if (tx.ambiguous) return null
	if (tx.account !== reference.accountAddress || tx.chainId !== reference.chainId) return null
	if (opts.soleProfile !== true) return null
	return { ...reference, accountAddress: tx.account }
}

/**
 * Whether a transaction belongs to exactly `scope`.
 *
 * `txScope` answers "which scope owns this row", which is NOT the same question:
 * a row carrying another profile's scope gets a perfectly valid, non-null answer.
 * Filtering a fetch on "has a scope" would therefore admit every profile's rows
 * for a shared address; the fetch is by address alone, so that is exactly the
 * set it returns.
 */
export function txBelongsToScope(tx: Tx, scope: ActivityScope, opts: { soleProfile?: boolean } = {}): boolean {
	const owner = txScope(tx, scope, opts)
	if (!owner) return false
	return (
		owner.profileId === scope.profileId &&
		owner.networkId === scope.networkId &&
		owner.chainId === scope.chainId &&
		owner.accountAddress === scope.accountAddress
	)
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline (122 lines) — split when touched, never grow
export const useActivityStore = defineStore("activity", () => {
	// `shallowRef` + explicit trigger: slices are mutated in place on a hot event
	// path, and deep reactivity over every transaction row is pure overhead.
	const slices = shallowRef(new Map<string, ActivitySlice>())
	const activeKey = ref<string | null>(null)
	const activeScope = ref<ActivityScope | null>(null)
	/**
	 * Per-scope count of live mutations applied.
	 *
	 * A fetch captures this before awaiting; if any event landed while it was in
	 * flight the count moved, and installing that now-stale array wholesale would
	 * erase the newer record. A refresh counter alone cannot see this — the event
	 * arrives between the capture and the resolve, with no second refresh to
	 * invalidate anything.
	 */
	const mutationVersion = shallowRef(new Map<string, number>())
	/**
	 * Strictly-increasing, store-lifetime sequence. A mutation version is drawn
	 * from it and NEVER reused, so a fetch's captured version can't recur for a
	 * scope that was evicted and later recreated (the ABA that would let a stale
	 * fetch silently revert a live transaction). Per-scope entries may be dropped
	 * for privacy (clear*) or kept across a cache eviction; either way the next
	 * mutation draws a fresh, higher value, so no captured version is ever matched
	 * by a different state.
	 */
	let mutationSeq = 0
	/**
	 * The baseline a NEVER-mutated scope reports. A clear* advances it past every
	 * prior version so a fetch that captured a virgin scope's baseline (the old
	 * absent-key sentinel `0`) can't be accepted after a lock/clear repopulates
	 * that scope — the absent-key ABA the per-scope sequence alone can't see.
	 */
	let incarnation = 0

	function bumpMutation(key: string): void {
		mutationSeq += 1
		mutationVersion.value.set(key, mutationSeq)
	}

	/** Advance the virgin baseline past every issued version. Called by clear* so a
	 *  pre-clear capture of an absent key can never match its post-clear absent state. */
	function advanceIncarnation(): void {
		mutationSeq += 1
		incarnation = mutationSeq
	}

	/** The mutation count a fetch should carry, captured before it awaits. An absent
	 *  key reports the current incarnation (not a fixed `0`), so a capture taken
	 *  before a clear can't match the same key after it. */
	function mutationVersionFor(scope: ActivityScope): number {
		return mutationVersion.value.get(activityScopeKey(scope)) ?? incarnation
	}

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
			// A slice holding unresolved optimistic placeholders is live work, not a
			// cold cache entry: evicting it would silently drop an AwaitingTx that has
			// no durable backing (mirrors balances.store's forcedGasPending exemption).
			.filter(([, slice]) => slice.awaiting.length === 0)
			.sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)
		// Dropping an inactive slice only drops a cache: the rows are durable and
		// the scope re-populates from storage the next time it is activated.
		for (const [key] of evictable.slice(0, slices.value.size - MAX_CACHED_SLICES)) {
			slices.value.delete(key)
			// Keep the mutation version: eviction is a cache drop, and resetting the
			// fence would let a pre-eviction fetch's captured version recur once the
			// scope is recreated (ABA), silently reverting a live transaction that
			// arrived after the capture. The map is bounded by the real scope count.
		}
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

	/**
	 * Replace a scope's transactions with the result of a fetch.
	 *
	 * `expectedVersion` is what `mutationVersionFor` returned before the fetch
	 * awaited. If a live event has been applied since, the fetch predates it and
	 * is dropped rather than overwriting the newer state.
	 */
	function setTransactions(scope: ActivityScope, rows: Tx[], expectedVersion?: number): boolean {
		if (expectedVersion !== undefined && mutationVersionFor(scope) !== expectedVersion) return false
		updateSlice(scope, (slice) => {
			slice.transactions = [...rows]
		})
		// Installing IS a change: an older fetch that captured the same version
		// must not overwrite what this one just wrote. Restore writes rows without
		// emitting events, so nothing else would invalidate it.
		bumpMutation(activityScopeKey(scope))
		return true
	}

	/**
	 * Route a transaction to its own scope.
	 *
	 * `reference` only ever supplies the profile/network for a legacy row that
	 * carries neither, and only when `soleProfile` says no other profile could
	 * own it; it never overrides a row that knows its own scope.
	 */
	function ingestTransaction(tx: Tx, reference: ActivityScope | null, opts: { soleProfile?: boolean } = {}): void {
		const scope = txScope(tx, reference, opts)
		if (!scope) return
		updateSlice(scope, (slice) => {
			const existing = slice.transactions.findIndex((row) => row.hash === tx.hash && row.account === tx.account)
			if (existing === -1) slice.transactions.push(tx)
			else slice.transactions.splice(existing, 1, tx)
		})
		bumpMutation(activityScopeKey(scope))
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
		const key = activityScopeKey(scope)
		slices.value.delete(key)
		mutationVersion.value.delete(key)
		advanceIncarnation()
		touch()
	}

	function clearProfile(profileId: string): void {
		for (const [key, slice] of [...slices.value]) {
			if (slice.scope.profileId !== profileId) continue
			slices.value.delete(key)
		}
		// Drop version entries by KEY, not by surviving slice: an EVICTED scope keeps
		// its version (eviction no longer deletes it), so a slices-only sweep would
		// leave a stale entry a pre-clear fetch could still match. The key is
		// `JSON.stringify([profileId, ...])`, so its first element is the profile id.
		for (const key of [...mutationVersion.value.keys()]) {
			if ((JSON.parse(key) as [string])[0] === profileId) mutationVersion.value.delete(key)
		}
		advanceIncarnation()
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
		// Keyed by scope, so leaving it behind would retain profile + address
		// identifiers past a lock.
		mutationVersion.value.clear()
		// Advance the virgin baseline so a pre-lock fetch that captured a scope's
		// absent-key sentinel can't be accepted after unlock and repopulate it.
		advanceIncarnation()
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
		mutationVersionFor,
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
