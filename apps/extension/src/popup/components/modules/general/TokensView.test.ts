/**
 * TokensView: the section refresh dot, Home order and cap, and the loading contract — the empty
 * state is a claim ("you have no tokens") that only two LOADED snapshots (balances + seed status)
 * may make; until then the list shows named placeholders or, after a short delay, anonymous rows.
 *
 * Mounted shallow so `TokenCard` / `TokenSeedRow` are stubs whose props are read directly.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
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
		balanceConnected: makeEvent(),
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
			onConnected: H.balanceConnected,
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
import TokenCard from "./TokenCard.vue"
import TokenSeedRow from "./TokenSeedRow.vue"
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

/** Shared mount-time answers: one loaded token row, nothing in flight. */
function resetHarness() {
	// `useTicker` is an auto-imported custom composable (only the token-import retention filter uses it)
	// — not injected into the test transform, so stub it. Per test: the shared setup unstubs globals.
	vi.stubGlobal("useTicker", () => ({ value: Date.now() }))
	H.store.current = createAppStoreHarness()
	H.quotes.current = {}
	H.getTasks.mockReset().mockResolvedValue([])
	H.getOperations.mockReset().mockResolvedValue([])
	H.getTokenBalances.mockReset().mockResolvedValue([balanceRow()])
}

describe("TokensView — section refresh dot", () => {
	beforeEach(resetHarness)

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
})

