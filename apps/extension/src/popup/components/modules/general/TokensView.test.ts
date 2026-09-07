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
import { installChromeStorage } from "../../../../../tests/helpers/chrome-storage-mock"

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
		ContentKind: { Step: 0, BalanceUpdate: 1 },
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
		taskConnected: makeEvent(),
		journalAdded: makeEvent(),
		journalUpdated: makeEvent(),
		journalDeleted: makeEvent(),
		journalConnected: makeEvent(),
		quotesUpdated: makeEvent(),
		priceConnected: makeEvent(),
		quotes: { current: {} as Record<string, unknown> },
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
			onConnected: H.taskConnected,
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
vi.mock("@/wallet/services/incoming-transfer/client", async () => {
	// The view imports the REAL threshold constant from this module (the client re-exports spec);
	// pull it from the unmocked spec so the gate under test uses production policy, not a copy.
	const spec = await vi.importActual<typeof import("@/wallet/services/incoming-transfer/spec")>(
		"@/wallet/services/incoming-transfer/spec",
	)
	return {
		BACKFILL_INDICATOR_THRESHOLD_BLOCKS: spec.BACKFILL_INDICATOR_THRESHOLD_BLOCKS,
		IncomingTransferServiceClient: vi.fn(function () {
			return {
				disconnect: vi.fn(),
				onIncomingSyncStateChanged: H.syncChanged,
				onConnected: H.incomingConnected,
				getSyncState: H.getSyncState,
			}
		}),
	}
})
// The view orders rows by price: `usePrices` calls `refreshIfStale()` at construction, so the
// client must answer. Tests seed `H.quotes` to price a token.
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onQuotesUpdated: H.quotesUpdated,
			onConnected: H.priceConnected,
			refreshIfStale: vi.fn().mockImplementation(async () => H.quotes.current),
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

import { CHAIN_IDS } from "@/utils/chain-ids"
import { BACKFILL_INDICATOR_THRESHOLD_BLOCKS } from "@/wallet/services/incoming-transfer/spec"
import TokenCard from "./TokenCard.vue"
import TokensView from "./TokensView.vue"

