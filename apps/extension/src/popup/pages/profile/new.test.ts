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
