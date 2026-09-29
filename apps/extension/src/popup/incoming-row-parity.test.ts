/**
 * Home and History draw a received row from the one shared builder. Its output is replaced by a
 * sentinel here, so a page that formats the row itself, or looks the token up on its own, renders
 * something else and fails.
 */
import { flushPromises, mount } from "@vue/test-utils"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { createMemoryHistory, createRouter } from "vue-router"

import { createAppStoreHarness } from "../../tests/helpers/app-store-harness"

const H = vi.hoisted(() => {
	const event = () => {
		const handlers = new Set<() => void>()
		return { add: (fn: () => void) => handlers.add(fn), remove: (fn: () => void) => handlers.delete(fn), handlers }
	}
	return {
		event,
		incomingConnected: event(),
		sentinel: {
			tokenSymbol: "PARITY-PIN",
			amountRaw: "4242",
			tokenDecimals: 0,
			txHash: "0xparity",
			amountFiat: "≈ $42.42",
			receivedLabel: "Received",
		},
		store: { current: null as unknown as ReturnType<typeof createAppStoreHarness> },
	}
})

vi.mock("@/utils/received-display", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/utils/received-display")>()),
	buildIncomingCardProps: () => H.sentinel,
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => H.store.current }))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), onTokenAdded: H.event(), getTokens: vi.fn().mockResolvedValue([]) }
	}),
}))
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), onQuotesUpdated: H.event(), onConnected: H.event(), refreshIfStale: vi.fn().mockResolvedValue({}) }
	}),
}))
vi.mock("@/wallet/services/incoming-transfer/client", () => ({
	IncomingTransferServiceClient: vi.fn(function () {
		return {
			connect: vi.fn().mockResolvedValue(undefined),
			disconnect: vi.fn(),
			onIncomingTransferAdded: H.event(),
			onIncomingTransferUpdated: H.event(),
			onIncomingTransferDeleted: H.event(),
			onIncomingSyncHealthChanged: H.event(),
			onConnected: H.incomingConnected,
			getIncomingTransfers: vi.fn().mockResolvedValue([receipt]),
			getIncomingSyncHealth: vi.fn().mockResolvedValue({ stalled: false, since: null }),
		}
	}),
}))
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return { connect: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn(), onUpdate: H.event() }
	}),
}))
vi.mock("@/wallet/services/task/client", () => ({
	TaskServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onTaskCreated: H.event(),
			onTaskUpdated: H.event(),
			onTaskDeleted: H.event(),
			getTasks: vi.fn().mockResolvedValue([]),
		}
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
vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return { disconnect: vi.fn() }
	}),
}))
vi.mock("@/wallet/services/dapp-interaction/client", () => ({
	DappInteractionServiceClient: vi.fn(function () {
		return { disconnect: vi.fn() }
	}),
}))

import RecentActivityView from "./components/modules/general/RecentActivityView.vue"
import TransactionsList from "./components/modules/activity/TransactionsList.vue"

const receipt = {
	kind: "note",
	id: "note:p1|net-1|sn",
	profileId: "p1",
	accountAddress: "0xacct",
	networkId: "net-1",
	contract: "0xc",
	tokenId: 1,
	amountRaw: "1000000000000000000000",
	txHash: "0xh",
	discoveredAt: 1000,
}
const TOKENS = [{ id: 1, chainId: 1, contract: "0xc", name: "Test", symbol: "TST", decimals: 18 }]

const STUBS = {
	TransactionIncomingCard: false,
	TransactionCardLayout: {
		props: ["title", "amount", "testId"],
		template: `<div :data-testid="testId"><span class="title">{{ title }}</span><span class="amount">{{ amount }}</span></div>`,
	},
	Flex: { template: "<div><slot /></div>" },
}

const router = () =>
	createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] })

async function mountHome() {
	const w = mount(RecentActivityView, { shallow: true, global: { plugins: [router()], stubs: STUBS } })
	await flushPromises()
	for (const read of [...H.incomingConnected.handlers]) read()
	await flushPromises()
	return w
}

async function mountHistory() {
	const w = mount(TransactionsList, {
		props: { rows: [{ type: "incoming", key: `incoming:${receipt.id}`, sortKey: 1000, inc: receipt }], tokens: TOKENS },
		global: { stubs: STUBS },
	})
	await flushPromises()
	return w
}

beforeEach(() => {
	H.store.current = createAppStoreHarness()
	H.incomingConnected.handlers.clear()
})

describe("a received row on Home and on History", () => {
	test.each([
		["Home", mountHome],
		["History", mountHistory],
	])("%s renders what the shared builder returns", async (_page, mountPage) => {
		const card = (await mountPage()).find('[data-testid="tx-incoming-card"]')
		expect(card.exists()).toBe(true)
		expect(card.find(".title").text()).toBe("PARITY-PIN")
		expect(card.find(".amount").text()).toBe("+4,242")
	})
})
