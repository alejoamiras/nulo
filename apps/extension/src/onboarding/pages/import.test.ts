import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const profileApi = vi.hoisted(() => ({ getProfiles: vi.fn(async () => [] as Array<{ name: string }>) }))
vi.mock("@/utils/core", () => ({ managers: { profile: profileApi } }))
vi.mock("@/composables/useProfileBootstrap", () => ({
	useProfileBootstrap: () => ({ bootstrapActiveProfile: vi.fn(), hydrateKnownProfile: vi.fn() }),
}))
vi.mock("@/composables/usePasskeyCeremony", () => ({
	usePasskeyCeremony: () => ({ request: { value: null }, runCeremony: vi.fn(), onResolve: vi.fn(), onReject: vi.fn() }),
}))
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ meta: {} }) }))

import { BrutalistTitle, Flex, Input, Text } from "@nulo/design"
import OnboardingProfileNameField from "../components/OnboardingProfileNameField.vue"
import Import from "./import.vue"

const wrappers: VueWrapper[] = []

async function mountImport() {
	const wrapper = mount(Import, {
		global: {
			plugins: [createTestingPinia({ createSpy: vi.fn })],
			components: { BrutalistTitle, Flex, Input, OnboardingProfileNameField, Text },
			stubs: {
				OnboardingPage: { template: "<main><slot /></main>" },
				OnboardingBackLink: true,
				StepIndicator: true,
				ImportMethodPicker: true,
				PasskeyCeremonyDialog: true,
			},
		},
	})
	wrappers.push(wrapper)
	await flushPromises()
	return wrapper
}

const page = (w: VueWrapper) => w.get('[data-testid="onboarding-import-page"]')

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

describe("onboarding import", () => {
	test("a first-run import has no name field and reads Import / Wallet", async () => {
		const w = await mountImport()
		expect(page(w).attributes("data-name-field")).toBe("hidden")
		expect(w.find('[data-testid="onboarding-name-input"]').exists()).toBe(false)
		expect(w.text()).toContain("Import")
		expect(w.text()).toContain("Wallet")
		expect(w.text()).not.toContain("Profile")
		expect(w.text()).toContain("Restore from a recovery phrase, passkey, or full backup.")
	})

	test("with a profile already there, the field shows prefilled Profile 2", async () => {
		profileApi.getProfiles.mockResolvedValue([{ name: "Main" }])
		const w = await mountImport()
		expect(page(w).attributes("data-name-field")).toBe("shown")
		expect((w.get('[data-testid="onboarding-name-input"] input').element as HTMLInputElement).value).toBe("Profile 2")
	})
})
