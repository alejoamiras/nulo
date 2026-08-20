/**
 * Component pins for NewNetworkPopup — the full-lifetime latch representative
 * of the submit re-entrancy sweep: `isCreating` used to clear right after
 * `addNetwork` while the activation + refresh awaits were still running, so a
 * re-entry DURING ACTIVATION could double-create. The latch now spans the
 * whole handler (cleared in finally).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"

const addNetworkMock = vi.fn()
const getNetworksMock = vi.fn()
const activateGuardedMock = vi.fn()
const openToastMock = vi.fn()

vi.mock("@/utils/core", () => ({
	managers: {
		network: {
			addNetwork: (...args: unknown[]) => addNetworkMock(...args),
			setActiveNetwork: vi.fn(),
			getActiveNetwork: vi.fn(),
			getNetworks: (...args: unknown[]) => getNetworksMock(...args),
		},
	},
}))
vi.mock("@/utils/guarded-network-activation", () => ({
	activateNetworkGuarded: (...args: unknown[]) => activateGuardedMock(...args),
}))
vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
	TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
}))
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({ networks: [], hasInFlightSend: false }),
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { new_network: { order: 1 } } }),
}))

const STUBS = {
	FormPopup: {
		props: ["show", "submitLabel", "submitDisabled", "submitLoading", "displaceIdx", "submitTestId", "title"],
		emits: ["onClose", "submit"],
		template: `<div :data-submit-disabled="String(submitDisabled)"><slot /><button data-testid="form-submit" :disabled="submitDisabled" @click="$emit('submit')">go</button></div>`,
	},
	Input: {
		props: ["modelValue", "label"],
		emits: ["update:modelValue"],
		template: `<label><input :data-input-label="label" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /><slot name="right" /></label>`,
	},
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Transition: { template: "<div><slot /></div>" },
}

import NewNetworkPopup from "./NewNetworkPopup.vue"

function pressEnterOnInput() {
	const el = document.createElement("input")
	document.body.appendChild(el)
	el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}

async function mountShown(): Promise<VueWrapper> {
	const w = mount(NewNetworkPopup, { props: { show: false }, global: { stubs: STUBS } })
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

async function fillForm(w: VueWrapper) {
	const inputs = w.findAll("input")
	await inputs[0].setValue("My Net")
	await inputs[1].setValue("https://rpc.example.com")
	await flushPromises()
}

beforeEach(() => {
	addNetworkMock.mockResolvedValue({ id: "net-9", chainId: 9 })
	getNetworksMock.mockResolvedValue([])
	activateGuardedMock.mockResolvedValue("activated")
})

afterEach(() => {
	vi.clearAllMocks()
	document.body.innerHTML = ""
})

describe("NewNetworkPopup — full-lifetime submit latch", () => {
	test("(RE-ENTRANCY PIN) Enter DURING THE ACTIVATION PHASE does not re-create — the latch spans the whole handler", async () => {
		// addNetwork resolves fast; the ACTIVATION await hangs. Pre-fix the
		// latch cleared right after addNetwork, so this exact window allowed a
		// second create.
		activateGuardedMock.mockImplementationOnce(() => new Promise(() => {}))
		const w = await mountShown()
		await fillForm(w)
		pressEnterOnInput()
		await flushPromises() // addNetwork resolved; activation in flight
		pressEnterOnInput()
		await flushPromises()
		const creates = addNetworkMock.mock.calls.length
		const disabledMidActivation = w.find("[data-submit-disabled]").attributes("data-submit-disabled")
		await dispose(w)
		expect(creates).toBe(1)
		expect(disabledMidActivation).toBe("true")
	})

	test("a DUPLICATE_CHAIN rejection releases the latch and surfaces the endpoint hint", async () => {
		addNetworkMock.mockRejectedValueOnce(new Error("DUPLICATE_CHAIN: 9"))
		const w = await mountShown()
		await fillForm(w)
		pressEnterOnInput()
		await flushPromises()
		expect(openToastMock).toHaveBeenCalledWith(
			expect.objectContaining({ label: expect.stringContaining("already exists") }),
			expect.anything(),
		)
		// The finally released the latch — the form is submittable again.
		expect(w.find("[data-submit-disabled]").attributes("data-submit-disabled")).toBe("false")
		await dispose(w)
	})
})
