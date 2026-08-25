import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { RestoreTornError } from "@nulo/extension-messaging/errors"
import { useAppStore } from "@/stores/app.store"
import Auth from "./auth.vue"

const unlockProfile = vi.fn()
const initTransactionServiceMock = vi.fn()
const setLastActiveProfileIdMock = vi.fn(async () => undefined)
const openToastMock = vi.fn()

vi.mock("@/utils/core", () => ({
	managers: {
		profile: {
			unlockProfile: (...args: unknown[]) => unlockProfile(...args),
			getPasskeyCredentialId: vi.fn(),
			getProfiles: vi.fn(async () => []),
		},
		account: undefined,
	},
	initTransactionService: (...args: unknown[]) => initTransactionServiceMock(...(args as [])),
	refreshBalances: vi.fn(async () => undefined),
}))
vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
	TOAST_DURATION: { SHORT: 2_000, LONG: 5_000 },
}))
vi.mock("@/composables/usePasskeyCeremony", () => ({
	usePasskeyCeremony: () => ({ request: { value: null }, runCeremony: vi.fn(), onResolve: vi.fn(), onReject: vi.fn() }),
}))
vi.mock("@/composables/notification", () => ({ checkNotificationsForShow: vi.fn() }))
vi.mock("@/utils/lastActiveProfile", () => ({
	getLastActiveProfileId: vi.fn(async () => undefined),
	setLastActiveProfileId: (...args: unknown[]) => setLastActiveProfileIdMock(...(args as [])),
}))
vi.mock("@/wallet/services/account/client", () => ({ AccountServiceClient: vi.fn() }))
const routerPush = vi.fn()
vi.mock("vue-router", () => ({
	useRouter: () => ({ push: routerPush, go: vi.fn() }),
	useRoute: () => ({ name: "popup-auth", meta: {} }),
}))

