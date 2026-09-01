/**
 * Pre-split shape pins for the app store (codex conditions for the factory split): the exact
 * `$state` keys, the `storeToRefs` keys, which members are actions, the return-key ORDER, the
 * `withScopeChangeAllowed` alias identity, setup-store `$reset` semantics, ONE journal client whose
 * listeners are added once across profile flips, the profile→readiness reset and the synchronous
 * scope activation.
 */

import { createPinia, setActivePinia, storeToRefs } from "pinia"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { nextTick } from "vue"

const journalCtor = vi.fn()
const listenerAdds: string[] = []
vi.mock("@/wallet/services/operation-journal/client", () => ({
	OperationJournalServiceClient: vi.fn(function () {
		journalCtor()
		const handler = (name: string) => ({
			add: () => {
				listenerAdds.push(name)
			},
		})
		return {
			onOperationAdded: handler("added"),
			onOperationUpdated: handler("updated"),
			onOperationDeleted: handler("deleted"),
			onConnected: handler("connected"),
			connect: vi.fn(async () => {}),
			getOperations: vi.fn(async () => []),
		}
	}),
}))

import { useActivityStore } from "@/stores/activity.store"
import { useAppStore } from "./app.store"

const STATE_KEYS = [
	"_isHomeScreenOpened",
	"isLoading",
	"displayOption",
	"onboardingCompleted",
	"profile",
	"profiles",
	"account",
	"accounts",
	"isLogined",
	"isSessionChecked",
	"pageAwaitingAuth",
	"bootstrapFailure",
	"network",
	"networkStatus",
	"networks",
	"dappSessions",
	"isPrivacyModeEnabled",
	"defaultExplorer",
	"loggerWindowId",
]
const GETTER_KEYS = ["isRegistered", "hasInFlightSend", "activeScope", "transactions", "awaitingTransactions"]
const ACTION_KEYS = [
	"loadOnboardingCompleted",
	"setOnboardingCompleted",
	"setupActiveAccount",
	"selectAccount",
	"changeAccountVisibility",
	"updateAccount",
	"syncNetworkStatus",
	"renameNetwork",
	"removeNetwork",
	"refreshInFlight",
	"commitScopeChange",
	"withScopeChangeAllowed",
	"addAwaitingTransaction",
	"removeAwaitingTransaction",
	"clearActivity",
	"onTxAdded",
	"onTxUpdated",
	"syncTransactions",
]
/** The setup's return object, in order — the store's own key order among these names. */
const RETURN_ORDER = [
	"_isHomeScreenOpened",
	"isLoading",
	"awaitingTransactions",
	"displayOption",
	"profile",
	"profiles",
	"isRegistered",
	"account",
	"isLogined",
	"isSessionChecked",
	"pageAwaitingAuth",
	"bootstrapFailure",
	"accounts",
	"setupActiveAccount",
	"selectAccount",
	"changeAccountVisibility",
	"updateAccount",
	"network",
	"networkStatus",
	"syncNetworkStatus",
	"networks",
	"dappSessions",
	"renameNetwork",
	"removeNetwork",
	"transactions",
	"activeScope",
	"hasInFlightSend",
	"refreshInFlight",
	"commitScopeChange",
	"withScopeChangeAllowed",
	"addAwaitingTransaction",
	"removeAwaitingTransaction",
	"clearActivity",
	"onTxAdded",
	"onTxUpdated",
	"syncTransactions",
	"isPrivacyModeEnabled",
	"defaultExplorer",
	"loggerWindowId",
	"onboardingCompleted",
	"loadOnboardingCompleted",
	"setOnboardingCompleted",
]

beforeEach(() => {
	setActivePinia(createPinia())
	journalCtor.mockClear()
	listenerAdds.length = 0
	vi.stubGlobal("managers", { transaction: { getTransactions: vi.fn(async () => []) } })
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
	;(chrome.storage as any).local = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }
	// biome-ignore lint/suspicious/noExplicitAny: chrome stub assignment
	;(chrome.storage as any).onChanged = { addListener: vi.fn(), removeListener: vi.fn() }
})
afterEach(() => {
	vi.unstubAllGlobals()
})

describe("useAppStore — shape", () => {
	test("$state keys, storeToRefs keys and the action set are exactly the current ones", () => {
		const store = useAppStore()
		expect(Object.keys(store.$state).sort()).toEqual([...STATE_KEYS].sort())
		expect(Object.keys(storeToRefs(store)).sort()).toEqual([...STATE_KEYS, ...GETTER_KEYS].sort())
		const actions = RETURN_ORDER.filter((k) => typeof (store as unknown as Record<string, unknown>)[k] === "function")
		expect(actions.sort()).toEqual([...ACTION_KEYS].sort())
	})

	test("the return-key order is unchanged and the scope-change alias admits a commit exactly like the original", async () => {
		const store = useAppStore()
		const known = new Set(RETURN_ORDER)
		expect(Object.keys(store).filter((k) => known.has(k))).toEqual(RETURN_ORDER)
		// Pinia wraps every action separately, so identity is not observable on the store; the alias
		// must behave as the guard: an idle store admits and runs the synchronous commit.
		await vi.waitFor(() => expect(store.hasInFlightSend).toBe(false))
		const ran: string[] = []
		expect(await store.withScopeChangeAllowed(() => void ran.push("alias"))).toBe(true)
		expect(await store.commitScopeChange(() => void ran.push("guard"))).toBe(true)
		expect(ran).toEqual(["alias", "guard"])
	})

	test("setup-store $reset keeps its Pinia semantics (throws outside production)", () => {
		const store = useAppStore()
		expect(() => store.$reset()).toThrow()
	})
})

describe("useAppStore — in-flight tracker resources", () => {
	test("ONE journal client, listeners added once, across three profile flips", async () => {
		const store = useAppStore()
		for (const id of ["p1", "p2", "p3"]) {
			store.profile = { id } as never
			await vi.waitFor(() => expect(store.hasInFlightSend).toBe(false))
		}
		expect(journalCtor).toHaveBeenCalledTimes(1)
		expect(listenerAdds).toEqual(["added", "updated", "deleted", "connected"])
	})

	test("a profile change closes the guard until the journal answers; a complete scope activates synchronously", async () => {
		const activity = useActivityStore()
		const activateSpy = vi.spyOn(activity, "activateScope")
		const store = useAppStore()
		await vi.waitFor(() => expect(store.hasInFlightSend).toBe(false))
		store.profile = { id: "p1" } as never
		// The profile watcher is pre-flush: the guard closes on the next tick and stays closed until
		// the (async) journal read answers.
		await nextTick()
		expect(store.hasInFlightSend).toBe(true)
		await vi.waitFor(() => expect(store.hasInFlightSend).toBe(false))

		activateSpy.mockClear()
		store.network = { id: "net-1", chainId: 1 } as never
		store.account = { address: "0xacc" } as never
		// flush: "sync" — the scope swap happens in the same tick as the last assignment.
		expect(activateSpy).toHaveBeenLastCalledWith({ profileId: "p1", networkId: "net-1", chainId: 1, accountAddress: "0xacc" })
	})
})
