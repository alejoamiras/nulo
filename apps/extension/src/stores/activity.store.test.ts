/**
 * The isolation guarantee, stated as tests.
 *
 * The point of per-scope slices is that a foreign record cannot reach the
 * active view — not because a filter rejects it, but because it was never
 * written there. These tests drive records from other scopes through the same
 * entry points the producers use and assert the active view never moves.
 */

import type { ActivityScope } from "@nulo/wallet-core/activity"
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
