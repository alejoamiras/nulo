/**
 * The in-flight tracker's guard against a genuinely running send, and its cache lifecycle around
 * a lock. The journal client is a fake whose reads answer on demand, so each case pins the order of
 * events rather than racing them.
 */

import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"

import { useAppStore } from "./app.store"

const { mockGetOperations, journalEvents } = vi.hoisted(() => ({
	mockGetOperations: vi.fn(),
	journalEvents: { added: [] as ((op: unknown) => void)[], updated: [] as ((op: unknown) => void)[] },
}))

vi.mock("@/wallet/services/operation-journal/client", () => ({
	OperationJournalServiceClient: class {
		onOperationAdded = { add: (fn: (op: unknown) => void) => journalEvents.added.push(fn) }
		onOperationUpdated = { add: (fn: (op: unknown) => void) => journalEvents.updated.push(fn) }
		onOperationDeleted = { add: () => {} }
		onConnected = { add: () => {} }
		connect = async () => {}
		disconnect = () => {}
		getOperations = mockGetOperations
	},
}))

/** A send in the viewed scope (`p1` · `0xa` · `n1`), held at `proving` and never advanced. */
const send = (origin: "popup" | "dapp", stage = "proving"): OperationRecord =>
	({
		id: `${origin}-${stage}`,
		kind: origin === "popup" ? "transfer" : "dapp_execute",
		origin,
		profileId: "p1",
		accountAddress: "0xa",
		networkId: "n1",
		progress: { stage },
	}) as unknown as OperationRecord

/** Macrotask flush — lets watchers and settled reads land. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const parkNextRead = () => {
	let resolve!: (rows: OperationRecord[]) => void
	let reject!: (error: unknown) => void
	mockGetOperations.mockReturnValueOnce(
		new Promise<OperationRecord[]>((res, rej) => {
			resolve = res
			reject = rej
		}),
	)
	return { resolve, reject }
}

/** Scope commits, as the popups hand them to the guard: synchronous assignments only. */
const pickAccount = (store: ReturnType<typeof useAppStore>) => () => {
	store.account = { address: "0xb" } as never
}
const pickNetwork = (store: ReturnType<typeof useAppStore>) => () => {
	store.network = { id: "n2", chainId: 2 } as never
}
const pickProfile = (store: ReturnType<typeof useAppStore>) => () => {
	store.profile = { id: "p2" } as never
}

const emitUpdated = (op: OperationRecord) => {
	for (const fn of journalEvents.updated) fn(op)
}

const readsFor = (profileId: string) => mockGetOperations.mock.calls.filter(([query]) => query?.profileId === profileId).length

beforeEach(() => {
	setActivePinia(createPinia())
	mockGetOperations.mockReset()
	journalEvents.added.length = 0
	journalEvents.updated.length = 0
	vi.stubGlobal("managers", { transaction: { getTransactions: vi.fn() } })
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
	;(chrome.storage as any).local = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
	;(chrome.storage as any).onChanged = { addListener: vi.fn(), removeListener: vi.fn() }
})

/** The store viewing `p1` · `0xa` · `n1`, its first journal read answered with `rows`. */
async function viewing(rows: OperationRecord[]) {
	const store = useAppStore()
	mockGetOperations.mockResolvedValueOnce(rows)
	store.profile = { id: "p1" } as never
	store.network = { id: "n1", chainId: 1 } as unknown as Network
	store.account = { address: "0xa" } as unknown as Account
	await flush()
	return store
}

describe("commitScopeChange against a send held at proving", () => {
	test("a dApp's send in the viewed scope admits an account, a network and a profile switch", async () => {
		// Each switch from its own store: the first admitted commit moves the viewed scope off the
		// record, so a shared store would admit the rest for the wrong reason.
		for (const pick of [pickAccount, pickNetwork, pickProfile]) {
			setActivePinia(createPinia())
			mockGetOperations.mockReset()
			const store = await viewing([send("dapp")])
			mockGetOperations.mockResolvedValue([send("dapp")])
			expect(store.hasInFlightSend).toBe(false)
			expect(await store.commitScopeChange(pick(store))).toBe(true)
		}
	})

	test("the popup's own send in the viewed scope refuses each, without asking the journal again", async () => {
		const store = await viewing([send("popup")])
		const before = mockGetOperations.mock.calls.length

		for (const commit of [pickAccount(store), pickNetwork(store), pickProfile(store)]) {
			expect(await store.commitScopeChange(commit)).toBe(false)
		}
		expect(mockGetOperations.mock.calls.length).toBe(before)
		expect(store.profile?.id).toBe("p1")
		expect(store.account?.address).toBe("0xa")
	})
})

