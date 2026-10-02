/**
 * History hands the arrival coordinator its reads and its rendered receipts: the list's rows are
 * assigned only under a loaded arrival state, each incoming row is judged by the injected
 * `isArriving`, and the incoming rows are presented after the render that showed them. Its received
 * rows resolve their token for the current profile and network, however the page was opened.
 */
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ref } from "vue"

import { createAppStoreHarness } from "../../../tests/helpers/app-store-harness"
import { TESTNET_TOKENS } from "@/wallet/services/token/default-tokens"

const H = vi.hoisted(() => {
	const event = () => ({ add: () => {}, remove: () => {} })
	const handlers = new Set<() => void>()
	return {
		event,
		incomingConnected: { add: (fn: () => void) => handlers.add(fn), remove: (fn: () => void) => handlers.delete(fn), handlers },
		getIncomingTransfers: vi.fn(),
		getOperations: vi.fn(),
		getTokens: vi.fn(),
		quotes: {} as Record<string, unknown>,
		store: { current: null as unknown as ReturnType<typeof createAppStoreHarness> },
	}
})

vi.mock("@/wallet/services/transaction/client", () => ({
	TransactionServiceClient: vi.fn(function () {
		return { disconnect: vi.fn() }
	}),
}))
vi.mock("@/wallet/services/operation-journal/client", () => ({
	OperationJournalServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onConnected: H.event(),
			onOperationAdded: H.event(),
			onOperationUpdated: H.event(),
			onOperationDeleted: H.event(),
			getOperations: H.getOperations,
		}
	}),
}))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), onTokenAdded: H.event(), getTokens: H.getTokens }
	}),
}))
vi.mock("@/wallet/services/incoming-transfer/client", () => ({
	IncomingTransferServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onIncomingTransferAdded: H.event(),
			onIncomingTransferUpdated: H.event(),
			onIncomingTransferDeleted: H.event(),
			onConnected: H.incomingConnected,
			getIncomingTransfers: H.getIncomingTransfers,
		}
	}),
}))
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return { connect: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn(), onUpdate: H.event() }
	}),
}))
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), onQuotesUpdated: H.event(), onConnected: H.event(), refreshIfStale: async () => H.quotes }
	}),
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => H.store.current }))

import { ARRIVALS_KEY } from "@/composables/useArrivals"
import { CHAIN_IDS } from "@/utils/chain-ids"
import TransactionsList from "../components/modules/activity/TransactionsList.vue"
import Activity from "./activity.vue"

const record = (siloedNullifier: string, discoveredAt: number) => ({
	kind: "note",
	id: `note:p1|net-1|${siloedNullifier}`,
	profileId: "p1",
	accountAddress: "0xacct",
	networkId: "net-1",
	tokenId: undefined,
	amountRaw: "1",
	txHash: "0xh",
	discoveredAt,
})

beforeEach(() => {
	H.getIncomingTransfers.mockReset().mockResolvedValue([])
	H.getOperations.mockReset().mockResolvedValue([])
	H.getTokens.mockReset().mockResolvedValue([])
	H.incomingConnected.handlers.clear()
	H.quotes = {}
	H.store.current = createAppStoreHarness()
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			disconnect() {}
		},
	)
})
afterEach(() => {
	vi.unstubAllGlobals()
})

describe("pages/activity — arrivals", () => {
	test("the receipts paint only under a loaded arrival state, the list judges each one, and they are presented", async () => {
		const first = record("a", 2000)
		const second = record("b", 1000)
		H.getIncomingTransfers.mockResolvedValue([first, second])
		let finishLoad = () => {}
		const arrivals = {
			isArriving: vi.fn(),
			present: vi.fn(),
			latest: ref(null),
			load: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						finishLoad = resolve
					}),
			),
		}
		const w = mount(Activity, {
			shallow: true,
			global: {
				stubs: { Flex: { template: "<div><slot /></div>" }, MaterialIcon: true },
				provide: { [ARRIVALS_KEY as symbol]: arrivals },
			},
		})
		await flushPromises()
		expect(arrivals.load).toHaveBeenCalledWith({ profileId: "p1", networkId: "net-1", account: "0xacct" })
		expect(w.findComponent(TransactionsList).exists()).toBe(false)

		finishLoad()
		await flushPromises()
		const list = w.findComponent(TransactionsList)
		expect(list.props("isArriving")).toBe(arrivals.isArriving)
		expect(list.props("rows").map((row: { key: string }) => row.key)).toEqual([`incoming:${first.id}`, `incoming:${second.id}`])
		expect(arrivals.present).toHaveBeenLastCalledWith([first, second])
	})
})