beforeEach(() => {
	unlockProfile.mockReset()
	openToastMock.mockReset()
	initTransactionServiceMock.mockReset()
	setLastActiveProfileIdMock.mockReset()
	setLastActiveProfileIdMock.mockResolvedValue(undefined)
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

describe("auth.vue — post-unlock navigation is single-shot", () => {
	beforeEach(() => {
		routerPush.mockReset()
		window.location.hash = "#/popup/auth"
	})
	afterEach(() => {
		window.location.hash = ""
	})

	test("watcher and submit handler race to ONE push even while the hash has not moved yet", async () => {
		unlockProfile.mockResolvedValue({ id: "p1", name: "P", type: "password" })
		// The real router moves the hash only AFTER async route resolution — the mock leaves it
		// untouched to model that window, so only the claim election can stop the second push.
		routerPush.mockResolvedValue(undefined)
		const { wrapper, appStore } = mountAuth()
		await flushPromises()

		await wrapper.find("[data-stub-input]").setValue("pass1234")
		await wrapper.find("form").trigger("submit")
		await flushPromises()

		// The submit handler is now inside its isLogined poll; the flip below fires the watcher
		// (push #1) and then releases the poll, whose own advance must find the claim taken.
		appStore.isLogined = true
		await new Promise((r) => setTimeout(r, 350))
		await flushPromises()

		expect(routerPush).toHaveBeenCalledTimes(1)
		expect(routerPush).toHaveBeenCalledWith("/popup/general")
	})

	test("the isLogined watcher never pushes when the popup already left the auth screen", async () => {
		window.location.hash = "#/popup/send"
		const { appStore } = mountAuth()
		await flushPromises()

		appStore.isLogined = true
		await flushPromises()

		expect(routerPush).not.toHaveBeenCalled()
	})

	test("a route merely CARRYING ?from=/popup/auth is off-screen: no push (substring regression)", async () => {
		// The select-profile popup navigates to /popup/import?from=/popup/auth — a substring
		// hash test matched it and yanked the user out of the import flow.
		window.location.hash = "#/popup/import?from=/popup/auth"
		const { appStore } = mountAuth()
		await flushPromises()

		appStore.isLogined = true
		await flushPromises()

		expect(routerPush).not.toHaveBeenCalled()
	})
})

describe("auth.vue — bounded activation wait (N-08)", () => {
	async function submitUnlock(wrapper: ReturnType<typeof mountAuth>["wrapper"]) {
		await wrapper.find("[data-stub-input]").setValue("pw")
		await wrapper.find("form").trigger("submit")
	}

	test("timeout: the latch releases and the timeout toast fires (the spinner can no longer brick)", async () => {
		vi.useFakeTimers()
		try {
			unlockProfile.mockResolvedValue({ id: "p1", name: "P", type: "password" })
			const { wrapper } = mountAuth()
			await submitUnlock(wrapper)
			await vi.advanceTimersByTimeAsync(30_001) // isLogined never flips
			expect(openToastMock).toHaveBeenCalledWith(
				expect.objectContaining({ label: expect.stringContaining("timed out") }),
				expect.anything(),
			)
			// Latch released: a second submit reaches the service again.
			await submitUnlock(wrapper)
			expect(unlockProfile).toHaveBeenCalledTimes(2)
		} finally {
			vi.useRealTimers()
		}
	})

	test("bootstrap failure releases the waiter IMMEDIATELY — no timeout burn, no auth-side toast", async () => {
		unlockProfile.mockResolvedValue({ id: "p1", name: "P", type: "password" })
		const { wrapper, appStore } = mountAuth()
		await submitUnlock(wrapper)
		appStore.bootstrapFailure = { profileId: "p1", message: "rpc down" }
		await flushPromises() // real timers — release must not need the 30 s bound
		// The shell owns the failure toast; auth stays silent and just releases.
		expect(openToastMock).not.toHaveBeenCalled()
		await submitUnlock(wrapper)
		expect(unlockProfile).toHaveBeenCalledTimes(2) // latch was released
	})

	test("hijack: a different profile wins — silent yield, no toast, no continuation writes", async () => {
		vi.useFakeTimers()
		try {
			unlockProfile.mockResolvedValue({ id: "p1", name: "P", type: "password" })
			const { wrapper, appStore } = mountAuth()
			await submitUnlock(wrapper)
			appStore.profile = { id: "p2", name: "Q", type: "password" } as never
			appStore.isLogined = true
			await vi.advanceTimersByTimeAsync(30_001) // p1's wait can only time out
			expect(openToastMock).not.toHaveBeenCalled() // silent yield
			expect(initTransactionServiceMock).not.toHaveBeenCalled() // no continuation writes
		} finally {
			vi.useRealTimers()
		}
	})

	test("reentry guard: a second submit while the first awaits does not reach the service twice", async () => {
		let resolveUnlock!: (v: unknown) => void
		unlockProfile.mockReturnValue(new Promise((r) => (resolveUnlock = r)))
		const { wrapper } = mountAuth()
		await submitUnlock(wrapper)
		await submitUnlock(wrapper) // latch held — must be a no-op
		expect(unlockProfile).toHaveBeenCalledTimes(1)
		resolveUnlock(undefined)
	})

	test("post-setLastActiveProfileId drift: a resumed stale continuation replaces nothing", async () => {
		unlockProfile.mockResolvedValue({ id: "p1", name: "P", type: "password" })
		let releaseSetLast!: () => void
		setLastActiveProfileIdMock.mockReturnValue(new Promise<undefined>((r) => (releaseSetLast = () => r(undefined))))
		const { wrapper, appStore } = mountAuth()
		await submitUnlock(wrapper)
		appStore.profile = { id: "p1", name: "P", type: "password" } as never
		appStore.isLogined = true
		await flushPromises() // wait resolves; continuation parks in setLastActiveProfileId
		appStore.profile = { id: "p2", name: "Q", type: "password" } as never // drift
		releaseSetLast()
		await flushPromises()
		expect(initTransactionServiceMock).not.toHaveBeenCalled() // second check stood down
	})
})
