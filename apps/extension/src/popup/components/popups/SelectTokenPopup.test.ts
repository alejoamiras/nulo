/**
 * The Send picker over chain-scoped balance rows: the shared order, the search box past Home's
 * budget, the filter, selection writing the TOKEN id, the scope fence on a slow fetch, a fetch
 * rejected by the hide, the reconnect resnapshot, and the teardown on hide / unmount.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { createAppStoreHarness } from "../../../../tests/helpers/app-store-harness"

const H = vi.hoisted(() => {
	const makeEvent = () => {
		const handlers = new Set<(x?: unknown) => void>()
		return {
			add: (fn: (x?: unknown) => void) => handlers.add(fn),
			remove: (fn: (x?: unknown) => void) => handlers.delete(fn),
			clear: () => handlers.clear(),
			emit: (x?: unknown) => {
				for (const fn of [...handlers]) fn(x)
			},
		}
	}
	return {
		getTokenBalances: vi.fn(),
		balanceDisconnect: vi.fn(),
		priceDisconnect: vi.fn(),
		balanceAdded: makeEvent(),
		balanceUpdated: makeEvent(),
		balanceDeleted: makeEvent(),
		balanceConnected: makeEvent(),
		quotesUpdated: makeEvent(),
		priceConnected: makeEvent(),
		quotes: { current: {} as Record<string, unknown> },
		store: { current: null as unknown as ReturnType<typeof createAppStoreHarness> },
		cache: { activeTokenIdx: undefined as number | undefined },
		routerPush: vi.fn(),
		closeAll: vi.fn(),
	}
})

vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn(function () {
		return {
			disconnect: H.balanceDisconnect,
			onConnected: H.balanceConnected,
			onTokenBalanceAdded: H.balanceAdded,
			onTokenBalanceUpdated: H.balanceUpdated,
			onTokenBalanceDeleted: H.balanceDeleted,
			getTokenBalances: H.getTokenBalances,
		}
	}),
}))
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return {
			disconnect: H.priceDisconnect,
			onQuotesUpdated: H.quotesUpdated,
			onConnected: H.priceConnected,
			refreshIfStale: vi.fn().mockImplementation(async () => H.quotes.current),
		}
	}),
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => H.store.current }))
// The real store is a Pinia proxy; the selection mark re-renders only through a reactive write.
vi.mock("@/stores/cache.store", async () => {
	const { reactive } = await import("vue")
	const store = reactive(H.cache)
	return { useCacheStore: () => store }
})
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { select_token: { order: 1 } }, closeAll: H.closeAll }),
}))
vi.mock("vue-router", async (importOriginal) => {
	const mod = await importOriginal<typeof import("vue-router")>()
	return { ...mod, useRouter: () => ({ push: H.routerPush }) }
})

import { CHAIN_IDS } from "@/utils/chain-ids"
import SelectTokenPopup from "./SelectTokenPopup.vue"

const STUBS = {
	Popup: { props: ["show"], template: "<div v-if='show'><slot /></div>" },
	PopupCard: { template: "<div><slot /></div>" },
	PopupHeader: { template: "<div><slot name='title' /></div>" },
	ItemsContainer: { template: "<div><slot /></div>" },
	SettingItem: { props: ["title"], template: "<div :data-title='title' />" },
	MaterialIcon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
}

const MAINNET = CHAIN_IDS.MAINNET
// Mainnet cUSD is a price-mapped contract; with a `usd-coin` quote seeded it is the one priced row.
const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
const ACCOUNT = `0x${"a".repeat(64)}`
const OTHER_ACCOUNT = `0x${"b".repeat(64)}`

/** The balance row id and the token id differ on purpose: selection must write the TOKEN id. */
const row = (
	id: number,
	symbol: string,
	over: Partial<{ chainId: number; contract: string; publicBalance: string; account: string }> = {},
) => ({
	id: id + 100,
	account: over.account ?? ACCOUNT,
	token: {
		id,
		chainId: over.chainId ?? MAINNET,
		contract: over.contract ?? `0x${symbol.toLowerCase()}`,
		name: `${symbol} Token`,
		symbol,
		decimals: 18,
	},
	publicBalance: over.publicBalance ?? "1",
	privateBalance: "0",
	updatedAt: 1,
})

const rowSymbols = (wrapper: ReturnType<typeof mount>) =>
	wrapper.findAll('[data-testid="select-token-row"]').map((el) => el.attributes("data-symbol"))

async function mountOpen(rows: ReturnType<typeof row>[]) {
	H.getTokenBalances.mockResolvedValue(rows)
	const wrapper = mount(SelectTokenPopup, { props: { show: false }, global: { stubs: STUBS } })
	await wrapper.setProps({ show: true })
	await flushPromises()
	return wrapper
}

