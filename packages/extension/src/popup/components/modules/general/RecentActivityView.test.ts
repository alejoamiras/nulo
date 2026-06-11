/**
 * P12 test pin: RecentActivityView calls
 * `IncomingTransferServiceClient.prototype.connect` on mount. Closes
 * codex Low #2 (the prior arc's post-impl audit) — "the explicit
 * connect path is the exact glue that already broke once" — without
 * mounting the full 700+ LoC RecentActivityView component.
 *
 * Scope: just the connect call. The widget's rendering, row merge,
 * triple-key dedup, etc. are tested via the parent arcs' suites.
 */

import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// ── Service-client mocks ─────────────────────────────────────────────

const incomingTransferConnect = vi.fn().mockResolvedValue(undefined)
const configConnect = vi.fn().mockResolvedValue(undefined)
const noopEvent = { add: vi.fn(), remove: vi.fn() }

vi.mock("@/wallet/services/incoming-transfer/client", () => ({
	IncomingTransferServiceClient: vi.fn(() => ({
		connect: incomingTransferConnect,
		disconnect: vi.fn(),
		onIncomingTransferAdded: noopEvent,
		onIncomingTransferUpdated: noopEvent,
		onIncomingTransferDeleted: noopEvent,
		onConnected: noopEvent,
		getIncomingTransfers: vi.fn().mockResolvedValue([]),
	})),
}))

vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(() => ({
		connect: configConnect,
		disconnect: vi.fn(),
		onUpdate: noopEvent,
		getValue: vi.fn().mockResolvedValue(true),
	})),
}))

vi.mock("@/wallet/services/task/client", () => ({
	TaskServiceClient: vi.fn(() => ({
		disconnect: vi.fn(),
		onTaskCreated: noopEvent,
		onTaskUpdated: noopEvent,
		onTaskDeleted: noopEvent,
		getTasks: vi.fn().mockResolvedValue([]),
	})),
}))

vi.mock("@/wallet/services/operation-journal/client", () => ({
	OperationJournalServiceClient: vi.fn(() => ({
		disconnect: vi.fn(),
		onConnected: noopEvent,
		onOperationAdded: noopEvent,
		onOperationUpdated: noopEvent,
		onOperationDeleted: noopEvent,
		getOperations: vi.fn().mockResolvedValue([]),
	})),
}))

vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(() => ({
		disconnect: vi.fn(),
		cancelOperation: vi.fn().mockResolvedValue(undefined),
	})),
}))

vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(() => ({
		disconnect: vi.fn(),
		getTokens: vi.fn().mockResolvedValue([]),
		onTokenAdded: { add: vi.fn(), remove: vi.fn() },
	})),
}))

vi.mock("@/wallet/services/task/spec", () => ({
	ContentKind: { Step: 0, BalanceUpdate: 1, TokenMint: 2, ExecuteOperation: 3, Transfer: 4, RevokeAuthwits: 5 },
	TaskStatus: { Pending: 0, Processing: 1, Finished: 2 },
}))

vi.mock("@/wallet/services/transaction/spec", () => ({
	OriginType: { UI: 0, DAPP: 1 },
}))

// ── Store mocks ──────────────────────────────────────────────────────

vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({
		profile: { id: "p1" },
		network: { id: "net-1", chainId: 1 },
		account: { address: "0xacct" },
		transactions: [],
		awaitingTransactions: [],
	}),
}))

vi.mock("vue-router", async (importOriginal) => {
	const mod = await importOriginal<typeof import("vue-router")>()
	return {
		...mod,
		useRouter: () => ({ push: vi.fn() }),
	}
})

// ── Test ─────────────────────────────────────────────────────────────

import RecentActivityView from "./RecentActivityView.vue"

beforeEach(() => {
	incomingTransferConnect.mockClear()
	configConnect.mockClear()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("RecentActivityView — service-client wiring", () => {
	test("calls IncomingTransferServiceClient.connect() on mount", async () => {
		mount(RecentActivityView, { shallow: true })
		await flushPromises()
		expect(incomingTransferConnect).toHaveBeenCalledTimes(1)
	})
	test("calls ConfigServiceClient.connect() on mount (sibling explicit-connect path)", async () => {
		mount(RecentActivityView, { shallow: true })
		await flushPromises()
		expect(configConnect).toHaveBeenCalledTimes(1)
	})
})
