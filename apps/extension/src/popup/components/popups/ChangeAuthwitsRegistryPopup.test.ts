/**
 * Component tests for ChangeAuthwitsRegistryPopup's keyboard contract. No document-level Enter sends
 * the toggle: a key on the header's ×, the fee card, a teleported menu item, a popup layered over this
 * one or nothing focused does only its own thing. The focused Send button is the one keyboard path,
 * and a repeat or composing Enter that first lands on it idle sends nothing.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { createApp, h, nextTick, ref } from "vue"
import { usePopupEntity } from "@/composables/usePopupEntity"

const authwitsServiceMock = {
	getRegistryEnabled: vi.fn(),
	setRegistryEnabled: vi.fn(),
	disconnect: vi.fn(),
	onRegistryEnabled: { add: vi.fn(), remove: vi.fn() },
	onRegistryDisabled: { add: vi.fn(), remove: vi.fn() },
}

const openToastMock = vi.fn()
const feeControlClick = vi.fn()

// Vitest 4 requires function expressions (not arrows) for `new`-constructed mocks.
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

vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({
		popups: { change_authwits_registry: { order: 1 } },
		len: 1,
	}),
}))

vi.mock("@/composables/toast", () => ({
	useToast: () => ({
		openToast: openToastMock,
	}),
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
		template: `<button data-testid="set-fee" @click="feeControlClick(); $emit('update:modelValue', { gasLimit: 100 })">fee</button>`,
	},
	Button: {
		props: ["loading", "disabled"],
		// As the real primitive: only `disabled` sets the native attribute.
		template: `<button data-testid="registry-toggle-submit" :disabled="disabled"><slot /></button>`,
	},
	Tooltip: { template: "<div><slot /><slot name='content' /></div>" },
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
}

import ChangeAuthwitsRegistryPopup from "./ChangeAuthwitsRegistryPopup.vue"

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

async function mountAndOpen() {
	authwitsServiceMock.getRegistryEnabled.mockResolvedValueOnce(true)
	const w = mount(ChangeAuthwitsRegistryPopup, {
		props: { show: false },
		global: { stubs: STUBS },
		attachTo: document.body,
	})
	wrappers.push(w)
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

/** Presses `key` on `el` as a browser does: Enter clicks it on keydown and Space on keyup, each only
 *  when no handler cancelled the key. `init` sets the keydown's `repeat`, `isComposing` or `keyCode`.
 *  Returns whether each key event went through. */
function pressOn(el: HTMLElement, key: "Enter" | " ", init: KeyboardEventInit = {}): boolean[] {
	el.focus()
	const down = el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
	if (key === "Enter") {
		if (down) el.click()
		return [down]
	}
	const up = el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }))
	if (down && up) el.click()
	return [down, up]
}

function setFee(w: ReturnType<typeof mount>) {
	return w.find('[data-testid="set-fee"]').trigger("click")
}

const submitButton = (w: ReturnType<typeof mount>) => w.get('[data-testid="registry-toggle-submit"]').element as HTMLElement

