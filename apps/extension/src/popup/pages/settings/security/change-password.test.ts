/**
 * Component tests for the change-password page's Enter shortcut, with all three fields valid: an
 * Enter in a field changes the password once, the back arrow only goes back, Change Password sends
 * one change, and a repeat Enter on it sends none.
 */

import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const profileClient = vi.hoisted(() => ({ changeProfilePassword: vi.fn(async () => undefined), disconnect: vi.fn() }))
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return profileClient
	}),
}))
const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }))
vi.mock("vue-router", () => ({ useRouter: () => router, useRoute: () => ({ query: {}, meta: {} }) }))
vi.mock("@/composables/toast", () => ({ useToast: () => ({ openToast: vi.fn() }) }))

import { Flex, Icon, Input, MaterialIcon, Text } from "@nulo/design"
import { pressOn } from "../../../../../tests/helpers/press-key"
import SubPageHeader from "@/components/ui/SubPageHeader.vue"
import ChangePassword from "./change-password.vue"

const wrappers: VueWrapper[] = []

async function mountWithValidFields() {
	const w = mount(ChangePassword, {
		attachTo: document.body,
		global: {
			plugins: [
				createTestingPinia({ createSpy: vi.fn, initialState: { app: { profile: { id: "p1", name: "Main", type: "password" } } } }),
			],
			components: { Flex, Icon, Input, MaterialIcon, SubPageHeader, Text },
			stubs: {
				Button: { template: "<button><slot /></button>" },
				ItemsContainer: { template: "<div><slot /></div>" },
				SettingItem: true,
			},
		},
	})
	wrappers.push(w)
	await flushPromises()
	await w.get('[data-testid="current-password-input"] input').setValue("old-password")
	await w.get('[data-testid="new-password-input"] input').setValue("new-password-1")
	await w.get('[data-testid="new-password-repeat-input"] input').setValue("new-password-1")
	return w
}

const submit = (w: VueWrapper) => w.get('[data-testid="change-password-submit-btn"]').element as HTMLElement

beforeEach(() => {
	vi.clearAllMocks()
	const c = (globalThis as { chrome?: { storage: Record<string, unknown> } }).chrome
	if (c) {
		c.storage.local = { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
		c.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() }
	}
})

afterEach(() => {
	for (const w of wrappers.splice(0)) w.unmount()
})

describe("change password — Enter does what the focused control says", () => {
	test("Enter on the back arrow goes back and changes nothing", async () => {
		const w = await mountWithValidFields()
		// With no history behind the page, SubPageHeader pushes its backTo.
		expect(window.history.length).toBe(1)
		pressOn(w.get('[data-testid="subpage-back"]').element as HTMLElement, "Enter")
		await flushPromises()
		expect(router.push).toHaveBeenCalledWith("/popup/settings/profile")
		expect(profileClient.changeProfilePassword).not.toHaveBeenCalled()
	})

	test("Enter on Change Password sends one change", async () => {
		const w = await mountWithValidFields()
		pressOn(submit(w), "Enter")
		await flushPromises()
		expect(profileClient.changeProfilePassword).toHaveBeenCalledTimes(1)
		expect(profileClient.changeProfilePassword).toHaveBeenCalledWith("p1", "old-password", "new-password-1")
	})

	test("a repeat Enter on Change Password sends nothing", async () => {
		const w = await mountWithValidFields()
		pressOn(submit(w), "Enter", { repeat: true })
		await flushPromises()
		expect(profileClient.changeProfilePassword).not.toHaveBeenCalled()
	})

	test("(preservation) Enter in the repeat field changes the password once", async () => {
		const w = await mountWithValidFields()
		const field = w.get('[data-testid="new-password-repeat-input"] input').element
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
		await flushPromises()
		expect(profileClient.changeProfilePassword).toHaveBeenCalledTimes(1)
	})
})
