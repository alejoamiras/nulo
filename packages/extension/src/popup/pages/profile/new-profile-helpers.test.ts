import { beforeEach, describe, expect, test, vi } from "vitest"

const accountInstance = {
	getAccounts: vi.fn(async () => [{ address: "0xACC", index: 0, visible: true }]),
}

vi.mock("@/utils/core", () => ({
	managers: { account: undefined as unknown },
	initTransactionService: vi.fn(),
	setSentinel: vi.fn(async () => undefined),
}))

vi.mock("@/utils/lastActiveProfile", () => ({
	setLastActiveProfileId: vi.fn(async () => undefined),
}))

vi.mock("@/wallet/services/account/client", () => ({
	// biome-ignore lint/complexity/useArrowFunction: vitest 4 needs a function expression for `new`-instantiated mocks
	AccountServiceClient: vi.fn(function () {
		return accountInstance
	}),
}))

vi.mock("@/wallet/utils", () => ({
	sleep: vi.fn(async () => undefined),
}))

import { initTransactionService, setSentinel } from "@/utils/core"
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"
import { activateCreatedProfile, shouldHandleEnter } from "./new-profile-helpers"

type AppStoreLike = Parameters<typeof activateCreatedProfile>[1]["appStore"]
type RouterLike = Parameters<typeof activateCreatedProfile>[1]["router"]

const storageSet = vi.fn(async () => undefined)

function makeAppStore(overrides: Partial<Record<string, unknown>> = {}): AppStoreLike {
	return {
		isLogined: true,
		profile: null,
		network: { chainId: "1" },
		accounts: [],
		account: { address: "0xACC" },
		onTxAdded: vi.fn(),
		onTxUpdated: vi.fn(),
		...overrides,
	} as unknown as AppStoreLike
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.stubGlobal("chrome", { storage: { local: { set: storageSet } } })
})

describe("activateCreatedProfile (popup manual sequence)", () => {
	test("runs the sequence in order: setLastActiveProfileId -> getAccounts -> storage -> setSentinel -> route", async () => {
		const router = { push: vi.fn() } as unknown as RouterLike
		const appStore = makeAppStore()
		await activateCreatedProfile({ id: "p1" }, { appStore, router })

		expect(setLastActiveProfileId).toHaveBeenCalledWith("p1")
		expect(accountInstance.getAccounts).toHaveBeenCalledWith("p1", "1", true)
		expect(storageSet).toHaveBeenCalledWith({ "nulo:ui:activeAccount": "0xACC" })
		expect(initTransactionService).toHaveBeenCalled()
		expect(setSentinel).toHaveBeenCalled()
		expect(router.push).toHaveBeenCalledWith("/popup/general")

		// Ordering invariants (codex final #2): the active-profile id is persisted
		// BEFORE accounts are loaded, and the session is opened BEFORE navigating.
		const setIdOrder = (setLastActiveProfileId as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
		const getAccountsOrder = accountInstance.getAccounts.mock.invocationCallOrder[0]
		const setSentinelOrder = (setSentinel as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
		const pushOrder = (router.push as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
		expect(setIdOrder).toBeLessThan(getAccountsOrder)
		expect(setSentinelOrder).toBeLessThan(pushOrder)
	})

	test("throws 'Network not set' and does not load accounts or route when network is missing", async () => {
		const router = { push: vi.fn() } as unknown as RouterLike
		const appStore = makeAppStore({ network: undefined })
		await expect(activateCreatedProfile({ id: "p1" }, { appStore, router })).rejects.toThrow("Network not set")
		expect(accountInstance.getAccounts).not.toHaveBeenCalled()
		expect(setSentinel).not.toHaveBeenCalled()
		expect(router.push).not.toHaveBeenCalled()
	})
})

describe("shouldHandleEnter (Quirk 2 double-fire guard)", () => {
	test("Enter from a text input submits", () => {
		const e = { key: "Enter", target: document.createElement("input") } as unknown as KeyboardEvent
		expect(shouldHandleEnter(e)).toBe(true)
	})

	test("Enter from a textarea submits", () => {
		const e = { key: "Enter", target: document.createElement("textarea") } as unknown as KeyboardEvent
		expect(shouldHandleEnter(e)).toBe(true)
	})

	test("Enter from a focused button does NOT submit (no double-fire)", () => {
		const e = { key: "Enter", target: document.createElement("button") } as unknown as KeyboardEvent
		expect(shouldHandleEnter(e)).toBe(false)
	})

	test("Enter from a non-form element does NOT submit", () => {
		const e = { key: "Enter", target: document.createElement("div") } as unknown as KeyboardEvent
		expect(shouldHandleEnter(e)).toBe(false)
	})

	test("a non-Enter key never submits", () => {
		const e = { key: "a", target: document.createElement("input") } as unknown as KeyboardEvent
		expect(shouldHandleEnter(e)).toBe(false)
	})
})
