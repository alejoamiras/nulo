/**
 * Component tests for RevokeAuthwitsPopup's keyboard contract. No document-level Enter revokes: a key
 * on the header's ×, the fee card, a teleported menu item, a popup layered over this one or nothing
 * focused does only its own thing. The focused Revoke button is the one keyboard path, and a repeat or
 * composing Enter that first lands on it idle revokes nothing.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { createApp, h, nextTick, ref } from "vue"
import { usePopupEntity } from "@/composables/usePopupEntity"
import { pressOn } from "../../../../tests/helpers/press-key"

const authwitsServiceMock = {
	getRegistryEnabled: vi.fn(),
	revokeAuthwits: vi.fn(),
	disconnect: vi.fn(),
	onRegistryEnabled: { add: vi.fn(), remove: vi.fn() },
	onRegistryDisabled: { add: vi.fn(), remove: vi.fn() },
}

const openToastMock = vi.fn()
const popupOpenMock = vi.fn()
const feeControlClick = vi.fn()
const preselected = { preselectedAuthwits: [] as { id: string; content: string }[] }

vi.mock("@/wallet/services/auth-registry/client", () => ({
	AuthRegistryServiceClient: vi.fn(function () {
		return authwitsServiceMock
	}),
	MAX_REVOKES_PER_TX: 8,
}))

vi.mock("@/popup/utils/cancellable-rejection", () => ({
	classifyCancellableRejection: () => "fail",
}))

vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({
		network: { id: "net-1" },
		account: { address: "0xacct" },
		profile: { id: "p1" },
	}),
}))

vi.mock("@/stores/cache.store", () => ({
	useCacheStore: () => preselected,
}))

vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({
		popups: { revoke_authwits: { order: 1 } },
		len: 1,
		open: popupOpenMock,
	}),
}))

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
}))

const STUBS = {
	Popup: { props: ["show", "displaceIdx"], template: `<div v-if="show"><slot /></div>` },
	PopupCard: { template: "<div><slot /></div>" },
	PopupHeader: {
		emits: ["onClose"],
		template: `<div><slot name='title' /><button type="button" data-testid="popup-close-btn" @click="$emit('onClose')">×</button></div>`,
	},
	Banner: { template: "<div />" },
	FeeSettingsCard: {
		props: ["profile", "network", "account", "modelValue"],
		emits: ["update:modelValue"],
		setup: () => ({ feeControlClick }),
		// Single button per chunk that emits a fee. Tests can target by index.
		template: `<button class="set-fee" @click="feeControlClick(); $emit('update:modelValue', { gasLimit: 100 })">fee</button>`,
	},
	Button: {
		props: ["loading", "disabled"],
		// The stub mirrors the REAL primitive: only `disabled` sets the native
		// attribute (loading alone is CSS pointer-events). A `disabled || loading`
		// stub previously masked the template's missing isLoading in :disabled.
		template: `<button data-testid="revoke-authwits-submit" :disabled="disabled"><slot /></button>`,
	},
	Tooltip: { template: "<div><slot /><slot name='content' /></div>" },
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
}

import { RowAction } from "@nulo/design"
import RevokeAuthwitsPopup from "./RevokeAuthwitsPopup.vue"

// Every mounted wrapper, hidden and unmounted after each test.
const wrappers: ReturnType<typeof mount>[] = []
const cleanups: Array<() => void> = []

const nestedSubmit = vi.fn()
/** Shows a form popup with one field over the sheet under test, in an app of its own: a second VTU
 *  mount would drop the sheet's stubs, as VTU's vnode transform is global. */
async function showNestedFormPopup(): Promise<HTMLInputElement> {
	const show = ref(false)
	const app = createApp({
		setup() {
			usePopupEntity(() => show.value, { submit: nestedSubmit })
			return () => h("input")
		},
	})
	const host = document.body.appendChild(document.createElement("div"))
	app.mount(host)
	cleanups.push(() => app.unmount())
	show.value = true
	await nextTick()
	return host.querySelector("input") as HTMLInputElement
}