describe("pages/activity — the received row's token", () => {
	const TEST_USDC = TESTNET_TOKENS.USDC
	const TESTNET = { id: "net-1", chainId: CHAIN_IDS.TESTNET }
	const TST = { id: 7, chainId: CHAIN_IDS.TESTNET, contract: TEST_USDC, name: "Test", symbol: "TST", decimals: 18 }
	const USDC_QUOTE = { "usd-coin": { coingeckoId: "usd-coin", usd: 1, fetchedAt: Date.now(), providerUpdatedAt: null } }
	const receipt = (over: Record<string, unknown> = {}) => ({
		...record("r", 1000),
		tokenId: TST.id,
		contract: TEST_USDC,
		amountRaw: (1000n * 10n ** 18n).toString(),
		...over,
	})

	const mountHistory = (errorHandler?: (error: unknown) => void) =>
		mount(Activity, {
			global: {
				stubs: {
					Flex: { template: "<div><slot /></div>" },
					MaterialIcon: true,
					TransactionCardLayout: {
						props: ["title", "amount", "amountFiat"],
						template: `<div data-testid="row"><span class="title">{{ title }}</span><span class="amount">{{ amount }}</span><span class="fiat">{{ amountFiat }}</span></div>`,
					},
				},
				config: errorHandler ? { errorHandler } : {},
			},
		})
	const rowOf = (w: ReturnType<typeof mountHistory>) => {
		const row = w.find('[data-testid="row"]')
		expect(row.exists()).toBe(true)
		return { title: row.find(".title").text(), amount: row.find(".amount").text(), fiat: row.find(".fiat").text() }
	}

	test("opened before the network is known: once it is, the row reads the token, +1,000 and its dollar value", async () => {
		H.store.current = createAppStoreHarness({ network: null })
		H.getTokens.mockResolvedValue([TST])
		H.getIncomingTransfers.mockResolvedValue([receipt()])
		H.quotes = USDC_QUOTE
		const w = mountHistory()
		await flushPromises()
		expect(w.find('[data-testid="row"]').exists()).toBe(false)

		H.store.current.network = TESTNET
		await flushPromises()
		expect(rowOf(w)).toEqual({ title: "TST", amount: "+1,000", fiat: "≈ $1,000.00" })
	})

	test("a network switch reloads the token map for the new network", async () => {
		const OTHER = { ...TST, id: 9, contract: "0xother", symbol: "OTH" }
		H.store.current = createAppStoreHarness({ network: TESTNET })
		H.getTokens.mockImplementation(async (_profileId: string, chainId: number) => (chainId === CHAIN_IDS.TESTNET ? [TST] : [OTHER]))
		H.getIncomingTransfers.mockImplementation(async (_profileId: string, networkId: string) =>
			networkId === "net-1" ? [receipt()] : [receipt({ id: "note:p1|net-2|o", networkId: "net-2", tokenId: 9, contract: "0xother" })],
		)
		const w = mountHistory()
		await flushPromises()
		expect(rowOf(w).title).toBe("TST")

		H.store.current.network = { id: "net-2", chainId: 2 }
		await flushPromises()
		expect(H.getTokens).toHaveBeenLastCalledWith("p1", 2)
		expect(rowOf(w).title).toBe("OTH")
	})

	test("on the local network, whose chain id is 0, the row still resolves its token", async () => {
		H.store.current = createAppStoreHarness({ network: { id: "net-1", chainId: CHAIN_IDS.SANDBOX } })
		H.getTokens.mockResolvedValue([TST])
		H.getIncomingTransfers.mockResolvedValue([receipt()])
		const w = mountHistory()
		await flushPromises()
		expect(H.getTokens).toHaveBeenCalledWith("p1", CHAIN_IDS.SANDBOX)
		expect(rowOf(w)).toMatchObject({ title: "TST", amount: "+1,000" })
	})

	test("a journal read that rejects at mount does not hold back the row's token", async () => {
		const errorHandler = vi.fn()
		H.store.current = createAppStoreHarness({ network: TESTNET })
		H.getOperations.mockRejectedValue(new Error("port cannot open"))
		H.getTokens.mockResolvedValue([TST])
		H.getIncomingTransfers.mockResolvedValue([receipt()])
		H.quotes = USDC_QUOTE
		const w = mountHistory(errorHandler)
		await flushPromises()
		for (const read of [...H.incomingConnected.handlers]) read()
		await flushPromises()

		expect(errorHandler).toHaveBeenCalledWith(
			expect.objectContaining({ message: "port cannot open" }),
			expect.anything(),
			expect.anything(),
		)
		expect(rowOf(w)).toEqual({ title: "TST", amount: "+1,000", fiat: "≈ $1,000.00" })
	})
})
