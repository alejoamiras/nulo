/**
 * History hands the arrival coordinator its reads and its rendered receipts: the list's rows are
 * assigned only under a loaded arrival state, each incoming row is judged by the injected
 * `isArriving`, and the incoming rows are presented after the render that showed them.
 */
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ref } from "vue"

import { createAppStoreHarness } from "../../../tests/helpers/app-store-harness"

const H = vi.hoisted(() => {
	const event = () => ({ add: () => {}, remove: () => {} })
	return {
		event,
		getIncomingTransfers: vi.fn(),
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
			getOperations: vi.fn().mockResolvedValue([]),
		}
	}),
}))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), onTokenAdded: H.event(), getTokens: vi.fn().mockResolvedValue([]) }
	}),
}))
vi.mock("@/wallet/services/incoming-transfer/client", () => ({
	IncomingTransferServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onIncomingTransferAdded: H.event(),
			onIncomingTransferUpdated: H.event(),
			onIncomingTransferDeleted: H.event(),
			onConnected: H.event(),
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
		return { disconnect: vi.fn(), onQuotesUpdated: H.event() }
	}),
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => H.store.current }))

import { ARRIVALS_KEY } from "@/composables/useArrivals"
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
