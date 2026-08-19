/**
 * Component tests for NewSenderPopup — pins the popup's wiring onto the shared
 * `usePopupEntity` lifecycle (Q-14): Enter submits ONLY from an input/textarea
 * (a global Enter must not), the client's connect/fetch lives in onShow and
 * disconnect/reset in onHide, and the hex-validity guard still gates the Enter
 * path. Composable mechanics are covered in `usePopupEntity.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils"

const accountStateServiceMock = {
	getSenders: vi.fn(),
	addSender: vi.fn(),
	disconnect: vi.fn(),
}
const openToastMock = vi.fn()

// Vitest requires `function` expressions (not arrows) for mocks used with `new`.
vi.mock("@/wallet/services/account-state/client", () => ({
	AccountStateServiceClient: vi.fn(function () {
		return accountStateServiceMock
	}),
}))

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
}))

vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({ network: { id: "net-1" } }),
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { new_sender: { order: 1 } } }),
}))

const STUBS = {
	Popup: { props: ["show", "displaceIdx"], template: "<div><slot /></div>" },
	PopupCard: { props: ["displaceIdx"], template: "<div><slot /></div>" },
	PopupHeader: { emits: ["onClose"], template: "<div><slot name='title' /></div>" },
	Input: {
		props: ["modelValue"],
		emits: ["update:modelValue"],
		template: `<label><input data-testid="sender-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /><slot name="right" /></label>`,
	},
	Button: { props: ["disabled", "loading"], template: "<button :disabled='disabled'><slot /></button>" },
	Tooltip: { template: "<div><slot /><slot name='content' /></div>" },
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Transition: { template: "<div><slot /></div>" },
}

import NewSenderPopup from "./NewSenderPopup.vue"

const VALID_HEX = `0x${"a".repeat(64)}`

function pressEnterOnInput() {
	const el = document.createElement("input")
	document.body.appendChild(el)
	el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}
function pressEnterOnBody() {
	document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}

async function mountShown(): Promise<VueWrapper> {
	const w = mount(NewSenderPopup, { props: { show: false }, global: { stubs: STUBS } })
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

async function typeAddress(w: VueWrapper, address: string) {
	await w.find('[data-testid="sender-input"]').setValue(address)
}

beforeEach(() => {
	accountStateServiceMock.getSenders.mockResolvedValue([])
	accountStateServiceMock.addSender.mockResolvedValue(undefined)
})

afterEach(() => {
	vi.clearAllMocks()
	document.body.innerHTML = ""
})

describe("NewSenderPopup — Enter-submit wiring (usePopupEntity)", () => {
	test("show connects the client and fetches the existing senders", async () => {
		const w = await mountShown()
		expect(accountStateServiceMock.getSenders).toHaveBeenCalledWith("net-1")
		await dispose(w)
	})

	test("Enter while an input is focused submits (addSender called)", async () => {
		const w = await mountShown()
		await typeAddress(w, VALID_HEX)
		pressEnterOnInput()
		await flushPromises()
		expect(accountStateServiceMock.addSender).toHaveBeenCalledWith("net-1", VALID_HEX)
		expect(w.emitted("onClose")).toBeTruthy()
		expect(openToastMock).toHaveBeenCalledWith({ label: "Sender is added" })
		await dispose(w)
	})

	test("a global Enter (body focused) does NOT submit", async () => {
		const w = await mountShown()
		await typeAddress(w, VALID_HEX)
		pressEnterOnBody()
		await flushPromises()
		expect(accountStateServiceMock.addSender).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("Enter does NOT submit an invalid hex address", async () => {
		const w = await mountShown()
		await typeAddress(w, "not-hex")
		pressEnterOnInput()
		await flushPromises()
		expect(accountStateServiceMock.addSender).not.toHaveBeenCalled()
		await dispose(w)
	})

	test("hide disconnects the client and resets the field; Enter after hide is inert", async () => {
		const w = await mountShown()
		await typeAddress(w, VALID_HEX)
		await w.setProps({ show: false })
		expect(accountStateServiceMock.disconnect).toHaveBeenCalledTimes(1)
		pressEnterOnInput()
		await flushPromises()
		expect(accountStateServiceMock.addSender).not.toHaveBeenCalled()
		// Re-show renders an empty field (senderAddress was reset on hide).
		await w.setProps({ show: true })
		await flushPromises()
		expect((w.find('[data-testid="sender-input"]').element as HTMLInputElement).value).toBe("")
		await dispose(w)
	})
})
