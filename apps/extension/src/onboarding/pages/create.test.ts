import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const profileApi = vi.hoisted(() => ({
	getProfiles: vi.fn(async () => [] as Array<{ name: string }>),
	createProfile: vi.fn(async () => ({ id: "p1", name: "Main", type: "password" })),
	generateProfileId: vi.fn(),
	createPasskeyProfile: vi.fn(),
}))
vi.mock("@/utils/core", () => ({ managers: { profile: profileApi } }))
vi.mock("@/composables/useProfileBootstrap", () => ({
	useProfileBootstrap: () => ({ bootstrapActiveProfile: vi.fn(async () => true) }),
}))
vi.mock("@/utils/lastActiveProfile", () => ({ setLastActiveProfileId: vi.fn(async () => undefined) }))
vi.mock("@/composables/usePasskeyCeremony", () => ({
	usePasskeyCeremony: () => ({ request: { value: null }, runCeremony: vi.fn(), onResolve: vi.fn(), onReject: vi.fn() }),
}))
const routerPush = vi.fn()
vi.mock("vue-router", () => ({ useRouter: () => ({ push: routerPush }), useRoute: () => ({ meta: {} }) }))

import { BrutalistTitle, Flex, Input, MaterialIcon, Text } from "@nulo/design"
import { pressOn } from "../../../tests/helpers/press-key"
import OnboardingBackLink from "../components/OnboardingBackLink.vue"
import OnboardingProfileNameField from "../components/OnboardingProfileNameField.vue"
import Create from "./create.vue"

const wrappers: VueWrapper[] = []

async function mountCreate() {
	const wrapper = mount(Create, {
		attachTo: document.body,
		global: {
			plugins: [createTestingPinia({ createSpy: vi.fn })],
			components: { BrutalistTitle, Flex, Input, MaterialIcon, OnboardingBackLink, OnboardingProfileNameField, Text },
			stubs: {
				// Registered globally, the design Button would resolve its own `<component is="button">` to itself.
				Button: { template: '<button v-bind="$attrs"><slot /></button>' },
				OnboardingPage: { template: "<main><slot /></main>" },
				StepIndicator: true,
				PasskeyCeremonyDialog: true,
			},
		},
	})
	wrappers.push(wrapper)
	await flushPromises()
	return wrapper
}

const page = (w: VueWrapper) => w.get('[data-testid="onboarding-create-page"]')

beforeEach(() => {
	vi.clearAllMocks()
	profileApi.getProfiles.mockResolvedValue([])
})
afterEach(() => {
	for (const w of wrappers.splice(0)) w.unmount()
})

describe("onboarding create", () => {
	test("a first profile: no name field, the drawn words, focus on the password", async () => {
		const w = await mountCreate()
		expect(page(w).attributes("data-name-field")).toBe("hidden")
		expect(w.find('[data-testid="onboarding-name-input"]').exists()).toBe(false)
		expect(w.text()).toContain("Create")
		expect(w.text()).toContain("Wallet")
		expect(w.text()).not.toContain("Profile")
		expect(w.text()).toContain("How you'll unlock Nulo")
		expect(w.get('[role="tablist"]').attributes("aria-label")).toBe("How you'll unlock Nulo")
		expect(w.get('[data-testid="onboarding-submit-create"]').text()).toBe("Create wallet")
		expect(document.activeElement).toBe(w.get('[data-testid="onboarding-password-input"] input').element)

		await w.get('[data-testid="onboarding-method-passkey"]').trigger("click")
		expect(w.get('[data-testid="onboarding-submit-create"]').text()).toBe("Create with passkey")
	})

	test("the first profile is created as Main", async () => {
		const w = await mountCreate()
		await w.get('[data-testid="onboarding-password-input"] input').setValue("password123")
		await w.get('[data-testid="onboarding-password-confirm"] input').setValue("password123")
		await w.get('[data-testid="onboarding-submit-create"]').trigger("click")
		await flushPromises()
		expect(profileApi.createProfile).toHaveBeenCalledWith("Main", "password123")
		expect(routerPush).toHaveBeenCalledWith("/onboarding/learn")
	})

	test("with a profile already there, the field shows prefilled Profile 2", async () => {
		profileApi.getProfiles.mockResolvedValue([{ name: "Main" }])
		const w = await mountCreate()
		expect(page(w).attributes("data-name-field")).toBe("shown")
		expect((w.get('[data-testid="onboarding-name-input"] input').element as HTMLInputElement).value).toBe("Profile 2")
	})
})

describe("onboarding create — Enter does what the focused control says, with a valid password pair", () => {
	async function mountWithValidPair() {
		const w = await mountCreate()
		await w.get('[data-testid="onboarding-password-input"] input').setValue("password123")
		await w.get('[data-testid="onboarding-password-confirm"] input').setValue("password123")
		return w
	}

	test("Enter on Back goes back to Welcome and creates nothing", async () => {
		const w = await mountWithValidPair()
		pressOn(w.get('[data-testid="onboarding-create-back"]').element as HTMLElement, "Enter")
		await flushPromises()
		expect(routerPush).toHaveBeenCalledWith("/onboarding/welcome")
		expect(profileApi.createProfile).not.toHaveBeenCalled()
	})

	test("Enter on the active method tab keeps it selected and creates nothing", async () => {
		const w = await mountWithValidPair()
		const tab = w.get('[data-testid="onboarding-method-password"]')
		pressOn(tab.element as HTMLElement, "Enter")
		await flushPromises()
		expect(tab.attributes("aria-selected")).toBe("true")
		expect(profileApi.createProfile).not.toHaveBeenCalled()
	})

	test("a repeat Enter in the confirm field is cancelled, so the form cannot submit on it", async () => {
		const w = await mountWithValidPair()
		const field = w.get('[data-testid="onboarding-password-confirm"] input').element
		const repeat = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true })
		expect(field.dispatchEvent(repeat)).toBe(false)
	})
})
