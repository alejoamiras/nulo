/**
 * RecentActivityView component tests.
 *
 * Two concerns:
 *  1. Service-client wiring — the widget calls `IncomingTransferServiceClient`
 *     + `ConfigServiceClient` `.connect()` on mount (closes a prior-arc codex
 *     Low: "the explicit connect path is the exact glue that already broke once").
 *  2. Account-switch containment (Layer A, drop-only — account-switch-isolation
 *     plan §Phase 1). Asserted at the STATE level via `defineExpose`d refs, not
 *     just render: a render guard alone can mask a containment gap, so the switch
 *     reset + the captured-account guards are checked on `journalOps` /
 *     `executingTask` / `recentActivityRows` directly.
 *
 * Drives switches with the reactive `app-store-harness` (the widget captures the
 * store ref once at setup, so tests MUTATE the same reactive instance rather than
 * swapping it).
 */

import { flushPromises, mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { createAppStoreHarness } from "../../../../../tests/helpers/app-store-harness"

// ── Controllable mock surface (hoisted so vi.mock factories can read it) ──────
const H = vi.hoisted(() => {
	const makeEvent = () => {
		const handlers = new Set<(x?: unknown) => void>()
		return {
			add: (fn: (x?: unknown) => void) => handlers.add(fn),
			remove: (fn: (x?: unknown) => void) => handlers.delete(fn),
			emit: (x?: unknown) => {
				for (const fn of [...handlers]) fn(x)
			},
			handlers,
		}
	}
	return {
		makeEvent,
		// enum shapes shared by the service-spec mocks AND the fixtures below
		ContentKind: { Step: 0, BalanceUpdate: 1, TokenMint: 2, ExecuteOperation: 3, Transfer: 4, RevokeAuthwits: 5 },
		TaskStatus: { Pending: 0, Processing: 1, Finished: 2 },
		OriginType: { UI: 0, DAPP: 1 },
		TxStatus: { Pending: 0, Dropped: 1, Proposed: 2, Checkpointed: 3, Proven: 4, Finalized: 5 },
		// per-call-controllable data fns
		getOperations: vi.fn(),
		getTasks: vi.fn(),
		getIncomingTransfers: vi.fn(),
		incomingConnect: vi.fn(),
		configConnect: vi.fn(),
		// event emitters (the mocked clients don't fire them; tests emit explicitly)
		journalAdded: makeEvent(),
		journalUpdated: makeEvent(),
		journalDeleted: makeEvent(),
		journalConnected: makeEvent(),
		incomingAdded: makeEvent(),
		incomingUpdated: makeEvent(),
		incomingDeleted: makeEvent(),
		incomingConnected: makeEvent(),
		configUpdate: makeEvent(),
		taskCreated: makeEvent(),
		taskUpdated: makeEvent(),
		taskDeleted: makeEvent(),
		tokenAdded: makeEvent(),
		// mutable reactive-store holder (set in beforeEach)
		store: { current: null as unknown as ReturnType<typeof createAppStoreHarness> },
	}
})

// ── Service-client mocks ──────────────────────────────────────────────────────

vi.mock("@/wallet/services/incoming-transfer/client", () => ({
	IncomingTransferServiceClient: vi.fn(function () {
		return {
			connect: H.incomingConnect,
			disconnect: vi.fn(),
			onIncomingTransferAdded: H.incomingAdded,
			onIncomingTransferUpdated: H.incomingUpdated,
			onIncomingTransferDeleted: H.incomingDeleted,
			onConnected: H.incomingConnected,
			getIncomingTransfers: H.getIncomingTransfers,
		}
	}),
}))

vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return {
			connect: H.configConnect,
			disconnect: vi.fn(),
			onUpdate: H.configUpdate,
			getValue: vi.fn().mockResolvedValue(true),
		}
	}),
}))

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

vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			cancelJob: vi.fn().mockResolvedValue(undefined),
		}
	}),
}))

vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			getTokens: vi.fn().mockResolvedValue([]),
			onTokenAdded: H.tokenAdded,
		}
	}),
}))

vi.mock("@/wallet/services/task/spec", () => ({
	ContentKind: H.ContentKind,
	TaskStatus: H.TaskStatus,
}))

