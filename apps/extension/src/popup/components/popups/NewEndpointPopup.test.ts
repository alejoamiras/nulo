/**
 * Component tests for NewEndpointPopup — pins the popup's wiring onto the
 * shared `usePopupEntity` lifecycle (Q-14): Enter submits ONLY while an
 * input/textarea is focused (a global Enter must not), the listener dies with
 * the popup, and show resets the fields. The composable's own mechanics are
 * covered in `usePopupEntity.test.ts`; these pins prove THIS popup is wired
 * through it and that its submit guard still gates the Enter path.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"

const addEndpointMock = vi.fn()
const getNetworksMock = vi.fn()
const openToastMock = vi.fn()

vi.mock("@/utils/core", () => ({
	managers: {
		network: {
			addEndpoint: (...args: unknown[]) => addEndpointMock(...args),
			getNetworks: (...args: unknown[]) => getNetworksMock(...args),
		},
	},
}))

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
}))

vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({ networks: [{ id: "net-1", chainId: 1, name: "Local" }] }),
}))
vi.mock("@/stores/cache.store", () => ({
	useCacheStore: () => ({ endpointEditNetworkId: "net-1" }),
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { new_endpoint: { order: 1 } } }),
}))

const STUBS = {
	FormPopup: {
		props: ["show", "submitLabel", "submitDisabled", "submitLoading", "displaceIdx", "submitTestId"],
		emits: ["onClose", "submit"],
		template: `<div><slot name="title" /><slot /><slot name="belowSubmit" /></div>`,
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

import NewEndpointPopup from "./NewEndpointPopup.vue"

/** Bubbling keydown FROM a real document-level input so the document listener
 *  sees `event.target` as an input (the composable's submit guard). */
function pressEnterOnInput() {
	const el = document.createElement("input")
	document.body.appendChild(el)
	el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}
function pressEnterOnBody() {
	document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}

async function mountShown(): Promise<VueWrapper> {
	const w = mount(NewEndpointPopup, { props: { show: false }, global: { stubs: STUBS } })
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

/** Hide-then-unmount: the composable only removes its document listener on
 *  show → false (production popups never unmount), so tests must hide first or
 *  the listener leaks into the next test. */
async function dispose(w: VueWrapper) {
	await w.setProps({ show: false })
	w.unmount()
}

async function fillRpcUrl(w: VueWrapper, url: string) {
	const rpc = w.findAll("input").find((i) => i.attributes("data-input-label") === "RPC URL")
	if (!rpc) throw new Error("RPC input not rendered")
	await rpc.setValue(url)
}

beforeEach(() => {
	addEndpointMock.mockResolvedValue(undefined)
	getNetworksMock.mockResolvedValue([])
})

afterEach(() => {
	vi.clearAllMocks()
	document.body.innerHTML = ""
})

describe("NewEndpointPopup — Enter-submit wiring (usePopupEntity)", () => {
	test("Enter while an input is focused submits (addEndpoint called)", async () => {
		const w = await mountShown()
		await fillRpcUrl(w, "https://rpc.example.com")
		pressEnterOnInput()
		await flushPromises()
		expect(addEndpointMock).toHaveBeenCalledWith("net-1", undefined, "https://rpc.example.com")
		await dispose(w)
	})

	test("a global Enter (body focused) does NOT submit", async () => {
		const w = await mountShown()
		await fillRpcUrl(w, "https://rpc.example.com")
		pressEnterOnBody()
		await flushPromises()
		expect(addEndpointMock).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("Enter does NOT submit while the guard rejects (URL too short)", async () => {
		const w = await mountShown()
		await fillRpcUrl(w, "http")
		pressEnterOnInput()
		await flushPromises()
		expect(addEndpointMock).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("after hide, Enter is inert (listener removed)", async () => {
		const w = await mountShown()
		await fillRpcUrl(w, "https://rpc.example.com")
		await w.setProps({ show: false })
		pressEnterOnInput()
		await flushPromises()
		expect(addEndpointMock).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("re-show resets the fields (label + URL cleared)", async () => {
		const w = await mountShown()
		const label = w.findAll("input").find((i) => i.attributes("data-input-label") === "Label (optional)")
		await label?.setValue("Backup")
		await fillRpcUrl(w, "https://rpc.example.com")
		await w.setProps({ show: false })
		await w.setProps({ show: true })
		await flushPromises()
		const rpc = w.findAll("input").find((i) => i.attributes("data-input-label") === "RPC URL")
		expect((rpc?.element as HTMLInputElement).value).toBe("")
		const labelAfter = w.findAll("input").find((i) => i.attributes("data-input-label") === "Label (optional)")
		expect((labelAfter?.element as HTMLInputElement).value).toBe("")
		// And the cleared URL fails the submit guard again.
		pressEnterOnInput()
		await flushPromises()
		expect(addEndpointMock).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("(RE-ENTRANCY PIN) repeated Enter during an in-flight probe fires addEndpoint ONCE", async () => {
		addEndpointMock.mockImplementationOnce(() => new Promise(() => {}))
		const w = await mountShown()
		await fillRpcUrl(w, "https://rpc.example.com")
		pressEnterOnInput()
		await flushPromises()
		pressEnterOnInput()
		await flushPromises()
		// Cleanup BEFORE the assertion: a failing expect must not skip dispose
		// and leak this instance's document listener into the next test.
		const calls = addEndpointMock.mock.calls.length
		await dispose(w)
		expect(calls).toBe(1)
	})

	test("submit success closes the popup and toasts", async () => {
		const w = await mountShown()
		await fillRpcUrl(w, "https://rpc.example.com")
		pressEnterOnInput()
		await flushPromises()
		expect(w.emitted("onClose")).toBeTruthy()
		expect(openToastMock).toHaveBeenCalledWith({ label: "Endpoint added" })
		await dispose(w)
	})
})