/** The pinned-token composable reads storage on load and subscribes to onChanged. */
function installStorage(seed: Record<string, unknown> = {}) {
	const backing: Record<string, unknown> = { ...seed }
	const g = globalThis as unknown as { chrome: Record<string, unknown> }
	g.chrome = {
		...g.chrome,
		storage: {
			local: {
				get: async (keys: string | string[]) => {
					const out: Record<string, unknown> = {}
					for (const k of Array.isArray(keys) ? keys : [keys]) if (k in backing) out[k] = backing[k]
					return out
				},
				set: async (items: Record<string, unknown>) => {
					Object.assign(backing, items)
				},
			},
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
	}
}

describe("SelectTokenPopup", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		installStorage()
		// Mounted popups from earlier cases still hold their handlers on the shared events.
		for (const ev of [H.balanceAdded, H.balanceUpdated, H.balanceDeleted, H.balanceConnected, H.quotesUpdated, H.priceConnected])
			ev.clear()
		H.quotes.current = {}
		H.cache.activeTokenIdx = undefined
		H.store.current = createAppStoreHarness()
		H.store.current.account = { address: ACCOUNT }
		H.store.current.network = { id: "net-main", chainId: MAINNET }
	})

	test("rows follow the shared order: the priced token first, then held tokens by name, an empty row last", async () => {
		H.quotes.current = { "usd-coin": { coingeckoId: "usd-coin", usd: 1, fetchedAt: Date.now(), providerUpdatedAt: null } }
		const wrapper = await mountOpen([
			row(3, "ZED"),
			row(4, "EMPTY", { publicBalance: "0" }),
			row(1, "PRICED", { contract: CUSD }),
			row(2, "ALPHA"),
		])
		expect(rowSymbols(wrapper)).toEqual(["PRICED", "ALPHA", "ZED", "EMPTY"])
		expect(H.getTokenBalances).toHaveBeenCalledWith(undefined, ACCOUNT)
	})

	test("a row on another chain is not listed", async () => {
		const wrapper = await mountOpen([row(1, "HERE"), row(2, "ELSEWHERE", { chainId: MAINNET + 1 })])
		expect(rowSymbols(wrapper)).toEqual(["HERE"])
	})

	test("the search box appears only past Home's budget", async () => {
		const three = await mountOpen([row(1, "A"), row(2, "B"), row(3, "C")])
		expect(three.find('[data-testid="select-token-search"]').exists()).toBe(false)

		const four = await mountOpen([row(1, "A"), row(2, "B"), row(3, "C"), row(4, "D")])
		expect(four.find('[data-testid="select-token-search"]').exists()).toBe(true)
	})

	test("search filters by symbol and shows the no-results line on a miss", async () => {
		const wrapper = await mountOpen([row(1, "ALPHA"), row(2, "BETA"), row(3, "GAMMA"), row(4, "DELTA")])
		await wrapper.find('[data-testid="select-token-search"]').setValue("eta")
		expect(rowSymbols(wrapper)).toEqual(["BETA"])

		await wrapper.find('[data-testid="select-token-search"]').setValue("zzz")
		expect(rowSymbols(wrapper)).toEqual([])
		expect(wrapper.find('[data-testid="select-token-no-results"]').exists()).toBe(true)
	})

	test("a query stops filtering once a deletion shrinks the list under the search threshold", async () => {
		const wrapper = await mountOpen([row(1, "ALPHA"), row(2, "BETA"), row(3, "GAMMA"), row(4, "DELTA")])
		await wrapper.find('[data-testid="select-token-search"]').setValue("delta")
		expect(rowSymbols(wrapper)).toEqual(["DELTA"])

		H.balanceDeleted.emit(row(4, "DELTA"))
		await nextTick()
		expect(wrapper.find('[data-testid="select-token-search"]').exists()).toBe(false)
		expect(rowSymbols(wrapper)).toEqual(["ALPHA", "BETA", "GAMMA"])
	})

	test("selecting a row writes the TOKEN id (not the balance row id), marks it selected, and closes", async () => {
		const wrapper = await mountOpen([row(7, "ONE"), row(9, "TWO")])
		expect(wrapper.findAll('[data-testid="select-token-row"]').map((el) => el.attributes("data-selected"))).toEqual(["false", "false"])

		await wrapper.find('[data-testid="select-token-row"][data-symbol="TWO"]').trigger("click")
		expect(H.cache.activeTokenIdx).toBe(9)
		expect(wrapper.emitted("onClose")).toHaveLength(1)

		await nextTick()
		expect(wrapper.find('[data-testid="select-token-row"][data-symbol="TWO"]').attributes("data-selected")).toBe("true")
	})

	test("a fetch for the previous account that resolves late never lands; the scope change refetches", async () => {
		const pending = new Map<string, (rows: ReturnType<typeof row>[]) => void>()
		H.getTokenBalances.mockImplementation(
			(_id: unknown, account: string) =>
				new Promise((resolve) => {
					pending.set(account, resolve)
				}),
		)
		const wrapper = mount(SelectTokenPopup, { props: { show: false }, global: { stubs: STUBS } })
		await wrapper.setProps({ show: true })
		await flushPromises()

		H.store.current.account = { address: OTHER_ACCOUNT }
		await flushPromises()
		pending.get(OTHER_ACCOUNT)?.([row(2, "THEIRS", { account: OTHER_ACCOUNT })])
		await flushPromises()
		pending.get(ACCOUNT)?.([row(1, "MINE")])
		await flushPromises()
		expect(rowSymbols(wrapper)).toEqual(["THEIRS"])
	})

	test("a fetch rejected by the hide is swallowed; one rejected while open shows the error line", async () => {
		let reject: ((e: Error) => void) | undefined
		H.getTokenBalances.mockImplementation(
			() =>
				new Promise((_resolve, rej) => {
					reject = rej
				}),
		)
		const wrapper = mount(SelectTokenPopup, { props: { show: false }, global: { stubs: STUBS } })
		await wrapper.setProps({ show: true })
		await flushPromises()
		await wrapper.setProps({ show: false })
		reject?.(new Error("port closed"))
		await flushPromises()

		await wrapper.setProps({ show: true })
		await flushPromises()
		reject?.(new Error("service failed"))
		await flushPromises()
		expect(wrapper.find('[data-testid="select-token-error"]').exists()).toBe(true)
		expect(rowSymbols(wrapper)).toEqual([])
	})

	test("the connect a load opens is not a reconnect; a port drop mid-load reloads with no error shown", async () => {
		let rejectFirst: ((e: Error) => void) | undefined
		H.getTokenBalances
			.mockImplementationOnce(
				() =>
					new Promise((_resolve, rej) => {
						rejectFirst = rej
					}),
			)
			.mockResolvedValue([row(1, "A"), row(2, "B")])
		const wrapper = mount(SelectTokenPopup, { props: { show: false }, global: { stubs: STUBS } })
		await wrapper.setProps({ show: true })
		await flushPromises()
		// The load's own connect.
		H.balanceConnected.emit()
		await flushPromises()
		expect(H.getTokenBalances).toHaveBeenCalledTimes(1)

		// The client rejects the pending request and reconnects synchronously, before the rejection settles.
		rejectFirst?.(new Error("port closed"))
		H.balanceConnected.emit()
		await flushPromises()
		expect(H.getTokenBalances).toHaveBeenCalledTimes(2)
		expect(wrapper.find('[data-testid="select-token-error"]').exists()).toBe(false)
		expect(rowSymbols(wrapper)).toEqual(["A", "B"])

		// A hide resets the count: the next show's first connect is again its own.
		await wrapper.setProps({ show: false })
		await wrapper.setProps({ show: true })
		await flushPromises()
		H.balanceConnected.emit()
		await flushPromises()
		expect(H.getTokenBalances).toHaveBeenCalledTimes(3)
	})

	test("hiding clears the list and query and disconnects the balance client; unmount tears down prices", async () => {
		const wrapper = await mountOpen([row(1, "A"), row(2, "B"), row(3, "C"), row(4, "D")])
		await wrapper.find('[data-testid="select-token-search"]').setValue("a")
		await wrapper.setProps({ show: false })
		expect(H.balanceDisconnect).toHaveBeenCalledTimes(1)
		expect(H.priceDisconnect).not.toHaveBeenCalled()

		// Re-open: the list is fetched fresh and the query is gone.
		H.getTokenBalances.mockResolvedValue([row(1, "A"), row(2, "B"), row(3, "C"), row(4, "D")])
		await wrapper.setProps({ show: true })
		await flushPromises()
		expect(rowSymbols(wrapper)).toEqual(["A", "B", "C", "D"])
		expect((wrapper.find('[data-testid="select-token-search"]').element as HTMLInputElement).value).toBe("")

		wrapper.unmount()
		expect(H.priceDisconnect).toHaveBeenCalledTimes(1)
	})

	test("a balance added or updated while open counts only when it belongs to the active scope", async () => {
		const wrapper = await mountOpen([row(1, "A")])
		H.balanceAdded.emit(row(2, "OTHER_CHAIN", { chainId: MAINNET + 1 }))
		H.balanceAdded.emit(row(3, "OTHER_ACCOUNT", { account: OTHER_ACCOUNT }))
		H.balanceAdded.emit(row(4, "MINE"))
		H.balanceUpdated.emit({ ...row(1, "A"), token: { ...row(1, "A").token, symbol: "A2" }, account: OTHER_ACCOUNT })
		await nextTick()
		expect(rowSymbols(wrapper)).toEqual(["A", "MINE"])
	})
})
