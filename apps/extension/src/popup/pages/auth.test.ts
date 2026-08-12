import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { RestoreTornError } from "@nulo/extension-messaging/errors"
import { useAppStore } from "@/stores/app.store"
import Auth from "./auth.vue"

const unlockProfile = vi.fn()

vi.mock("@/utils/core", () => ({
	managers: {
		profile: {
			unlockProfile: (...args: unknown[]) => unlockProfile(...args),
			getPasskeyCredentialId: vi.fn(),
			getProfiles: vi.fn(async () => []),
		},
		account: undefined,
	},
	initTransactionService: vi.fn(),
	refreshBalances: vi.fn(),
}))
vi.mock("@/composables/usePasskeyCeremony", () => ({
	usePasskeyCeremony: () => ({ request: { value: null }, runCeremony: vi.fn(), onResolve: vi.fn(), onReject: vi.fn() }),
}))
vi.mock("@/composables/notification", () => ({ checkNotificationsForShow: vi.fn() }))
vi.mock("@/utils/lastActiveProfile", () => ({
	getLastActiveProfileId: vi.fn(async () => undefined),
	setLastActiveProfileId: vi.fn(async () => undefined),
}))
const routerPush = vi.fn()
vi.mock("vue-router", () => ({
	useRouter: () => ({ push: routerPush, go: vi.fn() }),
	useRoute: () => ({ name: "popup-auth", meta: {} }),
}))

beforeEach(() => {
	unlockProfile.mockReset()
	vi.stubGlobal("chrome", {
		storage: {
			local: {
				get: vi.fn(async () => ({})),
				set: vi.fn(async () => undefined),
				remove: vi.fn(async () => undefined),
			},
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
		runtime: { connect: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
	})
})
afterEach(() => vi.unstubAllGlobals())

/** Minimal Input stub that keeps v-model wiring alive so the submit gate
 *  (`isAllowedToContinue`) opens once a password is typed. */
const InputStub = {
	props: ["modelValue"],
	emits: ["update:modelValue", "input"],
	// auth.vue's onMounted calls the template-ref's focus(); expose a no-op.
	methods: { focus() {} },
	template: `<input :value="modelValue" data-stub-input @input="$emit('update:modelValue', $event.target.value); $emit('input', $event)" />`,
}

function mountAuth() {
	const wrapper = mount(Auth, {
		global: {
			plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false })],
			stubs: {
				Input: InputStub,
				Button: { template: `<button type="submit" v-bind="$attrs"><slot /></button>` },
				Tooltip: { template: `<div><slot /></div>` },
				MaterialIcon: true,
				Flex: { template: `<div><slot /></div>` },
				AuthProfilePill: true,
				PasskeyCeremonyDialog: true,
				Transition: true,
			},
		},
	})
	const appStore = useAppStore()
	appStore.profile = { id: "p1", name: "P", type: "password" } as never
	return { wrapper, appStore }
}

describe("auth.vue — torn-import unlock refusal", () => {
	test("a RestoreTornError from unlock surfaces the torn explanation (no route, no wrong-password shake)", async () => {
		unlockProfile.mockRejectedValue(new RestoreTornError(undefined, { profileId: "p1" }))
		const { wrapper } = mountAuth()
		await flushPromises()

		await wrapper.find("[data-stub-input]").setValue("pass1234")
		await wrapper.find("form").trigger("submit")
		await flushPromises()

		const torn = wrapper.find('[data-testid="auth-restore-torn"]')
		expect(torn.exists()).toBe(true)
		expect(torn.text()).toContain("didn't finish")
		expect(wrapper.find('[data-testid="error-text"]').exists()).toBe(false)
		expect(routerPush).not.toHaveBeenCalled()
	})

	test("the torn state clears when the user switches profiles on this screen", async () => {
		unlockProfile.mockRejectedValue(new RestoreTornError(undefined, { profileId: "p1" }))
		const { wrapper, appStore } = mountAuth()
		await flushPromises()
		await wrapper.find("[data-stub-input]").setValue("pass1234")
		await wrapper.find("form").trigger("submit")
		await flushPromises()
		expect(wrapper.find('[data-testid="auth-restore-torn"]').exists()).toBe(true)

		appStore.profile = { id: "p2", name: "Q", type: "password" } as never
		await flushPromises()
		await wrapper.vm.$nextTick()
		expect(wrapper.find('[data-testid="auth-restore-torn"]').exists()).toBe(false)
	})
})