vi.mock("@/wallet/services/transaction/spec", () => ({
	OriginType: H.OriginType,
	TxStatus: H.TxStatus,
}))

// ── Store mock — reactive harness, mutated per test to drive switches ─────────

vi.mock("@/stores/app.store", () => ({ useAppStore: () => H.store.current }))

vi.mock("vue-router", async (importOriginal) => {
	const mod = await importOriginal<typeof import("vue-router")>()
	return { ...mod, useRouter: () => ({ push: vi.fn() }) }
})

// ── Fixtures + helpers ────────────────────────────────────────────────────────

import RecentActivityView from "./RecentActivityView.vue"

const ACCT_A = "0xacct" // matches the harness default active account
const ACCT_B = "0xB"
const ACCT_FOREIGN = "0xOTHER"

function deferred<T>() {
	let resolve!: (v: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

const inFlightTransferOp = (account: string, id = "op-a") => ({
	id,
	accountAddress: account,
	networkId: "net-1",
	kind: "transfer",
	terminalAt: null,
	createdAt: 1,
	progress: { stage: "proving" },
})

const uiTransferTask = (sender: string, id = "task-a") => ({
	id,
	createdAt: 1,
	content: { kind: H.ContentKind.Transfer, senderAddress: sender, tokenId: undefined },
	origin: { type: H.OriginType.UI },
	subtasks: [],
})

const dappExecuteTask = (id = "task-dapp") => ({
	id,
	createdAt: 1,
	content: { kind: H.ContentKind.ExecuteOperation, operationKind: "send_transaction" },
	origin: { type: H.OriginType.DAPP },
	subtasks: [],
})

/** dApp ExecuteOperation task carrying the Phase-1a preallocated correlationId. */
const dappExecuteTaskCorrelated = (correlationId: string, id = "task-dapp") => ({
	id,
	correlationId,
	createdAt: 1,
	content: { kind: H.ContentKind.ExecuteOperation, operationKind: "send_transaction" },
	origin: { type: H.OriginType.DAPP },
	subtasks: [],
})

/** In-flight dapp_execute journal record (the durable card the task binds to).
 *  Carries the full composite scope (profileId + networkId + accountAddress) so
 *  the STRICT publication gate (BLOCKER-2) can resolve it. */
const inFlightDappOp = (account: string, correlationId: string, over: Record<string, unknown> = {}) => ({
	id: "op-dapp",
	profileId: "p1",
	accountAddress: account,
	networkId: "net-1",
	kind: "dapp_execute",
	terminalAt: null,
	createdAt: 1,
	correlationId,
	title: "swap_tokens",
	subtitle: "example.com",
	progress: { stage: "proving" },
	...over,
})

/** A non-feed internal task (balance refresh): must be exempt from the gate. */
const balanceTask = (id = "task-balance") => ({
	id,
	createdAt: 1,
	content: { kind: H.ContentKind.BalanceUpdate, account: ACCT_A, tbId: 1 },
	origin: { type: H.OriginType.UI },
	subtasks: [],
})

const incomingRecord = (over: Record<string, unknown>) => ({
	accountAddress: ACCT_A,
	networkId: "net-1",
	tokenId: undefined,
	amountRaw: "1",
	txHash: "0xh",
	discoveredAt: 1000,
	...over,
})

const mountView = () => mount(RecentActivityView, { shallow: true })

// biome-ignore lint/suspicious/noExplicitAny: JS SFC exposes untyped refs via defineExpose.
const vmOf = (wrapper: ReturnType<typeof mountView>) => wrapper.vm as any

beforeEach(() => {
	H.getOperations.mockReset().mockResolvedValue([])
	H.getTasks.mockReset().mockResolvedValue([])
	H.getIncomingTransfers.mockReset().mockResolvedValue([])
	H.incomingConnect.mockReset().mockResolvedValue(undefined)
	H.configConnect.mockReset().mockResolvedValue(undefined)
	for (const ev of [
		H.journalAdded,
		H.journalUpdated,
		H.journalDeleted,
		H.journalConnected,
		H.incomingAdded,
		H.incomingUpdated,
		H.incomingDeleted,
		H.incomingConnected,
		H.configUpdate,
		H.taskCreated,
		H.taskUpdated,
		H.taskDeleted,
		H.tokenAdded,
	]) {
		ev.handlers.clear()
	}
	H.store.current = createAppStoreHarness()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RecentActivityView — service-client wiring", () => {
	test("calls IncomingTransferServiceClient.connect() on mount", async () => {
		mountView()
		await flushPromises()
		expect(H.incomingConnect).toHaveBeenCalledTimes(1)
	})
	test("calls ConfigServiceClient.connect() on mount (sibling explicit-connect path)", async () => {
		mountView()
		await flushPromises()
		expect(H.configConnect).toHaveBeenCalledTimes(1)
	})
})

describe("RecentActivityView — account-switch containment (Layer A)", () => {
	test("switching account synchronously clears journalOps + executingTask + subtasks", async () => {
		H.getOperations.mockResolvedValueOnce([inFlightTransferOp(ACCT_A)])
		H.getTasks.mockResolvedValueOnce([uiTransferTask(ACCT_A)])
		// The post-switch reload never resolves, so ONLY the synchronous
		// (flush:'sync') reset watcher can empty the refs — proving the clear
		// rather than the reload.
		H.getOperations.mockImplementation(() => new Promise(() => {}))
		H.getTasks.mockImplementation(() => new Promise(() => {}))

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.journalOps).toHaveLength(1)
		expect(vm.executingTask).not.toBeNull()

		H.store.current.account = { address: ACCT_B }
		// Assert SYNCHRONOUSLY (no tick) — the flush:'sync' reset watcher must have
		// cleared before B can paint; a default (post-nextTick) watcher would fail here.
		expect(vm.journalOps).toEqual([])
		expect(vm.executingTask).toBeNull()
		expect(vm.executingSubtasks).toEqual([])
		await nextTick()
		expect(vm.journalOps).toEqual([]) // reload is pending → stays cleared
	})

	test("drops a late getOperations resolving for the previous account after a switch", async () => {
		const opsA = deferred<unknown[]>()
		H.getOperations.mockReturnValueOnce(opsA.promise) // mount fetch for A (stays pending)
		H.getOperations.mockResolvedValue([]) // post-switch reload fetch for B

		const wrapper = mountView()
		await flushPromises() // onMounted suspends awaiting A's getOperations (captured = A)
		const vm = vmOf(wrapper)

		H.store.current.account = { address: ACCT_B } // switch → sync clear + B reload ([])
		await flushPromises()
		expect(vm.journalOps).toEqual([])

		opsA.resolve([inFlightTransferOp(ACCT_A)]) // A's mount fetch resolves LATE, under B
		await flushPromises()
		expect(vm.journalOps).toEqual([]) // captured-account guard dropped the stale A snapshot
	})

	test("fails closed on a dApp (uncorrelated) executingTask — no orphan card", async () => {
		H.getTasks.mockResolvedValue([dappExecuteTask()])

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.executingTask).toBeNull()
		expect(vm.hasOrphanExecutingTask).toBe(false)
	})

	test("does not surface a foreign-account UI transfer executingTask", async () => {
		H.getTasks.mockResolvedValue([uiTransferTask(ACCT_FOREIGN)])

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.executingTask).toBeNull()
		expect(vm.hasOrphanExecutingTask).toBe(false)
	})

	test("still surfaces the active account's own UI transfer as an orphan card (positive control)", async () => {
		H.getTasks.mockResolvedValue([uiTransferTask(ACCT_A)])
		H.getOperations.mockResolvedValue([]) // no matching journal record → orphan

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.executingTask).not.toBeNull()
		expect(vm.hasOrphanExecutingTask).toBe(true)
	})

	test("excludes foreign-account + foreign-network incoming rows from recentActivityRows", async () => {
		H.getIncomingTransfers.mockResolvedValue([
			incomingRecord({ accountAddress: ACCT_A, networkId: "net-1", siloedNullifier: "sn-active", discoveredAt: 2000 }),
			incomingRecord({ accountAddress: ACCT_FOREIGN, networkId: "net-1", siloedNullifier: "sn-foreign-acct", discoveredAt: 1000 }),
			incomingRecord({ accountAddress: ACCT_A, networkId: "net-OTHER", siloedNullifier: "sn-foreign-net", discoveredAt: 1500 }),
		])

		const wrapper = mountView()
		await flushPromises()
		// The mocked connect() doesn't fire onConnected, so emit it to drive the
		// composable's refresh (which assigns the raw service snapshot verbatim —
		// the inline recentActivityRows filter is what must drop the foreign rows).
		H.incomingConnected.emit()
		await flushPromises()

		const vm = vmOf(wrapper)
		const incoming = vm.recentActivityRows.filter((r: { type: string }) => r.type === "incoming")
		expect(incoming.map((r: { inc: { siloedNullifier: string } }) => r.inc.siloedNullifier)).toEqual(["sn-active"])
	})
})

