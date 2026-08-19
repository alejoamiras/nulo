/**
 * Component pins for EditAccountPopup — the rejection→retry representative of
 * the submit re-entrancy sweep: its latch used to clear sequentially (never on
 * rejection), which under the folded validity source would have locked the
 * form disabled after one failed save. The latch now clears in `finally`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"

const updateAccountMock = vi.fn()
const openToastMock = vi.fn()

const appStoreState = {
	accounts: [{ name: "Vault", address: "0xa1" }],
	updateAccount: (...args: unknown[]) => updateAccountMock(...args),
}

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
	TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
}))
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => appStoreState,
}))
vi.mock("@/stores/cache.store", () => ({
	useCacheStore: () => ({ accountToEditIdx: "0xa1" }),
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { edit_account: { order: 1 } } }),
}))

const STUBS = {
	FormPopup: {
		props: ["show", "submitLabel", "submitDisabled", "submitLoading", "displaceIdx", "submitTestId", "title"],
		emits: ["onClose", "submit"],
		template: `<div :data-submit-disabled="String(submitDisabled)"><slot /><button data-testid="form-submit" :disabled="submitDisabled" @click="$emit('submit')">go</button><slot name="belowSubmit" /></div>`,
	},
	Input: {
		props: ["modelValue"],
		emits: ["update:modelValue"],
		// The real template's data-testid falls through to this stub's ROOT, so
		// the inner input needs its own distinct handle.
		template: `<label><input data-testid="stub-name-field" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /></label>`,
	},
	Button: { template: "<button><slot /></button>" },
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
}

import EditAccountPopup from "./EditAccountPopup.vue"

function pressEnterOnInput() {
	const el = document.createElement("input")
	document.body.appendChild(el)
	el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}

async function mountShown(): Promise<VueWrapper> {
	const w = mount(EditAccountPopup, { props: { show: false }, global: { stubs: STUBS } })
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

/** Hide-then-unmount: usePopupEntity removes its document listener only on
 *  show → false, so tests must hide first or the listener leaks. */
async function dispose(w: VueWrapper) {
	await w.setProps({ show: false })
	w.unmount()
}

beforeEach(() => {
	updateAccountMock.mockResolvedValue(undefined)
})

afterEach(() => {
	vi.clearAllMocks()
	document.body.innerHTML = ""
})

describe("EditAccountPopup — submit latch lifecycle", () => {
	test("(RE-ENTRANCY PIN) repeated Enter during an in-flight update fires updateAccount ONCE", async () => {
		updateAccountMock.mockImplementationOnce(() => new Promise(() => {}))
		const w = await mountShown()
		await w.find('[data-testid="stub-name-field"]').setValue("Renamed")
		pressEnterOnInput()
		await flushPromises()
		pressEnterOnInput()
		await flushPromises()
		const calls = updateAccountMock.mock.calls.length
		await dispose(w)
		expect(calls).toBe(1)
	})

	test("a REJECTED update releases the latch — the form re-enables and a retry submits again", async () => {
		updateAccountMock.mockRejectedValueOnce(new Error("rpc down"))
		const w = await mountShown()
		await w.find('[data-testid="stub-name-field"]').setValue("Renamed")
		pressEnterOnInput()
		await flushPromises()
		// The rejection must not leave the folded validity source latched: the
		// submit button is enabled again…
		expect(w.find("[data-submit-disabled]").attributes("data-submit-disabled")).toBe("false")
		// …and a retry goes through.
		pressEnterOnInput()
		await flushPromises()
		const calls = updateAccountMock.mock.calls.length
		await dispose(w)
		expect(calls).toBe(2)
	})
})
