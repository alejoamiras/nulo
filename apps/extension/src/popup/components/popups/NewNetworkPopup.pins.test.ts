/**
 * Pre-extraction outcome pins for NewNetworkPopup's create handler (codex conditions; the sibling
 * suite pins re-entrancy and DUPLICATE_CHAIN): every `activateNetworkGuarded` outcome — toast text
 * + icon (or silence), the networks refresh, the close, and their ORDER — plus the two node-info
 * fetch failures, the generic failure and the in-flight-send refusal.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"

const addNetworkMock = vi.fn()
const getNetworksMock = vi.fn()
const activateGuardedMock = vi.fn()
const openToastMock = vi.fn()
const trace: string[] = []
const appStoreState = { networks: [] as unknown[], hasInFlightSend: false }

vi.mock("@/utils/core", () => ({
	managers: {
		network: {
			addNetwork: (...args: unknown[]) => addNetworkMock(...args),
			setActiveNetwork: vi.fn(),
			getActiveNetwork: vi.fn(),
			getNetworks: (...args: unknown[]) => {
				trace.push("getNetworks")
				return getNetworksMock(...args)
			},
		},
	},
}))
vi.mock("@/utils/guarded-network-activation", () => ({
	activateNetworkGuarded: (...args: unknown[]) => activateGuardedMock(...args),
}))
vi.mock("@/composables/toast", () => ({
	useToast: () => ({
		openToast: (...args: unknown[]) => {
			trace.push(`toast:${(args[0] as { label: string }).label}`)
			return openToastMock(...args)
		},
	}),
	TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => appStoreState }))
vi.mock("@/stores/popup.store", () => ({ usePopupStore: () => ({ len: 1, popups: { new_network: { order: 1 } } }) }))

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

const wrappers: VueWrapper[] = []

async function mountFilled(): Promise<VueWrapper> {
	const w = mount(NewNetworkPopup, { props: { show: false, onOnClose: () => trace.push("close") }, global: { stubs: STUBS } })
	wrappers.push(w)
	await w.setProps({ show: true })
	await flushPromises()
	const inputs = w.findAll("input")
	await inputs[0].setValue("My Net")
	await inputs[1].setValue("https://rpc.example.com")
	await flushPromises()
	return w
}

async function submit(w: VueWrapper) {
	await w.find("[data-testid='form-submit']").trigger("click")
	await flushPromises()
}

beforeEach(() => {
	trace.length = 0
	appStoreState.hasInFlightSend = false
	addNetworkMock.mockResolvedValue({ id: "net-9", chainId: 9 })
	getNetworksMock.mockResolvedValue([{ id: "net-9", endpoints: [] }])
	activateGuardedMock.mockResolvedValue("activated")
})
afterEach(() => {
	for (const w of wrappers.splice(0)) {
		try {
			w.unmount()
		} catch {
			/* already unmounted */
		}
	}
	vi.clearAllMocks()
	document.body.innerHTML = ""
})

describe("NewNetworkPopup — activation outcomes", () => {
	test("activated: refresh → close → 'Network is created'", async () => {
		const w = await mountFilled()
		await submit(w)
		expect(trace).toEqual(["getNetworks", "close", "toast:Network is created"])
		expect(appStoreState.networks).toEqual([{ id: "net-9", endpoints: [] }])
	})

	test("blocked: info toast → refresh → close, no 'created' toast", async () => {
		activateGuardedMock.mockResolvedValueOnce("blocked")
		const w = await mountFilled()
		await submit(w)
		expect(trace).toEqual(["toast:Network added. Finish or cancel your pending transaction to switch to it", "getNetworks", "close"])
		expect(openToastMock).toHaveBeenCalledWith(expect.objectContaining({ icon: "info" }), 4_000)
	})

	test("unconfirmed: warning toast → refresh → close", async () => {
		activateGuardedMock.mockResolvedValueOnce("unconfirmed")
		const w = await mountFilled()
		await submit(w)
		expect(trace).toEqual(["toast:Network added, but the switch didn't confirm — reopen the popup to verify", "getNetworks", "close"])
		expect(openToastMock).toHaveBeenCalledWith(expect.objectContaining({ icon: "warning" }), 4_000)
	})

	test("stale: silent refresh → close", async () => {
		activateGuardedMock.mockResolvedValueOnce("stale")
		const w = await mountFilled()
		await submit(w)
		expect(trace).toEqual(["getNetworks", "close"])
		expect(openToastMock).not.toHaveBeenCalled()
	})
})

describe("NewNetworkPopup — failures and refusals", () => {
	test.each(["Failed to fetch node info", "Failed to fetch network info"])("'%s' marks the URL field, no toast", async (msg) => {
		addNetworkMock.mockRejectedValueOnce(new Error(msg))
		const w = await mountFilled()
		await submit(w)
		expect(openToastMock).not.toHaveBeenCalled()
		expect((w.vm as unknown as { isUrlHasError: boolean }).isUrlHasError).toBe(true)
		expect(trace).toEqual([])
	})

	test("any other failure: 'Something went wrong' (warning), no refresh, no close", async () => {
		addNetworkMock.mockRejectedValueOnce(new Error("rpc exploded"))
		const w = await mountFilled()
		await submit(w)
		expect(trace).toEqual(["toast:Something went wrong"])
		expect(openToastMock).toHaveBeenCalledWith(expect.objectContaining({ icon: "warning" }), 4000)
	})

	test("an in-flight send refuses before creating anything", async () => {
		appStoreState.hasInFlightSend = true
		const w = await mountFilled()
		await submit(w)
		expect(addNetworkMock).not.toHaveBeenCalled()
		expect(trace).toEqual(["toast:Finish or cancel your pending transaction first"])
	})
})