// The pinned-token composable reads storage at mount and subscribes to onChanged.
beforeEach(() => {
	installChromeStorage()
})

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
/** A distinct row; `over` patches the token and the balance in one call. */
const namedRow = (id: number, symbol: string, over: Partial<{ chainId: number; contract: string; publicBalance: string }> = {}) => ({
	...balanceRow(over.contract ?? `0x${symbol.toLowerCase()}`),
	id,
	token: {
		id,
		chainId: over.chainId ?? 1,
		contract: over.contract ?? `0x${symbol.toLowerCase()}`,
		name: `${symbol} Token`,
		symbol,
		decimals: 18,
	},
	publicBalance: over.publicBalance ?? "1",
})
const cardSymbols = (wrapper: ReturnType<typeof mount>) =>
	wrapper.findAllComponents(TokenCard).map((c) => (c.props("tokenBalance") as { token: { symbol: string } }).token.symbol)

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
		H.quotes.current = {}
		H.getTasks.mockResolvedValue([])
		H.getOperations.mockResolvedValue([])
		H.getTokenBalances.mockResolvedValue([balanceRow()])
		H.getSyncState.mockResolvedValue({ state: "caught-up", blocksBehind: 0 })
	})

	test("a live `backfilling` event ABOVE the threshold threads the prop into the token's card", async () => {
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		expect(cardBackfilling(wrapper)).toBe(false)

		H.syncChanged.emit({
			networkId: "net-1",
			contract: CONTRACT,
			state: "backfilling",
			blocksBehind: BACKFILL_INDICATOR_THRESHOLD_BLOCKS,
		})
		await nextTick()
		expect(cardBackfilling(wrapper)).toBe(true)
	})

	test("backfilling BELOW the threshold stays quiet — routine catch-ups never show the dot", async () => {
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()

		H.syncChanged.emit({
			networkId: "net-1",
			contract: CONTRACT,
			state: "backfilling",
			blocksBehind: BACKFILL_INDICATOR_THRESHOLD_BLOCKS - 1,
		})
		await nextTick()
		expect(cardBackfilling(wrapper)).toBe(false)
	})

	test("hostile lag values (non-integer, negative, non-finite) degrade to 'no dot', never a poisoned gate", async () => {
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()

		for (const blocksBehind of [Number.NaN, -5, 3.5, Number.POSITIVE_INFINITY, 2 ** 53, undefined]) {
			H.syncChanged.emit({ networkId: "net-1", contract: CONTRACT, state: "backfilling", blocksBehind })
			await nextTick()
			expect(cardBackfilling(wrapper), `blocksBehind=${blocksBehind}`).toBe(false)
		}
	})

	const balanceTask = (id: string, tbId: number, finishedAt: number | null = null) => ({
		id,
		content: { kind: H.ContentKind.BalanceUpdate, tbId, account: "0xacct" },
		finishedAt,
	})
	const sectionDot = (wrapper: ReturnType<typeof mount>) => wrapper.find('[data-testid="tokens-refreshing"]').exists()

	test("a BalanceUpdate task in flight shows the SECTION refresh dot; completion clears it", async () => {
		// The one activity signal for routine refreshes (per-row indication is silent by design).
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		expect(sectionDot(wrapper)).toBe(false)

		H.taskCreated.emit(balanceTask("t1", 1))
		await nextTick()
		expect(sectionDot(wrapper)).toBe(true)

		H.taskUpdated.emit(balanceTask("t1", 1, 123))
		await nextTick()
		expect(sectionDot(wrapper)).toBe(false)
	})

	test("a completed refresh can't strand the dot across an A→B→A scope round-trip (stale-snapshot regression)", async () => {
		// The mount-time task snapshot must be MAINTAINED: fetchTokenBalances re-derives isUpdating
		// from it on every scope change, so a finished task lingering in the snapshot would
		// resurrect isUpdating and strand the section dot ON (post-impl audit, Medium).
		H.getTasks.mockResolvedValue([balanceTask("t1", 1)])
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		expect(sectionDot(wrapper)).toBe(true) // in flight at mount

		H.taskUpdated.emit(balanceTask("t1", 1, 123))
		await nextTick()
		expect(sectionDot(wrapper)).toBe(false)

		H.getTasks.mockResolvedValue([])
		H.store.current.network = { id: "net-2", chainId: 2 }
		await flushPromises()
		H.store.current.network = { id: "net-1", chainId: 1 }
		await flushPromises()
		expect(sectionDot(wrapper)).toBe(false) // NOT resurrected by the round-trip refetch
	})

	test("two concurrent refreshes: the dot survives the first completion, clears on the last", async () => {
		H.getTokenBalances.mockResolvedValue([balanceRow(), { ...balanceRow("0xtokenB"), id: 2 }])
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()

		H.taskCreated.emit(balanceTask("t1", 1))
		H.taskCreated.emit(balanceTask("t2", 2))
		await nextTick()
		expect(sectionDot(wrapper)).toBe(true)

		H.taskUpdated.emit(balanceTask("t1", 1, 123))
		await nextTick()
		expect(sectionDot(wrapper)).toBe(true) // t2 still running — the batch contract

		H.taskUpdated.emit(balanceTask("t2", 2, 124))
		await nextTick()
		expect(sectionDot(wrapper)).toBe(false)
	})

	test("a reconnect resnapshot clears a completion missed while disconnected", async () => {
		H.getTasks.mockResolvedValue([balanceTask("t1", 1)])
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		expect(sectionDot(wrapper)).toBe(true)

		// The completion event was dropped (SW restart); the reconnect resnapshot is the repair path.
		H.getTasks.mockResolvedValue([])
		H.taskConnected.emit()
		await flushPromises()
		expect(sectionDot(wrapper)).toBe(false)
	})

	test("caught-up never shows the dot regardless of reported lag", async () => {
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()

		H.syncChanged.emit({ networkId: "net-1", contract: CONTRACT, state: "caught-up", blocksBehind: 10_000 })
		await nextTick()
		expect(cardBackfilling(wrapper)).toBe(false)
	})

	test("a live event WINS over a getSyncState snapshot that resolves later (no stale clobber)", async () => {
		// The mount seed's getSyncState is deferred — it will resolve AFTER a live event supersedes it.
		const d = deferred<{ state: string; blocksBehind: number }>()
		H.getSyncState.mockReturnValueOnce(d.promise)
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises() // balances fetched, seed's getSyncState in flight (pending)

		H.syncChanged.emit({ networkId: "net-1", contract: CONTRACT, state: "backfilling", blocksBehind: 100 }) // live truth
		await nextTick()
		expect(cardBackfilling(wrapper)).toBe(true)

		d.resolve({ state: "caught-up", blocksBehind: 0 }) // the STALE snapshot resolves — must NOT overwrite the newer live value
		await flushPromises()
		expect(cardBackfilling(wrapper)).toBe(true)
	})

	test("an A→B→A scope cycle drops the old-scope snapshot (network equality alone is insufficient)", async () => {
		const dA = deferred<{ state: string; blocksBehind: number }>()
		H.getSyncState.mockReturnValueOnce(dA.promise) // net-1 seed snapshot — resolves after the cycle
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()

		// A → B (network switch): the watcher bumps scopeGen synchronously + resets the map.
		H.getSyncState.mockResolvedValue({ state: "caught-up", blocksBehind: 0 })
		H.store.current.network = { id: "net-2", chainId: 2 }
		await flushPromises()
		// B → A (switch back): scopeGen advances again.
		H.store.current.network = { id: "net-1", chainId: 1 }
		await flushPromises()

		// The original net-1 snapshot finally resolves with a (now-stale) value — must be discarded because
		// scopeGen changed since it was requested, even though we're back on net-1.
		dA.resolve({ state: "backfilling", blocksBehind: 100 })
		await flushPromises()
		expect(cardBackfilling(wrapper)).toBe(false) // stayed at the fresh scope's caught-up, not clobbered
	})
})