// biome-ignore lint/suspicious/noExplicitAny: JS SFC exposes untyped refs via defineExpose.
const renderedIds = (vm: any) => vm.renderedInFlightOps.map((o: { id: string }) => o.id)

describe("RecentActivityView — dApp task↔journal correlation gate (Phase 1a)", () => {
	test("correlated dApp task for the ACTIVE account is published AND its journal card renders", async () => {
		H.getOperations.mockResolvedValue([inFlightDappOp(ACCT_A, "cid-1")])
		H.getTasks.mockResolvedValue([dappExecuteTaskCorrelated("cid-1")])

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		// Captured (carries a correlationId) AND published (resolves to an in-scope journal).
		expect(vm.rawExecutingTask).not.toBeNull()
		expect(vm.executingTask).not.toBeNull()
		// The durable journal record renders the in-flight card.
		expect(renderedIds(vm)).toContain("op-dapp")
	})

	test("the SAME dApp task whose journal is a FOREIGN account is NOT published and renders no card", async () => {
		H.getOperations.mockResolvedValue([inFlightDappOp(ACCT_FOREIGN, "cid-1")])
		H.getTasks.mockResolvedValue([dappExecuteTaskCorrelated("cid-1")])

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		// Task is captured (cid present) but the correlating journal is out of the
		// active scope → fail-closed: not published, and no foreign card renders.
		expect(vm.rawExecutingTask).not.toBeNull()
		expect(vm.executingTask).toBeNull()
		expect(vm.hasOrphanExecutingTask).toBe(false)
		expect(renderedIds(vm)).not.toContain("op-dapp")
	})

	test("a dApp task whose correlationId resolves to NO journal is not published (fail-closed, no orphan)", async () => {
		H.getOperations.mockResolvedValue([]) // no journal to correlate against
		H.getTasks.mockResolvedValue([dappExecuteTaskCorrelated("cid-orphan")])

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.rawExecutingTask).not.toBeNull()
		expect(vm.executingTask).toBeNull()
		expect(vm.hasOrphanExecutingTask).toBe(false)
	})

	test("REACTIVE publication: task captured before its journal, publishes the instant the matching journal arrives", async () => {
		H.getOperations.mockResolvedValue([]) // journal not created yet at mount
		H.getTasks.mockResolvedValue([dappExecuteTaskCorrelated("cid-late")])

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.executingTask).toBeNull() // captured, not yet correlated

		// The journal record is created/stamped later (the real ordering: task
		// event precedes the journal event) with the matching correlationId.
		H.journalAdded.emit(inFlightDappOp(ACCT_A, "cid-late"))
		await nextTick()
		expect(vm.executingTask).not.toBeNull() // published reactively — no re-trigger needed
		expect(renderedIds(vm)).toContain("op-dapp")
	})

	test("a terminal correlated journal un-publishes the task (op finished → not in-flight)", async () => {
		H.getOperations.mockResolvedValue([inFlightDappOp(ACCT_A, "cid-term", { terminalAt: 123, progress: { stage: "succeeded" } })])
		H.getTasks.mockResolvedValue([dappExecuteTaskCorrelated("cid-term")])

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.executingTask).toBeNull() // terminal journal → not feed-eligible
	})

	test("SW-restart: journal survives (correlationId durable) with NO task — card renders, no enrichment, no leak", async () => {
		H.getOperations.mockResolvedValue([inFlightDappOp(ACCT_A, "cid-restart")])
		H.getTasks.mockResolvedValue([]) // in-memory TaskService cleared on SW restart

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.rawExecutingTask).toBeNull() // no task to re-link
		expect(vm.executingTask).toBeNull() // no enrichment
		expect(renderedIds(vm)).toContain("op-dapp") // durable journal still renders the card
	})

	test("a non-feed internal task (balance refresh) is exempt — never captured, never gated", async () => {
		H.getTasks.mockResolvedValue([balanceTask()])
		H.getOperations.mockResolvedValue([])

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.rawExecutingTask).toBeNull()
		expect(vm.executingTask).toBeNull()
		expect(vm.hasOrphanExecutingTask).toBe(false)
	})

	test("switch away un-publishes a correlated dApp task synchronously (journalOps sync-cleared)", async () => {
		H.getOperations.mockResolvedValueOnce([inFlightDappOp(ACCT_A, "cid-switch")])
		H.getTasks.mockResolvedValueOnce([dappExecuteTaskCorrelated("cid-switch")])
		// Post-switch reload never resolves — only the sync reset can un-publish.
		H.getOperations.mockImplementation(() => new Promise(() => {}))
		H.getTasks.mockImplementation(() => new Promise(() => {}))

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.executingTask).not.toBeNull()

		H.store.current.account = { address: ACCT_B }
		// Synchronous: journalOps cleared + rawExecutingTask cleared by the flush:'sync'
		// watcher → the gated computed collapses to null before B can paint.
		expect(vm.executingTask).toBeNull()
		expect(renderedIds(vm)).not.toContain("op-dapp")
	})
})

