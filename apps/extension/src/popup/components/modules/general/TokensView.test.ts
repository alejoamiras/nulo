/**
 * TokensView §3 sync-state wiring + async-ordering guards (codex round 5 recommendation).
 *
 * Deterministic deferred-promise tests for the three races the guards close:
 *  1. a live event must win over a getSyncState snapshot that resolves LATER (stale),
 *  2. an A→B→A scope cycle must invalidate the old-scope snapshot (bare network equality isn't enough),
 *  3. baseline: a live `backfilling` event threads the `backfilling` prop into the token's card.
 *
 * Mounted shallow so `TokenCard` is a stub whose `backfilling` prop we read directly.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { createAppStoreHarness } from "../../../../../tests/helpers/app-store-harness"

const H = vi.hoisted(() => {
	const makeEvent = () => {
		const handlers = new Set<(x?: unknown) => void>()
		return {
			add: (fn: (x?: unknown) => void) => handlers.add(fn),
			remove: (fn: (x?: unknown) => void) => handlers.delete(fn),
			emit: (x?: unknown) => {
				for (const fn of [...handlers]) fn(x)
			},
		}
	}
	return {
		makeEvent,
		ContentKind: { Step: 0, BalanceUpdate: 1, TokenMint: 2 },
		getTasks: vi.fn(),
		getOperations: vi.fn(),
		getTokenBalances: vi.fn(),
		getSyncState: vi.fn(),
		syncChanged: makeEvent(),
		incomingConnected: makeEvent(),
		balanceAdded: makeEvent(),
		balanceUpdated: makeEvent(),
		balanceDeleted: makeEvent(),
		taskCreated: makeEvent(),
		taskUpdated: makeEvent(),
		taskDeleted: makeEvent(),
		journalAdded: makeEvent(),
		journalUpdated: makeEvent(),
		journalDeleted: makeEvent(),
		journalConnected: makeEvent(),
		store: { current: null as unknown as ReturnType<typeof createAppStoreHarness> },
	}
})

vi.mock("@/wallet/services/task/client", () => ({
	TaskServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onTaskCreated: H.taskCreated,
			onTaskUpdated: H.taskUpdated,
			onTaskDeleted: H.taskDeleted,
			getTasks: H.getTasks,
		}
	}),
}))
vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onTokenBalanceAdded: H.balanceAdded,
			onTokenBalanceUpdated: H.balanceUpdated,
			onTokenBalanceDeleted: H.balanceDeleted,
			getTokenBalances: H.getTokenBalances,
			refreshTokenBalance: vi.fn(),
		}
	}),
}))
vi.mock("@/wallet/services/operation-journal/client", () => ({
	OperationJournalServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onConnected: H.journalConnected,
			onOperationAdded: H.journalAdded,
			onOperationUpdated: H.journalUpdated,
			onOperationDeleted: H.journalDeleted,
			getOperations: H.getOperations,
		}
	}),
}))
vi.mock("@/wallet/services/incoming-transfer/client", () => ({
	IncomingTransferServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onIncomingSyncStateChanged: H.syncChanged,
			onConnected: H.incomingConnected,
			getSyncState: H.getSyncState,
		}
	}),
}))
vi.mock("@/wallet/services/task/spec", () => ({ ContentKind: H.ContentKind }))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => H.store.current }))
vi.mock("@/stores/popup.store", () => ({ usePopupStore: () => ({ open: vi.fn() }) }))
vi.mock("vue-router", async (importOriginal) => {
	const mod = await importOriginal<typeof import("vue-router")>()
	return { ...mod, useRouter: () => ({ push: vi.fn() }) }
})

import TokenCard from "./TokenCard.vue"
import TokensView from "./TokensView.vue"

function deferred<T>() {
	let resolve!: (v: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

const CONTRACT = "0xtokenA"
const balanceRow = (contract = CONTRACT) => ({
	id: 1,
	token: { id: 1, chainId: 1, contract, name: "Token A", symbol: "TKA", decimals: 18 },
	account: "0xacct",
	publicBalance: "1",
	privateBalance: "0",
	updatedAt: 1,
})

const cardBackfilling = (wrapper: ReturnType<typeof mount>, contract = CONTRACT): boolean | undefined => {
	const card = wrapper
		.findAllComponents(TokenCard)
		.find((c) => (c.props("tokenBalance") as { token?: { contract?: string } } | undefined)?.token?.contract === contract)
	return card?.props("backfilling") as boolean | undefined
}

describe("TokensView — §3 sync-state guards", () => {
	beforeEach(() => {
		// `useTicker` is an auto-imported custom composable (only the token-import retention filter uses it,
		// which stays empty here) — not injected into the test transform, so stub it. In beforeEach because
		// the shared setup unstubs globals between tests.
		vi.stubGlobal("useTicker", () => ({ value: Date.now() }))
		H.store.current = createAppStoreHarness()
		H.getTasks.mockResolvedValue([])
		H.getOperations.mockResolvedValue([])
		H.getTokenBalances.mockResolvedValue([balanceRow()])
		H.getSyncState.mockResolvedValue("caught-up")
	})

	test("a live `backfilling` event threads the prop into the token's card", async () => {
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		expect(cardBackfilling(wrapper)).toBe(false)

		H.syncChanged.emit({ networkId: "net-1", contract: CONTRACT, state: "backfilling" })
		await nextTick()
		expect(cardBackfilling(wrapper)).toBe(true)
	})

	test("a live event WINS over a getSyncState snapshot that resolves later (no stale clobber)", async () => {
		// The mount seed's getSyncState is deferred — it will resolve AFTER a live event supersedes it.
		const d = deferred<string>()
		H.getSyncState.mockReturnValueOnce(d.promise)
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises() // balances fetched, seed's getSyncState in flight (pending)

		H.syncChanged.emit({ networkId: "net-1", contract: CONTRACT, state: "backfilling" }) // live truth
		await nextTick()
		expect(cardBackfilling(wrapper)).toBe(true)

		d.resolve("caught-up") // the STALE snapshot resolves — must NOT overwrite the newer live value
		await flushPromises()
		expect(cardBackfilling(wrapper)).toBe(true)
	})

	test("an A→B→A scope cycle drops the old-scope snapshot (network equality alone is insufficient)", async () => {
		const dA = deferred<string>()
		H.getSyncState.mockReturnValueOnce(dA.promise) // net-1 seed snapshot — resolves after the cycle
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()

		// A → B (network switch): the watcher bumps scopeGen synchronously + resets the map.
		H.getSyncState.mockResolvedValue("caught-up")
		H.store.current.network = { id: "net-2", chainId: 2 }
		await flushPromises()
		// B → A (switch back): scopeGen advances again.
		H.store.current.network = { id: "net-1", chainId: 1 }
		await flushPromises()

		// The original net-1 snapshot finally resolves with a (now-stale) value — must be discarded because
		// scopeGen changed since it was requested, even though we're back on net-1.
		dA.resolve("backfilling")
		await flushPromises()
		expect(cardBackfilling(wrapper)).toBe(false) // stayed at the fresh scope's caught-up, not clobbered
	})
})
