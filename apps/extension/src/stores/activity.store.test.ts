/**
 * The isolation guarantee, stated as tests.
 *
 * The point of per-scope slices is that a foreign record cannot reach the
 * active view — not because a filter rejects it, but because it was never
 * written there. These tests drive records from other scopes through the same
 * entry points the producers use and assert the active view never moves.
 */

import { type ActivityScope, activityScopeKey } from "@nulo/wallet-core/activity"
import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, test } from "vitest"
import { useActivityStore } from "./activity.store"
import type { Tx } from "@/wallet/services/transaction/spec"

const A: ActivityScope = { profileId: "p1", networkId: "n1", chainId: 1, accountAddress: "0xa" }
const B: ActivityScope = { profileId: "p1", networkId: "n1", chainId: 1, accountAddress: "0xb" }
/** Same account and chain as A, but a different profile — the colliding-address case. */
const A_OTHER_PROFILE: ActivityScope = { ...A, profileId: "p2", networkId: "n2" }

const tx = (scope: ActivityScope, hash: string, over: Partial<Tx> = {}): Tx =>
	({
		hash,
		account: scope.accountAddress,
		chainId: scope.chainId,
		profileId: scope.profileId,
		networkId: scope.networkId,
		createdAt: 0,
		updatedAt: 0,
		status: 0,
		nonce: "0",
		feePaymentMethod: 0,
		origin: { type: 0 },
		calls: [],
		...over,
	}) as Tx

describe("activity store — scope routing", () => {
	beforeEach(() => {
		setActivePinia(createPinia())
	})

	test("a record from another account never enters the active view", () => {
		const store = useActivityStore()
		store.activateScope(A)

		store.ingestTransaction(tx(B, "0xfromB"), A)

		expect(store.transactions).toHaveLength(0)
	})

	test("a record from another profile with the SAME address never enters the active view", () => {
		const store = useActivityStore()
		store.activateScope(A)

		store.ingestTransaction(tx(A_OTHER_PROFILE, "0xfromP2"), A)

		expect(store.transactions).toHaveLength(0)
	})

	test("a foreign record is kept in its own scope, not discarded", () => {
		const store = useActivityStore()
		store.activateScope(A)
		store.ingestTransaction(tx(B, "0xfromB"), A)

		store.activateScope(B)

		expect(store.transactions.map((t) => t.hash)).toEqual(["0xfromB"])
	})

	test("switching back restores the previous view without refetching", () => {
		const store = useActivityStore()
		store.activateScope(A)
		store.ingestTransaction(tx(A, "0xa1"), A)
		store.ingestTransaction(tx(A, "0xa2"), A)

		store.activateScope(B)
		expect(store.transactions).toHaveLength(0)

		store.activateScope(A)
		expect(store.transactions.map((t) => t.hash).sort()).toEqual(["0xa1", "0xa2"])
	})

	test("a fetch that resolves after a switch lands in the scope it was fetched for", () => {
		const store = useActivityStore()
		store.activateScope(A)

		// The user switches away while A's fetch is still in flight…
		store.activateScope(B)
		store.setTransactions(A, [tx(A, "0xlate")])

		// …so B's view is untouched, and A has the rows when it comes back.
		expect(store.transactions).toHaveLength(0)
		store.activateScope(A)
		expect(store.transactions.map((t) => t.hash)).toEqual(["0xlate"])
	})

	test("a fetch that predates a live event is dropped, not installed over it", () => {
		const store = useActivityStore()
		store.activateScope(A)

		// A fetch captures the version, then an event lands while it is in flight.
		const captured = store.mutationVersionFor(A)
		store.ingestTransaction(tx(A, "0xlive", { updatedAt: 5 }), A)

		// The fetch resolves with a view that predates that event.
		const installed = store.setTransactions(A, [tx(A, "0xold", { updatedAt: 1 })], captured)

		expect(installed).toBe(false)
		expect(store.transactions.map((t) => t.hash)).toEqual(["0xlive"])
	})

	test("installing a fetch invalidates an older one that captured the same version", () => {
		const store = useActivityStore()
		store.activateScope(A)

		// Two fetches in flight, both captured the same version.
		const first = store.mutationVersionFor(A)
		const second = store.mutationVersionFor(A)

		expect(store.setTransactions(A, [tx(A, "0xnewer")], second)).toBe(true)
		// The older one must not overwrite what the newer just wrote — restore
		// writes rows without events, so nothing else would invalidate it.
		expect(store.setTransactions(A, [tx(A, "0xolder")], first)).toBe(false)
		expect(store.transactions.map((t) => t.hash)).toEqual(["0xnewer"])
	})

	test("a fetch with no intervening event installs normally", () => {
		const store = useActivityStore()
		store.activateScope(A)

		const captured = store.mutationVersionFor(A)
		const installed = store.setTransactions(A, [tx(A, "0xfetched")], captured)

		expect(installed).toBe(true)
		expect(store.transactions.map((t) => t.hash)).toEqual(["0xfetched"])
	})

	test("an update replaces the row in place rather than duplicating it", () => {
		const store = useActivityStore()
		store.activateScope(A)
		store.ingestTransaction(tx(A, "0xh", { updatedAt: 1 }), A)
		store.ingestTransaction(tx(A, "0xh", { updatedAt: 2, status: 1 as never }), A)

		expect(store.transactions).toHaveLength(1)
		expect(store.transactions[0]?.updatedAt).toBe(2)
	})

	test("transactions read newest first", () => {
		const store = useActivityStore()
		store.activateScope(A)
		store.ingestTransaction(tx(A, "0xold", { updatedAt: 1 }), A)
		store.ingestTransaction(tx(A, "0xnew", { updatedAt: 9 }), A)

		expect(store.transactions.map((t) => t.hash)).toEqual(["0xnew", "0xold"])
	})

	test("a legacy row with no scope is attributed only when the wallet holds one profile", () => {
		const store = useActivityStore()
		store.activateScope(A)

		const legacyMine = tx(A, "0xmine", { profileId: undefined, networkId: undefined })
		const legacyForeign = tx(B, "0xforeign", { profileId: undefined, networkId: undefined })
		const legacyOtherChain = tx(A, "0xotherchain", { profileId: undefined, networkId: undefined, chainId: 999 })

		for (const row of [legacyMine, legacyForeign, legacyOtherChain]) {
			store.ingestTransaction(row, A, { soleProfile: true })
		}

		expect(store.transactions.map((t) => t.hash)).toEqual(["0xmine"])
	})

	test("an unscoped row is dropped when another profile could own the same address", () => {
		const store = useActivityStore()
		store.activateScope(A)

		// Two profiles from one mnemonic derive the same address, so an address
		// alone cannot say who this row belongs to. Showing it would leak whichever
		// profile's history it really is.
		const ambiguous = tx(A, "0xambiguous", { profileId: undefined, networkId: undefined })
		store.ingestTransaction(ambiguous, A, { soleProfile: false })

		expect(store.transactions).toHaveLength(0)
	})

	test("a row that names its own profile is routed by it regardless of how many profiles exist", () => {
		const store = useActivityStore()
		store.activateScope(A)

		store.ingestTransaction(tx(A, "0xscoped"), A, { soleProfile: false })

		expect(store.transactions.map((t) => t.hash)).toEqual(["0xscoped"])
	})

	test("a row marked ambiguous is never attributed, even to the last profile standing", () => {
		const store = useActivityStore()
		store.activateScope(A)

		// Marked when its other owner was deleted: being the only profile left
		// does not make the row yours.
		const marked = tx(A, "0xambiguous", { profileId: undefined, networkId: undefined, ambiguous: true })
		store.ingestTransaction(marked, A, { soleProfile: true })

		expect(store.transactions).toHaveLength(0)
	})

	test("an update propagates even to a reader that already read the feed", () => {
		const store = useActivityStore()
		store.activateScope(A)

		// Reading first caches the computed. An in-place mutation would leave the
		// slice's identity unchanged, Vue would skip notifying, and this reader
		// would keep seeing the stale value forever.
		expect(store.transactions).toHaveLength(0)

		store.ingestTransaction(tx(A, "0xafter"), A)

		expect(store.transactions.map((t) => t.hash)).toEqual(["0xafter"])
	})

	test("with no active scope nothing renders", () => {
		const store = useActivityStore()
		store.activateScope(null)

		store.ingestTransaction(tx(A, "0xa1"), null)

		expect(store.transactions).toHaveLength(0)
	})
})

