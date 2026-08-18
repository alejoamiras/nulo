/**
 * Stale-activation fence for `setupActiveAccount` (F-B27 residual, 2026-08-16
 * remediation follow-up arc 1).
 *
 * The race: `setupActiveAccount` suspends (storage read; `commitScopeChange`'s
 * `refreshInFlight` journal RPC) with its account choice already computed from
 * the THEN-current profile's list. A profile activation that supersedes it
 * mid-await completes fully; the parked run then resumes and lands the LOSER's
 * account after the winner's — and stamps the loser's address into the global
 * durable `nulo:ui:activeAccount` key, which survives into the next bootstrap.
 * `commitScopeChange` can't catch this: it guards in-flight sends, not
 * superseded activations.
 *
 * These tests park run A deterministically inside `commitScopeChange` →
 * `refreshInFlight` → `getOperations` (the widest await window) via the mocked
 * journal client, complete winner B, then release A.
 */

import { createPinia, setActivePinia } from "pinia"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"

import { useAppStore } from "./app.store"

const { mockGetOperations } = vi.hoisted(() => ({ mockGetOperations: vi.fn() }))

vi.mock("@/wallet/services/operation-journal/client", () => ({
	OperationJournalServiceClient: class {
		onOperationAdded = { add: () => {} }
		onOperationUpdated = { add: () => {} }
		onOperationDeleted = { add: () => {} }
		onConnected = { add: () => {} }
		connect = async () => {}
		disconnect = () => {}
		getOperations = mockGetOperations
	},
}))

const asAccount = (address: string) => ({ address }) as unknown as Account
const asNetwork = (chainId: number, id = `net-${chainId}`) => ({ id, chainId }) as unknown as Network

/** Macrotask flush — lets watchers + parked awaits settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** What the keyed chrome.storage.local.get stub serves for the activeAccount
 *  key (keyed by request so migration-facade reads can't consume it). */
let activeAccountStorage: Record<string, unknown> = {}
let setSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
	setActivePinia(createPinia())
	mockGetOperations.mockReset()
	activeAccountStorage = {}
	vi.stubGlobal("managers", { transaction: { getTransactions: vi.fn() } })
	setSpy = vi.fn(async (_items: Record<string, unknown>) => {})
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
	;(chrome.storage as any).local = {
		get: vi.fn(async (keys?: string | string[]) => {
			if (keys === "nulo:ui:activeAccount" || (Array.isArray(keys) && keys.includes("nulo:ui:activeAccount"))) {
				return activeAccountStorage
			}
			return {}
		}),
		set: setSpy,
	}
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
	;(chrome.storage as any).onChanged = {
		addListener: vi.fn(),
		removeListener: vi.fn(),
	}
})

/** Bring the store to profile A with its journal read already answered. */
async function scopeToProfileA(store: ReturnType<typeof useAppStore>) {
	mockGetOperations.mockResolvedValueOnce([]) // profile-watch refresh for A
	store.profile = { id: "profile-a" } as never
	store.network = asNetwork(1)
	store.accounts = [asAccount("0xA")] as never
	await flush()
}

/** Park the next journal read (run A's commitScopeChange) on a gate. */
function armJournalGate(): () => void {
	let release!: () => void
	const gate = new Promise<unknown[]>((resolve) => {
		release = () => resolve([])
	})
	mockGetOperations.mockReturnValueOnce(gate)
	return release
}

/** Winner B fully completes while the loser is parked. */
async function completeWinnerB(store: ReturnType<typeof useAppStore>) {
	mockGetOperations.mockResolvedValueOnce([]) // profile-watch refresh for B
	store.profile = { id: "profile-b" } as never
	store.accounts = [asAccount("0xB")] as never
	store.account = asAccount("0xB") as never
	await flush()
	setSpy.mockClear() // only the parked run's writes are under test
}

describe("app.store.setupActiveAccount — stale-activation fence", () => {
	test("a superseded run (first-account branch) must NOT land its account or stamp the durable pointer", async () => {
		const store = useAppStore()
		await scopeToProfileA(store)

		const release = armJournalGate()
		const runA = store.setupActiveAccount() // no remembered key → first-branch
		await flush() // parked inside commitScopeChange → getOperations

		await completeWinnerB(store)

		release()
		const result = await runA

		expect(store.account?.address).toBe("0xB") // loser's 0xA must not land after the winner
		expect(result).toBe(false)
		expect(setSpy).not.toHaveBeenCalled() // loser must not poison nulo:ui:activeAccount
	})

	test("a superseded run (remembered-account branch) must NOT land its account", async () => {
		const store = useAppStore()
		await scopeToProfileA(store)
		activeAccountStorage = { "nulo:ui:activeAccount": "0xA" } // remembered = A's account

		const release = armJournalGate()
		const runA = store.setupActiveAccount() // remembered found → guarded commit branch
		await flush() // parked inside commitScopeChange → getOperations

		await completeWinnerB(store)

		release()
		const result = await runA

		expect(store.account?.address).toBe("0xB")
		expect(result).toBe(false)
		expect(setSpy).not.toHaveBeenCalled()
	})

	test("an un-superseded run still lands the first account and persists it (fence must not over-refuse)", async () => {
		const store = useAppStore()
		await scopeToProfileA(store)
		mockGetOperations.mockResolvedValueOnce([]) // run's own commitScopeChange read

		await expect(store.setupActiveAccount()).resolves.toBe(true)

		expect(store.account?.address).toBe("0xA")
		expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ "nulo:ui:activeAccount": "0xA" }))
	})

	test("an un-superseded run still lands the remembered account (fence must not over-refuse)", async () => {
		const store = useAppStore()
		mockGetOperations.mockResolvedValueOnce([]) // profile-watch refresh for A
		store.profile = { id: "profile-a" } as never
		store.network = asNetwork(1)
		store.accounts = [asAccount("0xA"), asAccount("0xA2")] as never
		await flush()
		activeAccountStorage = { "nulo:ui:activeAccount": "0xA2" }
		mockGetOperations.mockResolvedValueOnce([]) // run's own commitScopeChange read

		await expect(store.setupActiveAccount()).resolves.toBe(true)

		expect(store.account?.address).toBe("0xA2")
	})
})
