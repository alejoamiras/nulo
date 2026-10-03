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
import {
	enterOn,
	expectMaskToggle,
	expectNativeAttrs,
	IGNORED_ENTERS,
	nativeInput,
	typeNow,
} from "../../../../../tests/helpers/credential-pins"
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

describe("change password — the credential fields' controls", () => {
	const FIELDS = ["current-password-input", "new-password-input", "new-password-repeat-input"]
	async function mountEmpty() {
		const w = mount(ChangePassword, {
			attachTo: document.body,
			global: {
				plugins: [
					createTestingPinia({
						createSpy: vi.fn,
						initialState: { app: { profile: { id: "p1", name: "Main", type: "password" } } },
					}),
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
		return w
	}

	test.each([
		["current-password-input-visibility-toggle", "current-password-input"],
		["new-password-input-visibility-toggle", "new-password-input"],
	])("%s masks the current, new and repeat fields together", async (toggle, field) => {
		await expectMaskToggle(await mountEmpty(), { toggle, field, drives: FIELDS })
	})

	test("the current field is focused on mount; autofill names each field's role", async () => {
		const w = await mountEmpty()
		expect(document.activeElement).toBe(nativeInput(w, FIELDS[0]))
		expectNativeAttrs(w, FIELDS[0], { autocomplete: "current-password", autocapitalize: null, autocorrect: null })
		for (const id of FIELDS.slice(1))
			expectNativeAttrs(w, id, { autocomplete: "new-password", autocapitalize: null, autocorrect: null })
	})

	test.each(IGNORED_ENTERS)("a %s Enter in the repeat field changes nothing", async (_name, press) => {
		const w = await mountWithValidFields()
		press(nativeInput(w, FIELDS[2]))
		await flushPromises()
		expect(profileClient.changeProfilePassword).not.toHaveBeenCalled()
	})

	test("input then Enter in one task sends the value just typed", async () => {
		const w = await mountWithValidFields()
		typeNow(nativeInput(w, FIELDS[1]), "new-password-2")
		typeNow(nativeInput(w, FIELDS[2]), "new-password-2")
		enterOn(nativeInput(w, FIELDS[2]))
		await flushPromises()
		expect(profileClient.changeProfilePassword).toHaveBeenCalledTimes(1)
		expect(profileClient.changeProfilePassword).toHaveBeenCalledWith("p1", "old-password", "new-password-2")
	})

	test("a wrong current password shakes its wrapper, and typing in the repeat field clears the alert", async () => {
		profileClient.changeProfilePassword.mockRejectedValueOnce(new Error("Invalid profile old password"))
		const w = await mountWithValidFields()
		const shaker = () => w.get('[data-testid="current-password-input"]').element.parentElement as HTMLElement
		expect(shaker().className).not.toMatch(/shake/)
		pressOn(submit(w), "Enter")
		await flushPromises()
		expect(shaker().className).toMatch(/shake/)
		expect(w.find('[data-testid="error-text"]').exists()).toBe(true)
		typeNow(nativeInput(w, FIELDS[2]), "new-password-1x")
		await flushPromises()
		expect(w.find('[data-testid="error-text"]').exists()).toBe(false)
		expect(shaker().className).not.toMatch(/shake/)
	})
})
