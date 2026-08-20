/**
 * Component pins for NewAccountPopup — the severe instance of the submit
 * re-entrancy class: it had NO in-flight latch at all, and its name-uniqueness
 * check is synchronous against a post-await `accounts.push`, so two concurrent
 * submits could both pass "Already exist" and create two same-named accounts.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"

const createAccountMock = vi.fn()
const commitScopeChangeMock = vi.fn()
const storageLocalSetMock = vi.fn()
const openToastMock = vi.fn()

const appStoreState: {
	profile: { id: string }
	network: { chainId: number }
	accounts: Array<{ name: string; address: string }>
	account: unknown
	hasInFlightSend: boolean
	commitScopeChange: (fn: () => void) => Promise<boolean>
} = {
	profile: { id: "p1" },
	network: { chainId: 1 },
	accounts: [],
	account: undefined,
	hasInFlightSend: false,
	commitScopeChange: (fn) => {
		fn()
		return commitScopeChangeMock()
	},
}

vi.mock("@/utils/core", () => ({
	managers: {
		account: { createAccount: (...args: unknown[]) => createAccountMock(...args) },
	},
}))
vi.mock("@/utils/storage", () => ({
	storageLocalSet: (...args: unknown[]) => storageLocalSetMock(...args),
}))
vi.mock("@/wallet/services/account/client", () => ({
	AccountType: { Nulo_v1: "nulo_v1" },
}))
vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
}))
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => appStoreState,
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { new_account: { order: 1 } } }),
}))

const STUBS = {
	FormPopup: {
		props: ["show", "submitLabel", "submitDisabled", "submitLoading", "displaceIdx", "submitTestId", "title"],
		emits: ["onClose", "submit"],
		template: `<div :data-submit-loading="String(submitLoading)"><slot /><button data-testid="form-submit" :disabled="submitDisabled" @click="$emit('submit')">go</button></div>`,
	},
	Input: {
		props: ["modelValue"],
		emits: ["update:modelValue"],
		// The real Input exposes an inner `inputEl` the popup focuses on show.
		data: () => ({ inputEl: { focus: () => {} } }),
		template: `<label><input data-testid="account-name-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /><slot name="right" /></label>`,
	},
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Transition: { template: "<div><slot /></div>" },
}

import NewAccountPopup from "./NewAccountPopup.vue"

function pressEnterOnInput() {
	const el = document.createElement("input")
	document.body.appendChild(el)
	el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}

async function mountShown(): Promise<VueWrapper> {
	const w = mount(NewAccountPopup, { props: { show: false }, global: { stubs: STUBS } })
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

/** Plain unmount suffices since usePopupEntity's scope cleanup removes the
 *  document listener; onHide side effects are NOT run here — tests that need
 *  them hide explicitly. */
async function dispose(w: VueWrapper) {
	w.unmount()
}

beforeEach(() => {
	appStoreState.accounts = []
	appStoreState.hasInFlightSend = false
	createAccountMock.mockResolvedValue({ name: "Account 1", address: "0xacct" })
	commitScopeChangeMock.mockResolvedValue(true)
	storageLocalSetMock.mockResolvedValue(undefined)
})

afterEach(() => {
	vi.clearAllMocks()
	document.body.innerHTML = ""
})

describe("NewAccountPopup — submit re-entrancy latch", () => {
	test("(RE-ENTRANCY PIN) rapid dual-route submit creates ONE account: one RPC, one push", async () => {
		// Hang the create RPC, fire BOTH routes (Enter + button click) while it
		// is in flight, then resolve — exactly one account may exist.
		let resolveCreate!: (v: unknown) => void
		createAccountMock.mockImplementationOnce(() => new Promise((r) => (resolveCreate = r)))
		const w = await mountShown()

		pressEnterOnInput() // route 1: starts the create (auto-name is prefilled on show)
		await flushPromises()
		pressEnterOnInput() // route 2a: Enter re-press mid-flight
		await w.find('[data-testid="form-submit"]').trigger("click") // route 2b: click mid-flight
		await flushPromises()

		resolveCreate({ name: "Account 1", address: "0xacct" })
		await flushPromises()

		const calls = createAccountMock.mock.calls.length
		const pushed = appStoreState.accounts.length
		await dispose(w)
		expect(calls).toBe(1)
		expect(pushed).toBe(1)
	})

	test("the latch clears after a successful create (a later intent can submit again)", async () => {
		const w = await mountShown()
		pressEnterOnInput()
		await flushPromises()
		expect(createAccountMock).toHaveBeenCalledTimes(1)
		// The popup closed (onClose emitted); the latch must not stay stuck.
		expect(w.emitted("onClose")).toBeTruthy()
		expect(w.find("[data-submit-loading]").attributes("data-submit-loading")).toBe("false")
		await dispose(w)
	})
})
