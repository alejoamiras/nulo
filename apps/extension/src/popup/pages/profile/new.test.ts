import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const profileApi = vi.hoisted(() => ({
	getProfiles: vi.fn(async () => [] as Array<{ name: string }>),
	createProfile: vi.fn(async () => ({ id: "p2", name: "Profile 2", type: "password" })),
}))
vi.mock("@/utils/core", () => ({ managers: { profile: profileApi } }))
vi.mock("@/wallet/utils/onboarding-tab", () => ({ redirectToOnboardingTabIfNeeded: vi.fn() }))
vi.mock("./new-profile-helpers", () => ({ activateCreatedProfile: vi.fn(async () => undefined), makeCreateKeydownHandler: () => () => {} }))
vi.mock("@/composables/usePasskeyCeremony", () => ({
	usePasskeyCeremony: () => ({ request: { value: null }, runCeremony: vi.fn(), onResolve: vi.fn(), onReject: vi.fn() }),
}))
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {}, meta: {} }) }))

import { Flex, Input, Text } from "@nulo/design"
import { expectNativeAttrs, nativeInput, pasteInto, typeNow } from "../../../../tests/helpers/credential-pins"
import New from "./new.vue"

const wrappers: VueWrapper[] = []

async function mountNew() {
	const wrapper = mount(New, {
		global: {
			plugins: [createTestingPinia({ createSpy: vi.fn })],
			components: { Flex, Input, Text },
			stubs: {
				CollapsingHeroLayout: { template: '<section><slot /><slot name="bottom" /></section>' },
				NewProfileMethodTabs: true,
				NewProfileCredentials: true,
				PasskeyCeremonyDialog: true,
				Button: { template: "<button><slot /></button>" },
			},
		},
	})
	wrappers.push(wrapper)
	await flushPromises()
	return wrapper
}

const page = (w: VueWrapper) => w.get('[data-testid="register-page"]')

beforeEach(() => {
	vi.clearAllMocks()
	profileApi.getProfiles.mockResolvedValue([])
	vi.stubGlobal("chrome", {
		storage: {
			local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
		runtime: { connect: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
	})
})
afterEach(() => {
	for (const w of wrappers.splice(0)) w.unmount()
	vi.unstubAllGlobals()
})

describe("popup new profile", () => {
	test("a later profile shows the name field prefilled Profile N", async () => {
		profileApi.getProfiles.mockResolvedValue([{ name: "Main" }])
		const w = await mountNew()
		expect(page(w).attributes("data-name-field")).toBe("shown")
		expect((w.get('[data-testid="register-name-input"] input').element as HTMLInputElement).value).toBe("Profile 2")
	})

	test("a first profile created here has no name field", async () => {
		const w = await mountNew()
		expect(page(w).attributes("data-name-field")).toBe("hidden")
		expect(w.find('[data-testid="register-name-input"]').exists()).toBe(false)
	})
})

describe("popup new profile — the profile-name field", () => {
	const NAME = "register-name-input"
	async function mountShown() {
		profileApi.getProfiles.mockResolvedValue([{ name: "Main" }])
		const w = await mountNew()
		// mountNew renders detached; focus is only observable in the document.
		document.body.appendChild(w.element.parentElement ?? w.element)
		return w
	}

	test("the field: placeholder, text type, no autofill hints", async () => {
		const w = await mountShown()
		const input = nativeInput(w, NAME)
		expect(input.placeholder).toBe("My Profile")
		expect(input.type).toBe("text")
		expectNativeAttrs(w, NAME, { autocomplete: null, autocapitalize: null, autocorrect: null })
	})

	test("typing is sanitized; a real paste is sanitized and capped at 32", async () => {
		const w = await mountShown()
		typeNow(nativeInput(w, NAME), "Bob<>!")
		await flushPromises()
		expect(nativeInput(w, NAME).value).toBe("Bob")
		typeNow(nativeInput(w, NAME), "")
		expect(pasteInto(nativeInput(w, NAME), `Ali<ce>!${"x".repeat(40)}`)).toBe(true)
		await flushPromises()
		expect(nativeInput(w, NAME).value).toBe(`Alice${"x".repeat(24)}`)
	})

	test("an emptied name fails at submit: alert, aria-invalid, shake, focus back on the field, nothing created", async () => {
		const w = await mountShown()
		w.findComponent({ name: "NewProfileMethodTabs" }).vm.$emit("update:type", "passkey")
		typeNow(nativeInput(w, NAME), "")
		await flushPromises()
		const shaker = () => w.get(`[data-testid="${NAME}"]`).element.parentElement as HTMLElement
		expect(shaker().className).not.toMatch(/shake/)
		await w.get('[data-testid="register-submit-btn"]').trigger("click")
		await flushPromises()
		await new Promise((r) => setTimeout(r, 50))
		const alert = shaker().parentElement?.querySelector('[role="alert"]')
		expect(alert?.textContent?.trim()).toBe("Profile name is required.")
		expect(nativeInput(w, NAME).getAttribute("aria-invalid")).toBe("true")
		expect(shaker().className).toMatch(/shake/)
		expect(document.activeElement).toBe(nativeInput(w, NAME))
		expect(profileApi.createProfile).not.toHaveBeenCalled()
		typeNow(nativeInput(w, NAME), "E")
		await flushPromises()
		expect(shaker().parentElement?.querySelector('[role="alert"]')).toBeNull()
	})
})