describe("TokensView — Home order and cap", () => {
	// Mainnet cUSD is a price-mapped contract; with a `usd-coin` quote seeded it is the one priced row.
	const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
	const MAINNET = CHAIN_IDS.MAINNET

	beforeEach(() => {
		vi.stubGlobal("useTicker", () => ({ value: Date.now() }))
		H.store.current = createAppStoreHarness()
		H.store.current.network = { id: "net-main", chainId: MAINNET }
		H.quotes.current = {}
		H.getTasks.mockResolvedValue([])
		H.getOperations.mockResolvedValue([])
		H.getSyncState.mockResolvedValue({ state: "caught-up", blocksBehind: 0 })
	})

	test("a priced token ranks first; unpriced held tokens follow by name; an empty row is last", async () => {
		H.quotes.current = { "usd-coin": { coingeckoId: "usd-coin", usd: 1, fetchedAt: Date.now(), providerUpdatedAt: null } }
		H.getTokenBalances.mockResolvedValue([
			namedRow(3, "ZED", { chainId: MAINNET }),
			namedRow(1, "PRICED", { contract: CUSD, chainId: MAINNET }),
			namedRow(4, "EMPTY", { chainId: MAINNET, publicBalance: "0" }),
			namedRow(2, "ALPHA", { chainId: MAINNET }),
		])
		// The count lives inside the design package's SectionLabel; let it render.
		const wrapper = mount(TokensView, { shallow: true, global: { stubs: { SectionLabel: false } } })
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual(["PRICED", "ALPHA", "ZED"])
		expect(wrapper.find('[data-testid="tokens-count"]').text()).toBe("4")
	})

	test("Home shows at most three rows and a View-all link with the overflow", async () => {
		H.getTokenBalances.mockResolvedValue([1, 2, 3, 4, 5].map((i) => namedRow(i, `T${i}`, { chainId: MAINNET })))
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()

		expect(cardSymbols(wrapper)).toHaveLength(3)
		expect(wrapper.find('[data-testid="tokens-view-all"]').exists()).toBe(true)
	})

	test("three or fewer tokens: every row shows and there is no View-all link", async () => {
		H.getTokenBalances.mockResolvedValue([namedRow(1, "A", { chainId: MAINNET }), namedRow(2, "B", { chainId: MAINNET })])
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()

		expect(cardSymbols(wrapper)).toHaveLength(2)
		expect(wrapper.find('[data-testid="tokens-view-all"]').exists()).toBe(false)
	})

	test("a same-address row from ANOTHER chain is not rendered (fetch and live add)", async () => {
		H.getTokenBalances.mockResolvedValue([namedRow(1, "A", { chainId: MAINNET }), namedRow(2, "FOREIGN", { chainId: 1 })])
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual(["A"])

		H.balanceAdded.emit(namedRow(3, "LATE", { chainId: 1 }))
		await nextTick()
		expect(cardSymbols(wrapper)).toEqual(["A"])
	})

	test("a scope change clears the previous rows before the new fetch resolves; a rejected fetch leaves none", async () => {
		H.getTokenBalances.mockResolvedValue([namedRow(1, "OLD", { chainId: MAINNET })])
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual(["OLD"])

		// The task snapshot is awaited before the balances: rows must already be gone while it hangs.
		const tasksPending = deferred<unknown[]>()
		H.getTasks.mockReturnValue(tasksPending.promise)
		const pending = deferred<unknown[]>()
		H.getTokenBalances.mockReturnValue(pending.promise)
		H.store.current.network = { id: "net-other", chainId: MAINNET + 1 }
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual([])

		tasksPending.resolve([])
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual([])
		pending.resolve([namedRow(2, "NEW", { chainId: MAINNET + 1 })])
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual(["NEW"])

		// A task snapshot that rejects does not block the balances.
		H.getTasks.mockRejectedValueOnce(new Error("port closed"))
		H.getTokenBalances.mockResolvedValue([namedRow(3, "AFTER", { chainId: MAINNET + 2 })])
		H.store.current.network = { id: "net-third", chainId: MAINNET + 2 }
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual(["AFTER"])

		H.getTokenBalances.mockRejectedValue(new Error("port closed"))
		H.store.current.network = { id: "net-main", chainId: MAINNET }
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual([])
	})

	test("an unmount during the scope watcher's task snapshot stops the balance fetch that would reconnect", async () => {
		H.getTokenBalances.mockResolvedValue([namedRow(1, "OLD", { chainId: MAINNET })])
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		const fetchesBefore = H.getTokenBalances.mock.calls.length

		const tasksPending = deferred<unknown[]>()
		H.getTasks.mockReturnValue(tasksPending.promise)
		H.store.current.network = { id: "net-other", chainId: MAINNET + 1 }
		await flushPromises()
		wrapper.unmount()
		tasksPending.resolve([])
		await flushPromises()
		expect(H.getTokenBalances.mock.calls.length).toBe(fetchesBefore)
	})

	test("hostile rows reach the REAL card without throwing: a dash for the malformed ones, the good row intact", async () => {
		H.getTokenBalances.mockResolvedValue([
			namedRow(1, "GOOD", { chainId: MAINNET }),
			namedRow(2, "FRACTION", { chainId: MAINNET, publicBalance: "1.5" }),
			{
				...namedRow(3, "DECIMALS", { chainId: MAINNET }),
				token: { ...namedRow(3, "DECIMALS").token, chainId: MAINNET, decimals: 500 },
			},
		])
		const wrapper = mount(TokensView, { shallow: true, global: { stubs: { TokenCard: false } } })
		await flushPromises()

		const cards = wrapper.findAll('[data-testid="tokens-card"]')
		expect(cards).toHaveLength(3)
		expect(cards.map((c) => c.find('[data-testid="token-symbol"]').attributes("data-symbol"))).toEqual(["GOOD", "DECIMALS", "FRACTION"])
		expect(cards.filter((c) => c.find("[data-malformed]").exists())).toHaveLength(2)
	})
})