describe("RecentActivityView — STRICT publication scope (Phase 1a BLOCKER-2)", () => {
	test("a correlated journal missing networkId is NOT published (strict fail-closed on undefined)", async () => {
		H.getOperations.mockResolvedValue([inFlightDappOp(ACCT_A, "cid-noNet", { networkId: undefined })])
		H.getTasks.mockResolvedValue([dappExecuteTaskCorrelated("cid-noNet")])

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		// Strict gate requires networkId present + equal — undefined = out of scope.
		expect(vm.rawExecutingTask).not.toBeNull() // captured (cid present)
		expect(vm.executingTask).toBeNull() // NOT published
	})

	test("a correlated journal from a FOREIGN profile is NOT published (strict profileId gate)", async () => {
		H.getOperations.mockResolvedValue([inFlightDappOp(ACCT_A, "cid-foreignProfile", { profileId: "p-OTHER" })])
		H.getTasks.mockResolvedValue([dappExecuteTaskCorrelated("cid-foreignProfile")])

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.executingTask).toBeNull() // foreign profile → fail-closed
	})

	test("a correlated journal on a FOREIGN network is NOT published (strict networkId gate)", async () => {
		H.getOperations.mockResolvedValue([inFlightDappOp(ACCT_A, "cid-foreignNet", { networkId: "net-OTHER" })])
		H.getTasks.mockResolvedValue([dappExecuteTaskCorrelated("cid-foreignNet")])

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.executingTask).toBeNull()
	})

	test("a NETWORK switch onto the SAME account address resets + un-publishes (composite-scope watcher)", async () => {
		H.getOperations.mockResolvedValueOnce([inFlightDappOp(ACCT_A, "cid-netswitch")])
		H.getTasks.mockResolvedValueOnce([dappExecuteTaskCorrelated("cid-netswitch")])
		H.getOperations.mockImplementation(() => new Promise(() => {})) // post-switch reload hangs
		H.getTasks.mockImplementation(() => new Promise(() => {}))

		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.executingTask).not.toBeNull()

		// Same account address, DIFFERENT network — account-only keying would have
		// missed this; the composite-scope watcher must reset synchronously.
		H.store.current.network = { id: "net-2", chainId: 2 }
		expect(vm.journalOps).toEqual([])
		expect(vm.executingTask).toBeNull()
		expect(renderedIds(vm)).not.toContain("op-dapp")
	})
})