describe("activity store — awaiting placeholders", () => {
	beforeEach(() => {
		setActivePinia(createPinia())
	})

	const placeholder = (id: string, account: string) => ({ id, account, contract: "0xtoken", destination: "0xdest" })

	test("a placeholder belongs to the scope that created it", () => {
		const store = useActivityStore()
		store.activateScope(A)
		store.addAwaiting(A, placeholder("1", A.accountAddress))
		store.addAwaiting(B, placeholder("2", B.accountAddress))

		expect(store.awaitingTransactions.map((p) => p.id)).toEqual(["1"])
		store.activateScope(B)
		expect(store.awaitingTransactions.map((p) => p.id)).toEqual(["2"])
	})

	test("removal by id finds the placeholder even when its scope is not active", () => {
		const store = useActivityStore()
		store.activateScope(A)
		store.addAwaiting(B, placeholder("2", B.accountAddress))

		store.removeAwaiting("2")

		store.activateScope(B)
		expect(store.awaitingTransactions).toHaveLength(0)
	})

	test("settling clears the placeholder in the settling transaction's own scope", () => {
		const store = useActivityStore()
		store.addAwaiting(A, placeholder("1", A.accountAddress))
		store.addAwaiting(B, placeholder("2", B.accountAddress))

		store.settleAwaiting(B, (row) => row.account === B.accountAddress)

		store.activateScope(A)
		expect(store.awaitingTransactions).toHaveLength(1)
		store.activateScope(B)
		expect(store.awaitingTransactions).toHaveLength(0)
	})
})

