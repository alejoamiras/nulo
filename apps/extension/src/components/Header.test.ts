/**
 * Narrow integration test for the header — deliberately NOT a full Header suite (L4+ convention:
 * e2e owns the header). It pins the wiring unit tests cannot see: the address button hands the FULL
 * active address (not the truncated display text) to the clipboard, both switcher affordances open
 * the accounts popup, and the lock button decides between locking and asking on a fresh count.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"

const H = vi.hoisted(() => ({
	openPopup: vi.fn(),
	closePopup: vi.fn(),
	openToast: vi.fn(),
	lockActiveProfile: vi.fn(),
	noopEvent: { add: vi.fn(), remove: vi.fn() },
	getSessionHandle: vi.fn(),
	profileListeners: new Set<() => void>(),
	disconnectListeners: new Set<() => void>(),
	app: {} as Record<string, unknown>,
	cache: {} as { confirm: Record<string, unknown> } & Record<string, unknown>,
}))

const FULL_ADDRESS = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"

vi.mock("@/wallet/services/log-viewer/client", () => ({
	LogViewerServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), onLog: H.noopEvent }
	}),
}))
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), onUpdate: H.noopEvent, getValue: vi.fn().mockResolvedValue(false) }
	}),
}))
vi.mock("@/wallet/services/task/client", () => ({
	TaskServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			getTasks: vi.fn().mockResolvedValue([]),
			onTaskCreated: H.noopEvent,
			onTaskUpdated: H.noopEvent,
			onTaskDeleted: H.noopEvent,
		}
	}),
}))
vi.mock("@/wallet/config", () => ({ defaultConfig: () => ({ indicateFailures: false, showNode: false }) }))
vi.mock("@/utils/core", () => ({
	managers: {
		profile: {
			lockActiveProfile: H.lockActiveProfile,
			getSessionHandle: H.getSessionHandle,
			onActiveProfileChanged: {
				add: (fn: () => void) => H.profileListeners.add(fn),
				remove: (fn: () => void) => H.profileListeners.delete(fn),
			},
			onDisconnected: {
				add: (fn: () => void) => H.disconnectListeners.add(fn),
				remove: (fn: () => void) => H.disconnectListeners.delete(fn),
			},
		},
	},
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => H.app }))
vi.mock("@/stores/cache.store", () => ({ useCacheStore: () => H.cache }))
vi.mock("@/stores/popup.store", () => ({ usePopupStore: () => ({ open: H.openPopup, close: H.closePopup }) }))
vi.mock("vue-router", async (importOriginal) => {
	const mod = await importOriginal<typeof import("vue-router")>()
	return { ...mod, useRoute: () => ({ name: "popup-general", meta: {} }), useRouter: () => ({ push: vi.fn() }) }
})

import Header from "./Header.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	MaterialIcon: { template: '<span data-testid="stub-material" :data-name="name" />', props: ["name", "size", "color"] },
	AccountAvatar: { template: '<span data-testid="stub-avatar" />', props: ["name", "address", "size"] },
}

function mountHeader() {
	return mount(Header, { global: { stubs: STUBS } })
}

beforeEach(() => {
	vi.stubGlobal("useToast", () => ({ openToast: H.openToast }))
	H.openPopup.mockClear()
	H.closePopup.mockClear()
	H.openToast.mockClear()
	H.profileListeners.clear()
	H.disconnectListeners.clear()
	H.getSessionHandle.mockReset().mockResolvedValue("session-1")
	H.lockActiveProfile.mockClear()
	H.app = {
		isLogined: true,
		_isHomeScreenOpened: false,
		account: { name: "Primary Account", address: FULL_ADDRESS },
		network: { name: "Alpha V5" },
		networkStatus: "Active",
		approvedSendsInFlight: 0,
		refreshInFlight: vi.fn(async () => {}),
	}
	H.cache = { failureLog: null, activeTasksCount: null, confirm: {} }
})

describe("Header — avatar/name/address split", () => {
	test("the address button copies the FULL active address, not the truncated display text", async () => {
		const writeText = vi.fn(async () => {})
		Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true })

		const w = mountHeader()
		// Sanity: the DISPLAY is truncated — the copy must not be.
		expect(w.find('[data-testid="account-address-copy"]').text()).toContain("0x018d...00f6")
		await w.find('[data-testid="account-address-copy"]').trigger("click")
		await flushPromises()

		expect(writeText).toHaveBeenCalledWith(FULL_ADDRESS)
		expect(H.openToast).toHaveBeenCalledWith({ label: "Address is copied", icon: "copy" }, undefined)
		expect(H.openPopup).not.toHaveBeenCalled() // copying never opens the switcher
	})

	test("avatar AND name both open the accounts popup (the two switcher affordances)", async () => {
		const w = mountHeader()
		await w.find('[data-testid="account-avatar-btn"]').trigger("click")
		expect(H.openPopup).toHaveBeenCalledWith("accounts")
		await w.find('[data-testid="account-selector"]').trigger("click")
		expect(H.openPopup).toHaveBeenCalledTimes(2)
	})
})

describe("Header — lock", () => {
	test("is a chip: the padlock and the word Lock, named for what it does", () => {
		const lock = mountHeader().get('[data-testid="header-lock"]')
		expect(lock.get('[data-testid="stub-material"]').attributes("data-name")).toBe("lock")
		expect(lock.text()).toBe("Lock")
		expect(lock.attributes("aria-label")).toBe("Lock wallet")
		expect(lock.attributes("type")).toBe("button")
	})

	async function clickLock() {
		const w = mountHeader()
		await w.find('[data-testid="header-lock"]').trigger("click")
		await flushPromises()
	}

	test("nothing running after a fresh journal read: it locks at once", async () => {
		await clickLock()
		expect(H.app.refreshInFlight).toHaveBeenCalledTimes(1)
		expect(H.lockActiveProfile).toHaveBeenCalledExactlyOnceWith("session-1")
		expect(H.app.isLogined).toBe(false)
		expect(H.openPopup).not.toHaveBeenCalled()
	})

	test.each([
		{ running: 1, description: "1 transaction is still running. Locking cancels it." },
		{ running: 3, description: "3 transactions are still running. Locking cancels them." },
	])("$running running: it asks, and locks only when the dialog confirms", async ({ running, description }) => {
		// The count before the read is 0, so asking proves the decision waited for the read.
		H.app.refreshInFlight = vi.fn(async () => {
			H.app.approvedSendsInFlight = running
		})
		await clickLock()

		expect(H.openPopup).toHaveBeenCalledWith("confirm")
		expect(H.cache.confirm).toMatchObject({
			pre_title: "Running transactions",
			title: "Lock wallet?",
			description,
			confirm_text: "Lock anyway",
			confirm_color: "red",
		})
		expect(H.lockActiveProfile).not.toHaveBeenCalled()
		expect(H.app.isLogined).toBe(true)

		const confirm = H.cache.confirm.callback as () => void
		confirm()
		expect(H.lockActiveProfile).toHaveBeenCalledExactlyOnceWith("session-1")
		expect(H.app.isLogined).toBe(false)
	})

	test("a journal read that outlasts the budget locks without asking, and its late answer changes nothing", async () => {
		vi.useFakeTimers()
		try {
			// Events had counted a send before the click; an unanswered read must not ask on that count.
			H.app.approvedSendsInFlight = 1
			let answer: () => void = () => {}
			H.app.refreshInFlight = vi.fn(
				() =>
					new Promise<void>((resolve) => {
						answer = () => {
							H.app.approvedSendsInFlight = 1
							resolve()
						}
					}),
			)
			await clickLock()
			expect(H.lockActiveProfile).not.toHaveBeenCalled()

			await vi.advanceTimersByTimeAsync(3_000)
			expect(H.lockActiveProfile).toHaveBeenCalledExactlyOnceWith(undefined)

			answer()
			await flushPromises()
			expect(H.openPopup).not.toHaveBeenCalled()
			expect(H.lockActiveProfile).toHaveBeenCalledTimes(1)
		} finally {
			vi.useRealTimers()
		}
	})

	test.each(["profileListeners", "disconnectListeners"] as const)("an event from %s closes the lock dialog it raised", async (source) => {
		H.app.refreshInFlight = vi.fn(async () => {
			H.app.approvedSendsInFlight = 1
		})
		await clickLock()
		expect(H.openPopup).toHaveBeenCalledWith("confirm")

		for (const listener of H[source]) listener()
		expect(H.closePopup).toHaveBeenCalledWith("confirm")
		expect(H.lockActiveProfile).not.toHaveBeenCalled()
	})

	test("a session change during the read abandons the lock: no second read, no dialog, no lock", async () => {
		let changed = false
		H.app.refreshInFlight = vi.fn(async () => {
			if (!changed) for (const listener of H.profileListeners) listener()
			changed = true
		})
		await clickLock()

		expect(H.app.refreshInFlight).toHaveBeenCalledTimes(1)
		expect(H.openPopup).not.toHaveBeenCalled()
		expect(H.lockActiveProfile).not.toHaveBeenCalled()
	})
})