describe("the cache across a lock", () => {
	test("resetInFlight empties the rows at once and the lock screen's profile pick is admitted", async () => {
		const store = await viewing([send("popup")])
		expect(store.hasInFlightSend).toBe(true)
		expect(store.approvedSendsInFlight).toBe(1)
		mockGetOperations.mockResolvedValue([]) // the locked worker's answer

		store.resetInFlight()
		expect(store.hasInFlightSend).toBe(false)
		expect(store.approvedSendsInFlight).toBe(0)

		expect(await store.commitScopeChange(pickProfile(store))).toBe(true)
		// The commit's own re-read still runs, for the profile that was locked; the reset only
		// unblocked the cached short-circuit.
		expect(readsFor("p1")).toBe(2)
		expect(store.profile?.id).toBe("p2")
	})

	test("an invalidating refresh closes the guard until it answers, then the next commit refuses", async () => {
		const store = await viewing([])
		expect(store.hasInFlightSend).toBe(false)
		const read = parkNextRead()

		const refreshed = store.refreshInFlight({ invalidate: true })
		expect(store.hasInFlightSend).toBe(true)
		read.resolve([send("popup")])
		await refreshed
		expect(store.hasInFlightSend).toBe(true)
		expect(await store.commitScopeChange(pickAccount(store))).toBe(false)
	})

	test("a plain refresh keeps the guard open while it runs", async () => {
		const store = await viewing([])
		const read = parkNextRead()
		const refreshed = store.refreshInFlight()
		expect(store.hasInFlightSend).toBe(false)
		read.resolve([])
		await refreshed
		expect(store.hasInFlightSend).toBe(false)
	})
})

describe("late reads", () => {
	test("a read issued before the reset cannot put the cancelled rows back", async () => {
		const store = await viewing([send("popup")])
		const late = parkNextRead()
		const pending = store.refreshInFlight()

		store.resetInFlight()
		late.resolve([send("popup")])
		await pending
		expect(store.hasInFlightSend).toBe(false)
		expect(store.approvedSendsInFlight).toBe(0)
	})

	test("a read issued while locked cannot blank what the unlock read found", async () => {
		const store = await viewing([send("popup")])
		store.resetInFlight()
		const locked = parkNextRead()
		const pendingLocked = store.refreshInFlight()

		mockGetOperations.mockResolvedValueOnce([send("popup")])
		await store.refreshInFlight({ invalidate: true })
		expect(store.hasInFlightSend).toBe(true)

		locked.resolve([])
		await pendingLocked
		expect(store.hasInFlightSend).toBe(true)
		expect(store.approvedSendsInFlight).toBe(1)
	})

	test("a late read that rejects changes neither the rows nor the readiness", async () => {
		const store = await viewing([send("popup")])
		const stale = parkNextRead()
		const pendingStale = store.refreshInFlight()
		const fresh = parkNextRead()
		const pendingFresh = store.refreshInFlight({ invalidate: true })
		expect(store.hasInFlightSend).toBe(true) // closed until the fresh read answers

		stale.reject(new Error("worker restarting"))
		await pendingStale
		expect(store.approvedSendsInFlight).toBe(1) // the rows were not blanked by the failure fallback
		expect(store.hasInFlightSend).toBe(true) // still closed: the stale failure did not call it answered

		fresh.resolve([])
		await pendingFresh
		expect(store.hasInFlightSend).toBe(false)
		expect(store.approvedSendsInFlight).toBe(0)
	})

	test("a journal event from before the lock, delivered after it, does not refill the cache", async () => {
		const store = await viewing([send("popup")])
		store.resetInFlight()

		emitUpdated(send("popup"))
		expect(store.hasInFlightSend).toBe(false)
		expect(store.approvedSendsInFlight).toBe(0)

		mockGetOperations.mockResolvedValueOnce([])
		await store.refreshInFlight({ invalidate: true })
		emitUpdated(send("popup"))
		expect(store.hasInFlightSend).toBe(true) // events count again once the unlock has re-read
	})
})
