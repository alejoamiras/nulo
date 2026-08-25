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
		getTokens: vi.fn(),
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
			getTokens: H.getTokens,
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

const incomingRecord = (over: Record<string, unknown>) => ({
	// Discriminated-union NOTE record: `kind` is required (resolveReceivedType, called during the card
	// render, early-returns on it — without it a note falls into the public branch and dereferences the
	// absent `from`), and `id` is the row key.
	kind: "note",
	id: `note:p1|net-1|${(over.siloedNullifier as string) ?? "sn"}`,
	profileId: "p1",
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
	H.getTokens.mockReset().mockResolvedValue([])
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

describe("RecentActivityView — scope-triple containment (N-23)", () => {
	test("a SAME-ADDRESS profile switch resets + reloads (the address-only key no-oped here)", async () => {
		H.getTasks.mockResolvedValue([uiTransferTask(ACCT_A)])
		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.executingTask).toBeTruthy()

		H.getTasks.mockResolvedValue([]) // the new profile's world is empty
		H.store.current.profile = { id: "p2" } // same address, new profile
		await nextTick()
		expect(vm.executingTask).toBeNull() // sync clear fired despite identical address
		await flushPromises()
		expect(vm.executingTask).toBeNull() // reload found nothing to resurrect
	})

	test("a SAME-ADDRESS network switch does not re-accept the old network's transfer task", async () => {
		const taskOnNet1 = {
			...uiTransferTask(ACCT_A),
			content: { kind: H.ContentKind.Transfer, senderAddress: ACCT_A, tokenId: undefined, networkId: "net-1" },
		}
		H.getTasks.mockResolvedValue([taskOnNet1])
		const wrapper = mountView()
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.executingTask).toBeTruthy()

		// TaskService clears on PROFILE change only — the old-network task is
		// still returned; the networkId comparison is what must drop it.
		H.store.current.network = { id: "net-2", chainId: 2 }
		await nextTick()
		expect(vm.executingTask).toBeNull()
		await flushPromises()
		expect(vm.executingTask).toBeNull() // not re-accepted from the reload
	})

	test("a deferred OLD-scope token fetch cannot overwrite the new scope's map", async () => {
		const slow = deferred<Array<{ id: number; symbol: string }>>()
		H.getTokens.mockReturnValueOnce(slow.promise) // mount's load (old scope) parks
		const wrapper = mountView()
		await flushPromises()

		H.getTokens.mockResolvedValue([{ id: 2, symbol: "FRESH" }])
		H.store.current.profile = { id: "p2" } // switch → sync clear + fenced reload
		await nextTick()
		await flushPromises()
		slow.resolve([{ id: 9, symbol: "STALE" }]) // the OLD run resumes last
		await flushPromises()

		const vm = vmOf(wrapper)
		expect(vm.tokens.map((t: { symbol: string }) => t.symbol)).toEqual(["FRESH"])
	})

	test("collapse: a missing scope part clears state and fires NO reload RPCs", async () => {
		const wrapper = mountView()
		await flushPromises()
		H.getOperations.mockClear()
		H.getTasks.mockClear()

		H.store.current.network = null // scope collapses to ""
		await nextTick()
		await flushPromises()
		expect(H.getOperations).not.toHaveBeenCalled()
		expect(H.getTasks).not.toHaveBeenCalled()
		const vm = vmOf(wrapper)
		expect(vm.journalOps).toEqual([])
		expect(vm.executingTask).toBeNull()
	})

	test("ABA: an A→B→A round-trip does not let A's stale first-run snapshot land", async () => {
		const slowOps = deferred<Array<ReturnType<typeof inFlightTransferOp>>>()
		H.getOperations.mockReturnValueOnce(slowOps.promise) // A's mount snapshot parks
		const wrapper = mountView()
		await flushPromises()

		H.getOperations.mockResolvedValue([]) // B's and the return-A's snapshots are empty
		H.store.current.profile = { id: "p2" } // A→B
		await nextTick()
		H.store.current.profile = { id: "p1" } // B→A (captured-equality would revalidate!)
		await nextTick()
		await flushPromises()

		slowOps.resolve([inFlightTransferOp(ACCT_A, "op-stale")]) // A's ORIGINAL run resumes
		await flushPromises()
		const vm = vmOf(wrapper)
		expect(vm.journalOps.map((o: { id: string }) => o.id)).not.toContain("op-stale")
	})
})