describe("activity store — lifetime", () => {
	beforeEach(() => {
		setActivePinia(createPinia())
	})

	test("clearing a profile drops its scopes and leaves others alone", () => {
		const store = useActivityStore()
		store.ingestTransaction(tx(A, "0xa1"), A)
		store.ingestTransaction(tx(A_OTHER_PROFILE, "0xp2"), A_OTHER_PROFILE)

		store.clearProfile("p1")

		store.activateScope(A)
		expect(store.transactions).toHaveLength(0)
		store.activateScope(A_OTHER_PROFILE)
		expect(store.transactions.map((t) => t.hash)).toEqual(["0xp2"])
	})

	test("locking forgets everything, so a switch after unlock starts cold", () => {
		const store = useActivityStore()
		store.activateScope(A)
		store.ingestTransaction(tx(A, "0xa1"), A)
		store.ingestTransaction(tx(A_OTHER_PROFILE, "0xp2"), A_OTHER_PROFILE)

		store.clearAll()

		expect(store.transactions).toHaveLength(0)
		store.activateScope(A)
		expect(store.transactions).toHaveLength(0)
		store.activateScope(A_OTHER_PROFILE)
		expect(store.transactions).toHaveLength(0)
	})

	test("the cache is bounded and never evicts the active scope", () => {
		const store = useActivityStore()
		store.activateScope(A)
		store.ingestTransaction(tx(A, "0xkeep"), A)

		// Push well past the cap with unrelated scopes.
		for (let i = 0; i < 50; i++) {
			const scope: ActivityScope = { profileId: "p1", networkId: "n1", chainId: 1, accountAddress: `0xfill${i}` }
			store.ingestTransaction(tx(scope, `0xh${i}`), scope)
		}

		expect(store._slices.size).toBeLessThanOrEqual(33)
		expect(store.transactions.map((t) => t.hash)).toEqual(["0xkeep"])
	})
})

describe("activity store — B-29 eviction fences", () => {
	beforeEach(() => {
		setActivePinia(createPinia())
	})

	const floodScope = (i: number): ActivityScope => ({ profileId: "p1", networkId: "n1", chainId: 1, accountAddress: `0xflood${i}` })

	test("(B-29a PIN) a slice with unresolved awaiting placeholders survives LRU eviction", () => {
		const store = useActivityStore()
		const hot: ActivityScope = { profileId: "p1", networkId: "n1", chainId: 1, accountAddress: "0xhot" }
		// A live, unresolved optimistic send — no durable backing.
		store.addAwaiting(hot, { id: "await-1", account: "0xhot", contract: "0xtoken", destination: "0xdest" })

		// Flood the cache well past the cap with OTHER scopes, all created after the
		// hot slice so timestamp-based LRU would target the hot one first.
		for (let i = 0; i < 40; i++) store.ingestTransaction(tx(floodScope(i), `0xtx${i}`), floodScope(i))

		const key = activityScopeKey(hot)
		expect(store._slices.get(key)).toBeDefined()
		expect(store._slices.get(key)?.awaiting.some((a) => a.id === "await-1")).toBe(true)
	})

	test("(B-29b PIN) eviction keeps the mutation fence so a pre-eviction fetch can't ABA-revert a live tx", () => {
		const store = useActivityStore()
		const target: ActivityScope = { profileId: "p1", networkId: "n1", chainId: 1, accountAddress: "0xtarget" }

		// A fetch captures the version while the scope is fresh.
		const captured = store.mutationVersionFor(target)
		// A live transaction advances the scope's version after the capture.
		store.ingestTransaction(tx(target, "0xlive", { updatedAt: 5 }), target)
		// The scope is then evicted (flood past the cap) — under the bug this deletes
		// its version, letting a later recreation reset the fence back to the captured value.
		for (let i = 0; i < 40; i++) store.ingestTransaction(tx(floodScope(i), `0xtx${i}`), floodScope(i))

		// The pre-live-event fetch resolves. It MUST be rejected — accepting it would
		// revert the live "0xlive" transaction that arrived after the capture.
		const accepted = store.setTransactions(target, [tx(target, "0xstale", { updatedAt: 1 })], captured)
		expect(accepted).toBe(false)
	})

	test("(B-29c PIN) a virgin fetch capturing the absent-key baseline is rejected after a lock/clear", () => {
		const store = useActivityStore()
		const S: ActivityScope = { profileId: "p1", networkId: "n1", chainId: 1, accountAddress: "0xvirgin" }
		// A fetch for a NEVER-mutated scope captures its baseline (the old sentinel 0).
		const captured = store.mutationVersionFor(S)
		// A lock clears everything for privacy…
		store.clearAll()
		// …then the pre-lock fetch resolves. It must NOT be accepted and repopulate
		// the cleared scope — the absent-key ABA the positive sequence alone misses.
		const accepted = store.setTransactions(S, [tx(S, "0xstale")], captured)
		expect(accepted).toBe(false)
	})
})