beforeEach(() => {
	authwitsServiceMock.getRegistryEnabled.mockReset()
	authwitsServiceMock.setRegistryEnabled.mockReset().mockResolvedValue(undefined)
	authwitsServiceMock.disconnect.mockReset()
	openToastMock.mockReset()
	feeControlClick.mockReset()
	nestedSubmit.mockReset()
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

describe("ChangeAuthwitsRegistryPopup — Enter elsewhere sends nothing, though the toggle is ready", () => {
	test("Enter on the header's close button closes the popup once", async () => {
		const w = await mountAndOpen()
		await setFee(w)
		pressOn(w.get('[data-testid="popup-close-btn"]').element as HTMLElement, "Enter")
		await flushPromises()
		expect(w.emitted("onClose")).toHaveLength(1)
		expect(authwitsServiceMock.setRegistryEnabled).not.toHaveBeenCalled()
	})

	test("Enter on a control inside the fee card runs that control", async () => {
		const w = await mountAndOpen()
		await setFee(w)
		feeControlClick.mockClear()
		pressOn(w.get('[data-testid="set-fee"]').element as HTMLElement, "Enter")
		await flushPromises()
		expect(feeControlClick).toHaveBeenCalledTimes(1)
		expect(authwitsServiceMock.setRegistryEnabled).not.toHaveBeenCalled()
	})

	test("Enter on an element outside the popup, as a teleported menu item, runs that element", async () => {
		const w = await mountAndOpen()
		await setFee(w)
		const item = document.createElement("div")
		item.setAttribute("data-dropdown-item", "")
		item.tabIndex = 0
		const itemClick = vi.fn()
		item.addEventListener("click", itemClick)
		document.body.appendChild(item)
		pressOn(item, "Enter")
		await flushPromises()
		expect(itemClick).toHaveBeenCalledTimes(1)
		expect(authwitsServiceMock.setRegistryEnabled).not.toHaveBeenCalled()
	})

	test("Enter with nothing focused", async () => {
		const w = await mountAndOpen()
		await setFee(w)
		expect(document.activeElement).toBe(document.body)
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).not.toHaveBeenCalled()
	})

	test("Enter in the field of a form popup shown over this one submits that popup once", async () => {
		const w = await mountAndOpen()
		await setFee(w)
		pressOn(await showNestedFormPopup(), "Enter")
		await flushPromises()
		expect(nestedSubmit).toHaveBeenCalledTimes(1)
		expect(authwitsServiceMock.setRegistryEnabled).not.toHaveBeenCalled()
	})

	test("repeat-only Enter keydowns that first land on the idle, focused Send button", async () => {
		const w = await mountAndOpen()
		await setFee(w)
		for (let i = 0; i < 3; i++) pressOn(submitButton(w), "Enter", { repeat: true })
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).not.toHaveBeenCalled()
	})

	test.each([
		["isComposing", { isComposing: true }],
		["keyCode 229 with isComposing false", { keyCode: 229, isComposing: false }],
	] as const)("a composing Enter (%s) on the idle, focused Send button", async (_name, init) => {
		const w = await mountAndOpen()
		await setFee(w)
		pressOn(submitButton(w), "Enter", init)
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).not.toHaveBeenCalled()
	})
})

describe("ChangeAuthwitsRegistryPopup — the Send button", () => {
	test.each(["Enter", " "] as const)("%j on the focused Send button sends once", async (key) => {
		const w = await mountAndOpen()
		await setFee(w)
		expect(pressOn(submitButton(w), key)).not.toContain(false)
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).toHaveBeenCalledTimes(1)
	})

	test("a held Enter on the focused Send button sends once", async () => {
		let resolveSet: (v?: unknown) => void = () => {}
		authwitsServiceMock.setRegistryEnabled.mockReturnValueOnce(new Promise((r) => (resolveSet = r)))
		const w = await mountAndOpen()
		await setFee(w)
		pressOn(submitButton(w), "Enter")
		await flushPromises()
		for (let i = 0; i < 3; i++) pressOn(submitButton(w), "Enter", { repeat: true })
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).toHaveBeenCalledTimes(1)
		resolveSet()
	})

	test("a press before the fee is set sends nothing", async () => {
		const w = await mountAndOpen()
		pressOn(submitButton(w), "Enter")
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).not.toHaveBeenCalled()
		expect(w.find('[data-testid="registry-toggle-submit"]').attributes("disabled")).toBeDefined()
	})

	test("(REGRESSION-PIN) a second press while the toggle is in flight sends nothing", async () => {
		let resolveSet: (v?: unknown) => void = () => {}
		authwitsServiceMock.setRegistryEnabled.mockReturnValueOnce(new Promise((r) => (resolveSet = r)))
		const w = await mountAndOpen()
		await setFee(w)
		pressOn(submitButton(w), "Enter")
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).toHaveBeenCalledTimes(1)
		pressOn(submitButton(w), "Enter")
		pressOn(submitButton(w), " ")
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).toHaveBeenCalledTimes(1)
		expect(w.find('[data-testid="registry-toggle-submit"]').attributes("disabled")).toBeDefined()
		resolveSet()
	})

	test("a click on the Send button sends once", async () => {
		const w = await mountAndOpen()
		await setFee(w)
		await w.find('[data-testid="registry-toggle-submit"]').trigger("click")
		await flushPromises()
		expect(authwitsServiceMock.setRegistryEnabled).toHaveBeenCalledTimes(1)
	})
})