async function mountAndOpen(authwits: { id: string; content: string }[] = [{ id: "aw-1", content: "c1" }]) {
	preselected.preselectedAuthwits = authwits
	authwitsServiceMock.getRegistryEnabled.mockResolvedValueOnce(true)
	const w = mount(RevokeAuthwitsPopup, {
		props: { show: false },
		global: { stubs: STUBS, components: { RowAction } },
		attachTo: document.body,
	})
	wrappers.push(w)
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

async function setAllFees(w: ReturnType<typeof mount>) {
	const feeBtns = w.findAll(".set-fee")
	for (const btn of feeBtns) await btn.trigger("click")
}

const submitButton = (w: ReturnType<typeof mount>) => w.get('[data-testid="revoke-authwits-submit"]').element as HTMLElement

beforeEach(() => {
	authwitsServiceMock.getRegistryEnabled.mockReset()
	authwitsServiceMock.revokeAuthwits.mockReset().mockResolvedValue(undefined)
	authwitsServiceMock.disconnect.mockReset()
	openToastMock.mockReset()
	popupOpenMock.mockReset()
	feeControlClick.mockReset()
	nestedSubmit.mockReset()
	preselected.preselectedAuthwits = []
})

afterEach(async () => {
	for (const w of wrappers) {
		await w.setProps({ show: false })
		await flushPromises()
		w.unmount()
	}
	wrappers.length = 0
	for (const c of cleanups.splice(0)) c()
	document.body.innerHTML = ""
})

describe("RevokeAuthwitsPopup — the content button", () => {
	test.each(["Enter", " "] as const)(
		"a named button: %j on it opens the content once and revokes nothing, though a revoke is ready",
		async (key) => {
			const w = await mountAndOpen([{ id: "aw-1", content: "c1" }])
			await setAllFees(w)
			const view = w.get('[data-testid="revoke-authwits-view-content"]')
			expect(view.element.tagName).toBe("BUTTON")
			expect(view.attributes("aria-label")).toBe("View authwits content")

			expect(pressOn(view.element as HTMLElement, key)).not.toContain(false)
			await flushPromises()
			expect(popupOpenMock).toHaveBeenCalledTimes(1)
			expect(popupOpenMock).toHaveBeenCalledWith("data_viewer")
			expect(preselected).toMatchObject({ viewerData: ["c1"] })
			expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
		},
	)
})

describe("RevokeAuthwitsPopup — Enter elsewhere revokes nothing, though a revoke is ready", () => {
	test("Enter on the header's close button closes the popup once", async () => {
		const w = await mountAndOpen()
		await setAllFees(w)
		pressOn(w.get('[data-testid="popup-close-btn"]').element as HTMLElement, "Enter")
		await flushPromises()
		expect(w.emitted("onClose")).toHaveLength(1)
		expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
	})

	test("Enter on a control inside the fee card runs that control", async () => {
		const w = await mountAndOpen()
		await setAllFees(w)
		feeControlClick.mockClear()
		pressOn(w.get(".set-fee").element as HTMLElement, "Enter")
		await flushPromises()
		expect(feeControlClick).toHaveBeenCalledTimes(1)
		expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
	})

	test("Enter on an element outside the popup, as a teleported menu item, runs that element", async () => {
		const w = await mountAndOpen()
		await setAllFees(w)
		const item = document.createElement("div")
		item.setAttribute("data-dropdown-item", "")
		item.tabIndex = 0
		const itemClick = vi.fn()
		item.addEventListener("click", itemClick)
		document.body.appendChild(item)
		pressOn(item, "Enter")
		await flushPromises()
		expect(itemClick).toHaveBeenCalledTimes(1)
		expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
	})

	test("Enter with nothing focused", async () => {
		const w = await mountAndOpen()
		await setAllFees(w)
		expect(document.activeElement).toBe(document.body)
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
	})

	test("Enter in the field of a form popup shown over this one submits that popup once", async () => {
		const w = await mountAndOpen()
		await setAllFees(w)
		pressOn(await showNestedFormPopup(), "Enter")
		await flushPromises()
		expect(nestedSubmit).toHaveBeenCalledTimes(1)
		expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
	})

	test("repeat-only Enter keydowns that first land on the idle, focused Revoke button", async () => {
		const w = await mountAndOpen()
		await setAllFees(w)
		for (let i = 0; i < 3; i++) pressOn(submitButton(w), "Enter", { repeat: true })
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
	})

	test.each([
		["isComposing", { isComposing: true }],
		["keyCode 229 with isComposing false", { keyCode: 229, isComposing: false }],
	] as const)("a composing Enter (%s) on the idle, focused Revoke button", async (_name, init) => {
		const w = await mountAndOpen()
		await setAllFees(w)
		pressOn(submitButton(w), "Enter", init)
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
	})
})

describe("RevokeAuthwitsPopup — the Revoke button", () => {
	test.each(["Enter", " "] as const)("%j on the focused Revoke button revokes once", async (key) => {
		const w = await mountAndOpen()
		await setAllFees(w)
		expect(pressOn(submitButton(w), key)).not.toContain(false)
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).toHaveBeenCalledTimes(1)
	})

	test("a held Enter on the focused Revoke button revokes once", async () => {
		let resolveRevoke: (v?: unknown) => void = () => {}
		authwitsServiceMock.revokeAuthwits.mockReturnValueOnce(new Promise((r) => (resolveRevoke = r)))
		const w = await mountAndOpen()
		await setAllFees(w)
		pressOn(submitButton(w), "Enter")
		await flushPromises()
		for (let i = 0; i < 3; i++) pressOn(submitButton(w), "Enter", { repeat: true })
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).toHaveBeenCalledTimes(1)
		resolveRevoke()
	})

	test("a press before every chunk has a fee revokes nothing", async () => {
		const w = await mountAndOpen()
		pressOn(submitButton(w), "Enter")
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
		expect(w.find('[data-testid="revoke-authwits-submit"]').attributes("disabled")).toBeDefined()
	})

	test("(REGRESSION-PIN) a second press while the revoke is in flight revokes nothing", async () => {
		let resolveRevoke: (v?: unknown) => void = () => {}
		authwitsServiceMock.revokeAuthwits.mockReturnValueOnce(new Promise((r) => (resolveRevoke = r)))
		const w = await mountAndOpen()
		await setAllFees(w)
		pressOn(submitButton(w), "Enter")
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).toHaveBeenCalledTimes(1)
		pressOn(submitButton(w), "Enter")
		pressOn(submitButton(w), " ")
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).toHaveBeenCalledTimes(1)
		// The stub forwards only `disabled`, so this proves the template's :disabled includes isLoading.
		expect(w.find('[data-testid="revoke-authwits-submit"]').attributes("disabled")).toBeDefined()
		resolveRevoke()
	})

	test("(REGRESSION-PIN) an error keeps the Revoke button disabled and a press revokes nothing", async () => {
		// The registry fetch's failure sets `error`, which the button's :disabled reads.
		preselected.preselectedAuthwits = [{ id: "aw-1", content: "c1" }]
		authwitsServiceMock.getRegistryEnabled.mockRejectedValueOnce(new Error("PXE down"))
		const w = mount(RevokeAuthwitsPopup, {
			props: { show: false },
			global: { stubs: STUBS, components: { RowAction } },
			attachTo: document.body,
		})
		wrappers.push(w)
		await w.setProps({ show: true })
		await flushPromises()
		await setAllFees(w)
		expect(w.find('[data-testid="revoke-authwits-submit"]').attributes("disabled")).toBeDefined()
		pressOn(submitButton(w), "Enter")
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).not.toHaveBeenCalled()
	})

	test("a click on the Revoke button revokes once", async () => {
		const w = await mountAndOpen()
		await setAllFees(w)
		await w.find('[data-testid="revoke-authwits-submit"]').trigger("click")
		await flushPromises()
		expect(authwitsServiceMock.revokeAuthwits).toHaveBeenCalledTimes(1)
	})
})
