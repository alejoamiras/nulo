/**
 * Pins-first harness for NewFpcPopup (written BEFORE its migration onto
 * usePopupEntity; every pin must hold unchanged across it). The
 * initialization-window pin is the load-bearing one: today the keydown
 * listener installs AFTER the getFpcs await, so an Enter during population is
 * inert — the migration preserves that timing via `submitWaitsForShow`.
 *
 * Cleanup is a guaranteed afterEach (tracked wrappers, hide-then-unmount so it
 * is correct both pre-migration (hide removes the listener) and post-migration
 * (scope teardown does).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"

const fpcServiceMock = {
	addFpc: vi.fn(),
	getFpcs: vi.fn(),
	disconnect: vi.fn(),
	onFpcAdded: { add: vi.fn(), remove: vi.fn() },
	onFpcUpdated: { add: vi.fn(), remove: vi.fn() },
	onFpcDeleted: { add: vi.fn(), remove: vi.fn() },
}
const openToastMock = vi.fn()

// Vitest requires `function` expressions (not arrows) for mocks used with `new`.
vi.mock("@/wallet/services/fpc/client", () => ({
	FpcServiceClient: vi.fn(function () {
		return fpcServiceMock
	}),
	FpcType: { DefaultSponsoredFpc: "default_sponsored" },
}))
vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
	TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
}))
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({ network: { id: "net-1", chainId: 1 } }),
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { new_fpc: { order: 1 } } }),
}))

const STUBS = {
	FormPopup: {
		props: ["show", "submitLabel", "submitDisabled", "submitLoading", "displaceIdx", "submitTestId", "title"],
		emits: ["onClose", "submit"],
		template: `<div :data-submit-disabled="String(submitDisabled)"><slot /><button data-testid="form-submit" :disabled="submitDisabled" @click="$emit('submit')">go</button><slot name="belowSubmit" /></div>`,
	},
	Input: {
		props: ["modelValue", "label"],
		emits: ["update:modelValue"],
		template: `<label><input :data-input-label="label" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /><slot name="right" /></label>`,
	},
	Tooltip: { template: "<div><slot /><slot name='content' /></div>" },
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Transition: { template: "<div><slot /></div>" },
}

import NewFpcPopup from "./NewFpcPopup.vue"

const VALID_HEX = `0x${"b".repeat(64)}`

function pressEnterOnInput() {
	const el = document.createElement("input")
	document.body.appendChild(el)
	el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}
function pressEnterOnBody() {
	document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}

const wrappers: VueWrapper[] = []

async function mountShown(): Promise<VueWrapper> {
	const w = mount(NewFpcPopup, { props: { show: false }, global: { stubs: STUBS } })
	wrappers.push(w)
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

async function fillForm(w: VueWrapper) {
	const inputs = w.findAll("input")
	await inputs[0].setValue("My FPC")
	await inputs[1].setValue(VALID_HEX)
	await flushPromises()
}

beforeEach(() => {
	fpcServiceMock.getFpcs.mockResolvedValue([])
	fpcServiceMock.addFpc.mockResolvedValue(undefined)
})

// Guaranteed cleanup — runs even when an assertion throws mid-test.
afterEach(async () => {
	for (const w of wrappers.splice(0)) {
		await w.setProps({ show: false })
		w.unmount()
	}
	vi.clearAllMocks()
	document.body.innerHTML = ""
})

describe("NewFpcPopup — Enter wiring + initialization window", () => {
	test("Enter while an input is focused submits (addFpc called)", async () => {
		const w = await mountShown()
		await fillForm(w)
		pressEnterOnInput()
		await flushPromises()
		expect(fpcServiceMock.addFpc).toHaveBeenCalledWith("net-1", "default_sponsored", VALID_HEX, "My FPC")
		expect(w.emitted("onClose")).toBeTruthy()
	})

	test("a global Enter (body focused) does NOT submit", async () => {
		const w = await mountShown()
		await fillForm(w)
		pressEnterOnBody()
		await flushPromises()
		expect(fpcServiceMock.addFpc).not.toHaveBeenCalled()
	})

	test("(INIT-WINDOW PIN) Enter during the pending getFpcs population is INERT", async () => {
		// Today the listener installs after the await; post-migration
		// `submitWaitsForShow` must reproduce exactly this.
		fpcServiceMock.getFpcs.mockImplementationOnce(() => new Promise(() => {}))
		const w = await mountShown() // population hangs
		await fillForm(w)
		pressEnterOnInput()
		await flushPromises()
		expect(fpcServiceMock.addFpc).not.toHaveBeenCalled()
	})

	test("(RE-ENTRANCY PIN) repeated Enter during an in-flight add fires addFpc ONCE", async () => {
		fpcServiceMock.addFpc.mockImplementationOnce(() => new Promise(() => {}))
		const w = await mountShown()
		await fillForm(w)
		pressEnterOnInput()
		await flushPromises()
		pressEnterOnInput()
		await flushPromises()
		expect(fpcServiceMock.addFpc).toHaveBeenCalledTimes(1)
	})

	test("after hide, Enter is inert (listener removed) and the client disconnected", async () => {
		const w = await mountShown()
		await fillForm(w)
		await w.setProps({ show: false })
		expect(fpcServiceMock.disconnect).toHaveBeenCalledTimes(1)
		pressEnterOnInput()
		await flushPromises()
		expect(fpcServiceMock.addFpc).not.toHaveBeenCalled()
	})
})
