/**
 * Pins-first harness for EditFpcPopup (written BEFORE its migration onto
 * usePopupEntity; every pin must hold unchanged across it). Load-bearing pins:
 * the initialization window (listener installs after the population awaits
 * today — `submitWaitsForShow` must reproduce it) and the missing-row close.
 *
 * Cleanup is a guaranteed afterEach (tracked wrappers, hide-then-unmount) so
 * it is correct both pre- and post-migration.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"

const fpcServiceMock = {
	getFpc: vi.fn(),
	getFpcs: vi.fn(),
	updateFpc: vi.fn(),
	updateFpcAddress: vi.fn(),
	disconnect: vi.fn(),
	onFpcAdded: { add: vi.fn(), remove: vi.fn() },
	onFpcUpdated: { add: vi.fn(), remove: vi.fn() },
	onFpcDeleted: { add: vi.fn(), remove: vi.fn() },
}
const openToastMock = vi.fn()

const FPC = { id: "fpc-1", name: "Sponsor", address: `0x${"c".repeat(64)}`, isProtocol: false, type: "default_sponsored" }

// Vitest requires `function` expressions (not arrows) for mocks used with `new`.
vi.mock("@/wallet/services/fpc/client", () => ({
	FpcServiceClient: vi.fn(function () {
		return fpcServiceMock
	}),
	FpcType: { DefaultSponsoredFpc: "default_sponsored", PrivateFpc: "private" },
}))
vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
	TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
}))
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({ network: { id: "net-1", chainId: 1 } }),
}))
vi.mock("@/stores/cache.store", () => ({
	useCacheStore: () => ({ fpcToEditIdx: "fpc-1" }),
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { edit_fpc: { order: 1 } } }),
}))

const STUBS = {
	FormPopup: {
		props: ["show", "submitLabel", "submitDisabled", "submitLoading", "displaceIdx", "submitTestId", "title"],
		emits: ["onClose", "submit"],
		template: `<div :data-submit-disabled="String(submitDisabled)"><slot /><button data-testid="form-submit" :disabled="submitDisabled" @click="$emit('submit')">go</button><slot name="belowSubmit" /></div>`,
	},
	Input: {
		props: ["modelValue", "label", "disabled"],
		emits: ["update:modelValue"],
		template: `<label><input :data-input-label="label" :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', $event.target.value)" /><slot name="right" /></label>`,
	},
	SettingItem: { props: ["title", "description", "icon", "size", "raw"], template: "<div />" },
	ItemsContainer: { template: "<div><slot /></div>" },
	Tooltip: { template: "<div><slot /><slot name='content' /></div>" },
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Transition: { template: "<div><slot /></div>" },
}

import EditFpcPopup from "./EditFpcPopup.vue"

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
	const w = mount(EditFpcPopup, { props: { show: false }, global: { stubs: STUBS } })
	wrappers.push(w)
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

async function typeName(w: VueWrapper, name: string) {
	const input = w.findAll("input").find((i) => i.attributes("data-input-label") === "Name")
	if (!input) throw new Error("Name input not rendered")
	await input.setValue(name)
	await flushPromises()
}

beforeEach(() => {
	fpcServiceMock.getFpc.mockResolvedValue({ ...FPC })
	fpcServiceMock.getFpcs.mockResolvedValue([{ ...FPC }])
	fpcServiceMock.updateFpc.mockResolvedValue(undefined)
	fpcServiceMock.updateFpcAddress.mockResolvedValue(undefined)
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

describe("EditFpcPopup — Enter wiring + initialization window", () => {
	test("show populates the row and prefills the name field", async () => {
		const w = await mountShown()
		expect(fpcServiceMock.getFpc).toHaveBeenCalledWith("fpc-1")
		const input = w.findAll("input").find((i) => i.attributes("data-input-label") === "Name")
		expect((input?.element as HTMLInputElement).value).toBe("Sponsor")
	})

	test("a MISSING row closes the popup instead of rendering a dead form", async () => {
		fpcServiceMock.getFpc.mockResolvedValueOnce(null)
		const w = await mountShown()
		expect(w.emitted("onClose")).toBeTruthy()
	})

	test("Enter while an input is focused submits a name change (updateFpc called)", async () => {
		const w = await mountShown()
		await typeName(w, "Renamed")
		pressEnterOnInput()
		await flushPromises()
		expect(fpcServiceMock.updateFpc).toHaveBeenCalledWith("fpc-1", "Renamed")
		expect(w.emitted("onClose")).toBeTruthy()
	})

	test("a global Enter (body focused) does NOT submit", async () => {
		const w = await mountShown()
		await typeName(w, "Renamed")
		pressEnterOnBody()
		await flushPromises()
		expect(fpcServiceMock.updateFpc).not.toHaveBeenCalled()
	})

	test("(INIT-WINDOW PIN) Enter during the pending population is INERT", async () => {
		fpcServiceMock.getFpc.mockImplementationOnce(() => new Promise(() => {}))
		const w = await mountShown() // population hangs at getFpc
		pressEnterOnInput()
		await flushPromises()
		expect(fpcServiceMock.updateFpc).not.toHaveBeenCalled()
		expect(fpcServiceMock.updateFpcAddress).not.toHaveBeenCalled()
	})

	test("(RE-ENTRANCY PIN) repeated Enter during an in-flight update fires updateFpc ONCE", async () => {
		fpcServiceMock.updateFpc.mockImplementationOnce(() => new Promise(() => {}))
		const w = await mountShown()
		await typeName(w, "Renamed")
		pressEnterOnInput()
		await flushPromises()
		pressEnterOnInput()
		await flushPromises()
		expect(fpcServiceMock.updateFpc).toHaveBeenCalledTimes(1)
	})

	test("after hide, Enter is inert and the client disconnected", async () => {
		const w = await mountShown()
		await typeName(w, "Renamed")
		await w.setProps({ show: false })
		expect(fpcServiceMock.disconnect).toHaveBeenCalledTimes(1)
		pressEnterOnInput()
		await flushPromises()
		expect(fpcServiceMock.updateFpc).not.toHaveBeenCalled()
	})
})
