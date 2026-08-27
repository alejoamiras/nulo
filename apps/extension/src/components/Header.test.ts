/**
 * Narrow integration test for the header's avatar/name/address split — deliberately NOT a full
 * Header suite (L4+ convention: e2e owns the header). It pins the one wiring the copy-helper unit
 * test cannot see: the address button hands the FULL active address (not the truncated display
 * text) to the clipboard, and both switcher affordances open the accounts popup.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"

const H = vi.hoisted(() => ({
	openPopup: vi.fn(),
	openToast: vi.fn(),
	noopEvent: { add: vi.fn(), remove: vi.fn() },
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
vi.mock("@/utils/core", () => ({ managers: { profile: { lockActiveProfile: vi.fn() } } }))
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({
		isLogined: true,
		_isHomeScreenOpened: false,
		account: { name: "Primary Account", address: FULL_ADDRESS },
		network: { name: "Alpha V5" },
		networkStatus: "Active",
	}),
}))
vi.mock("@/stores/cache.store", () => ({
	useCacheStore: () => ({ failureLog: null, activeTasksCount: null }),
}))
vi.mock("@/stores/popup.store", () => ({ usePopupStore: () => ({ open: H.openPopup }) }))
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
	H.openToast.mockClear()
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