describe("TokensView — Home order and cap", () => {
	// Mainnet cUSD is a price-mapped contract; with a `usd-coin` quote seeded it is the one priced row.
	const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
	const MAINNET = CHAIN_IDS.MAINNET

	beforeEach(() => {
		resetHarness()
		H.store.current.network = { id: "net-main", chainId: MAINNET }
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

	test("a token_import op stamped with ANOTHER profile's id for the active address is hidden; the active profile's shows", async () => {
		const op = (id: string, profileId: string) => ({
			id,
			kind: "token_import",
			profileId,
			accountAddress: H.store.current.account?.address,
			terminalAt: null,
			progress: { stage: "pending" },
		})
		H.getOperations.mockResolvedValue([op("mine", "p1"), op("theirs", "p2")])
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		const rows = () => wrapper.findAllComponents({ name: "TokenImportRow" }).map((c) => (c.props("op") as { id: string }).id)
		expect(rows()).toEqual(["mine"])

		H.journalAdded.emit(op("late-theirs", "p2"))
		H.journalAdded.emit(op("late-mine", "p1"))
		await nextTick()
		expect(rows()).toEqual(["mine", "late-mine"])
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
		// The rejection armed the timed retry; unmounting cancels it before it can reach another test.
		wrapper.unmount()
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

	test("an unmount during the MOUNT's own awaits stops the balance fetch too", async () => {
		const tasksPending = deferred<unknown[]>()
		H.getTasks.mockReturnValue(tasksPending.promise)
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		wrapper.unmount()
		tasksPending.resolve([])
		await flushPromises()
		expect(H.getTokenBalances).not.toHaveBeenCalled()
		expect(H.getOperations).not.toHaveBeenCalled()
	})

	test("a profile-only switch (same address, same network) is a new scope: the other profile's rows go at once", async () => {
		H.getTokenBalances.mockResolvedValue([namedRow(1, "MINE", { chainId: MAINNET })])
		const wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual(["MINE"])

		const pending = deferred<unknown[]>()
		H.getTokenBalances.mockReturnValue(pending.promise)
		H.store.current.profile = { ...H.store.current.profile, id: "p-other" } as never
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual([])
		pending.resolve([])
		await flushPromises()
		wrapper.unmount()
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

describe("TokensView — loading, placeholders and the empty state", () => {
	const SEED_CONTRACT = "0xSeedAAAA"
	const seedEntry = (status = "pending", contract = SEED_CONTRACT) => ({
		chainId: 1,
		contract,
		symbol: "cUSDC",
		displayName: "Clean USDC",
		status,
	})
	const emptyState = (w: ReturnType<typeof mount>) => w.find('[data-testid="tokens-empty-import-link"]').exists()
	const ghostRows = (w: ReturnType<typeof mount>) => w.findAll('[data-testid="tokens-skeleton-row"]').length
	const seedRows = (w: ReturnType<typeof mount>) =>
		w.findAllComponents(TokenSeedRow).map((c) => (c.props("entry") as { contract: string }).contract)
	let wrapper: ReturnType<typeof mount>

	beforeEach(() => {
		resetHarness()
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
	})
	afterEach(() => {
		wrapper?.unmount()
		vi.useRealTimers()
	})

	test("a SEEDED default with no balance row yet still stands in the list — no empty state — until its row lands", async () => {
		H.getTokenBalances.mockResolvedValue([])
		wrapper = mount(TokensView, { shallow: true, props: { seedEntries: [seedEntry("seeded")], seedReady: true } })
		await flushPromises()
		expect(seedRows(wrapper)).toEqual([SEED_CONTRACT])
		expect(emptyState(wrapper)).toBe(false)
		// However long the row takes — or if it never comes — the list does not turn into "no tokens".
		await vi.advanceTimersByTimeAsync(600_000)
		expect(seedRows(wrapper)).toEqual([SEED_CONTRACT])
		expect(emptyState(wrapper)).toBe(false)

		H.balanceAdded.emit(namedRow(1, "cUSDC", { chainId: 1, contract: SEED_CONTRACT.toLowerCase() }))
		await flushPromises()
		expect(seedRows(wrapper)).toEqual([])
		expect(cardSymbols(wrapper)).toEqual(["cUSDC"])
	})

	test("the empty state needs BOTH snapshots loaded — whichever lands first, it waits for the other", async () => {
		H.getTokenBalances.mockResolvedValue([])
		wrapper = mount(TokensView, { shallow: true, props: { seedEntries: [], seedReady: false } })
		await flushPromises()
		expect(emptyState(wrapper)).toBe(false)
		await wrapper.setProps({ seedReady: true })
		expect(emptyState(wrapper)).toBe(true)

		// The other order: seed status first, balances still in flight.
		const pending = deferred<unknown[]>()
		H.getTokenBalances.mockReturnValue(pending.promise)
		const second = mount(TokensView, { shallow: true, props: { seedEntries: [], seedReady: true } })
		await flushPromises()
		expect(emptyState(second)).toBe(false)
		pending.resolve([])
		await flushPromises()
		expect(emptyState(second)).toBe(true)
		second.unmount()
	})

	test("anonymous rows appear only after 300 ms of a blank wait, and leave when anything real shows", async () => {
		const pending = deferred<unknown[]>()
		H.getTokenBalances.mockReturnValue(pending.promise)
		wrapper = mount(TokensView, { shallow: true, props: { seedEntries: [], seedReady: false } })
		await flushPromises()
		expect(ghostRows(wrapper)).toBe(0)
		await vi.advanceTimersByTimeAsync(299)
		expect(ghostRows(wrapper)).toBe(0)
		await vi.advanceTimersByTimeAsync(1)
		expect(ghostRows(wrapper)).toBe(2)
		expect(emptyState(wrapper)).toBe(false)

		await wrapper.setProps({ seedEntries: [seedEntry()], seedReady: true })
		expect(ghostRows(wrapper)).toBe(0)
		expect(seedRows(wrapper)).toEqual([SEED_CONTRACT])
	})

	test("a rejected balances fetch is never an empty list: rows keep waiting, the timed retry recovers", async () => {
		H.getTokenBalances.mockRejectedValueOnce(new Error("port closed")).mockResolvedValue([balanceRow()])
		wrapper = mount(TokensView, { shallow: true, props: { seedEntries: [], seedReady: true } })
		await flushPromises()
		await vi.advanceTimersByTimeAsync(300)
		expect(emptyState(wrapper)).toBe(false)
		expect(ghostRows(wrapper)).toBe(2)

		await vi.advanceTimersByTimeAsync(2_000)
		expect(cardSymbols(wrapper)).toEqual(["TKA"])
		expect(ghostRows(wrapper)).toBe(0)
	})

	test("a reconnect recovers a rejected fetch, and keeps the rows already shown while it refetches", async () => {
		H.getTokenBalances.mockRejectedValue(new Error("port closed"))
		wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		H.balanceConnected.emit() // the mount's own connect
		H.getTokenBalances.mockResolvedValue([balanceRow()])
		H.balanceConnected.emit()
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual(["TKA"])

		const pending = deferred<unknown[]>()
		H.getTokenBalances.mockReturnValue(pending.promise)
		H.balanceConnected.emit()
		await flushPromises()
		expect(cardSymbols(wrapper)).toEqual(["TKA"])
		expect(emptyState(wrapper)).toBe(false)
	})

	test("an event landing during an in-flight snapshot makes it refetch instead of overwriting the event", async () => {
		const stale = deferred<unknown[]>()
		H.getTokenBalances.mockReturnValueOnce(stale.promise).mockResolvedValue([balanceRow(), { ...balanceRow("0xtokenB"), id: 2 }])
		wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		H.balanceAdded.emit({ ...balanceRow("0xtokenB"), id: 2 })
		stale.resolve([balanceRow()]) // answered BEFORE the add: applying it would drop the new row
		await flushPromises()
		expect(wrapper.findAllComponents(TokenCard)).toHaveLength(2)
		expect(H.getTokenBalances).toHaveBeenCalledTimes(2)
	})

	test("a placeholder yields to its real row and to its import row — matched by contract, any case", async () => {
		H.getTokenBalances.mockResolvedValue([])
		wrapper = mount(TokensView, {
			shallow: true,
			props: { seedEntries: [seedEntry("seeding"), seedEntry("pending", "0xSeedBBBB")], seedReady: true },
			global: { stubs: { SectionLabel: false } },
		})
		await flushPromises()
		expect(seedRows(wrapper)).toEqual([SEED_CONTRACT, "0xSeedBBBB"])
		expect(wrapper.find('[data-testid="tokens-count"]').text()).toBe("2")

		H.journalAdded.emit({
			id: "op-seed",
			kind: "token_import",
			profileId: "p1",
			accountAddress: H.store.current.account?.address,
			contractAddress: "0xseedbbbb",
			terminalAt: null,
			progress: { stage: "pending" },
		})
		H.balanceAdded.emit(balanceRow(SEED_CONTRACT.toLowerCase()))
		await nextTick()
		expect(seedRows(wrapper)).toEqual([])
		expect(wrapper.find('[data-testid="tokens-count"]').text()).toBe("1")
	})

	test("another chain's seed entries are not shown; a retry bubbles up with its entry", async () => {
		H.getTokenBalances.mockResolvedValue([])
		const failed = seedEntry("failed")
		wrapper = mount(TokensView, {
			shallow: true,
			props: { seedEntries: [failed, { ...seedEntry("pending", "0xForeign"), chainId: 99 }], seedReady: true },
		})
		await flushPromises()
		expect(seedRows(wrapper)).toEqual([SEED_CONTRACT])

		wrapper.findComponent(TokenSeedRow).vm.$emit("retry")
		expect(wrapper.emitted("retry-seed")).toEqual([[failed]])
	})

	test("a scope change goes back to waiting: no empty state until the new scope's snapshot loads", async () => {
		H.getTokenBalances.mockResolvedValue([])
		wrapper = mount(TokensView, { shallow: true })
		await flushPromises()
		expect(emptyState(wrapper)).toBe(true)

		const pending = deferred<unknown[]>()
		H.getTokenBalances.mockReturnValue(pending.promise)
		H.store.current.network = { id: "net-2", chainId: 2 }
		await flushPromises()
		expect(emptyState(wrapper)).toBe(false)
		pending.resolve([])
		await flushPromises()
		expect(emptyState(wrapper)).toBe(true)
	})
})
