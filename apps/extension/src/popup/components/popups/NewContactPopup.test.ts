/**
 * Component tests for NewContactPopup, pinning the decoupled behavior:
 * saving a contact touches the contact service ONLY — no sender
 * registration surface (no toggle, no account-state client).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"

// ── Mocks ────────────────────────────────────────────────────────────

const contactServiceMock = {
	getContacts: vi.fn(),
	addContact: vi.fn(),
	disconnect: vi.fn(),
	onContactAdded: { add: vi.fn(), remove: vi.fn() },
	onContactUpdated: { add: vi.fn(), remove: vi.fn() },
	onContactDeleted: { add: vi.fn(), remove: vi.fn() },
}

const openToastMock = vi.fn()

// Vitest 4 requires `function` expressions (not arrow functions) for mocks
// instantiated with `new`.
vi.mock("@/wallet/services/contact/client", () => ({
	ContactServiceClient: vi.fn(function () {
		return contactServiceMock
	}),
}))

vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { new_contact: { order: 1 } } }),
}))

vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: openToastMock }),
	TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
}))

// ── Stubs ────────────────────────────────────────────────────────────

const STUBS = {
	FormPopup: {
		props: ["show", "submitLabel", "submitDisabled", "submitLoading", "title", "displaceIdx", "submitTestId"],
		emits: ["onClose", "submit"],
		template: `
			<div data-testid="form-popup" :data-submit-disabled="String(submitDisabled)">
				<slot />
				<slot name="aboveSubmit" />
				<button data-testid="form-submit" :disabled="submitDisabled" @click="$emit('submit')">{{ submitLabel }}</button>
			</div>
		`,
	},
	Input: {
		props: ["modelValue"],
		emits: ["update:modelValue"],
		template: `<div><input data-testid="name-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /><slot name="right" /></div>`,
	},
	AddressInput: {
		props: ["modelValue"],
		emits: ["update:modelValue"],
		template: `<div><input data-testid="address-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /><slot name="right" /></div>`,
	},
	Icon: { template: "<i />" },
	Text: { template: "<span><slot /></span>" },
	Flex: { template: "<div><slot /></div>" },
	Tooltip: { template: "<div><slot /><slot name='content' /></div>" },
	Toggle: { template: "<button data-testid='stub-toggle' />" },
	Transition: { template: "<div><slot /></div>" },
}

// Lazy import after vi.mock calls hoist
import NewContactPopup from "./NewContactPopup.vue"

const VALID_ADDRESS = `0x${"a".repeat(64)}`

const trackedWrappers: Array<ReturnType<typeof mount>> = []

async function mountAndOpen(existing: Array<{ id: string; name: string; address: string }> = []) {
	const w = mount(NewContactPopup, {
		props: { show: false },
		global: { stubs: STUBS },
	})
	trackedWrappers.push(w)
	contactServiceMock.getContacts.mockResolvedValueOnce(existing)
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

async function fill(w: ReturnType<typeof mount>, name: string, address: string) {
	await w.find('[data-testid="name-input"]').setValue(name)
	await w.find('[data-testid="address-input"]').setValue(address)
	await flushPromises()
}

beforeEach(() => {
	vi.clearAllMocks()
})
afterEach(() => {
	// Guaranteed net: unmount every tracked wrapper (scope cleanup removes the
	// document listener) even when an assertion aborted the test mid-way.
	for (const w of trackedWrappers.splice(0)) {
		try {
			w.unmount()
		} catch {
			/* already unmounted by the test */
		}
	}
	vi.restoreAllMocks()
})

describe("NewContactPopup — decoupled from sender registration", () => {
	test("(RE-ENTRANCY PIN) repeated Enter during an in-flight add fires addContact ONCE", async () => {
		const w = await mountAndOpen()
		contactServiceMock.addContact.mockImplementation(() => new Promise(() => {}))
		await fill(w, "Alice-Reentrant", VALID_ADDRESS)
		// The popup's keydown listener lives on `document`; the mounted tree is
		// detached, so dispatch from a real document-level input. (The tracked
		// afterEach net unmounts every prior wrapper, so only THIS instance is
		// listening; the unique-name filter below keeps the pin robust anyway.)
		const docInput = document.createElement("input")
		document.body.appendChild(docInput)
		docInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
		await flushPromises()
		docInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
		await flushPromises()
		// Count only THIS instance's calls (unique name typed above) — leaked
		// listeners from earlier tests answer the same document Enter but carry
		// their own field values, so they cannot pollute this count.
		const myCalls = contactServiceMock.addContact.mock.calls.filter((c) => c[0] === "Alice-Reentrant").length
		// Cleanup BEFORE the assertion: a failing expect must not skip the
		// unmount (scope cleanup removes the document listener) or the reset.
		w.unmount()
		contactServiceMock.addContact.mockReset()
		docInput.remove()
		expect(myCalls).toBe(1)
	})

	test("submit calls addContact with trimmed name + address, closes, and toasts success", async () => {
		const w = await mountAndOpen()
		contactServiceMock.addContact.mockResolvedValueOnce({ id: "c1" })
		await fill(w, "  Alice ", VALID_ADDRESS)
		await w.find('[data-testid="form-submit"]').trigger("click")
		await flushPromises()

		expect(contactServiceMock.addContact).toHaveBeenCalledWith("Alice", VALID_ADDRESS)
		expect(w.emitted("onClose")).toBeTruthy()
		expect(openToastMock).toHaveBeenCalledWith({ label: "Contact is added" })
	})

	test("saves the address canonicalized to lowercase", async () => {
		const w = await mountAndOpen()
		contactServiceMock.addContact.mockResolvedValueOnce({ id: "c1" })
		await fill(w, "Alice", `0x${"A".repeat(64)}`)
		await w.find('[data-testid="form-submit"]').trigger("click")
		await flushPromises()

		expect(contactServiceMock.addContact).toHaveBeenCalledWith("Alice", `0x${"a".repeat(64)}`)
	})

	test("renders NO register-as-sender toggle", async () => {
		const w = await mountAndOpen()
		expect(w.find('[data-testid="new-contact-register-sender"]').exists()).toBe(false)
		expect(w.text()).not.toContain("Register as sender")
	})

	test("addContact failure surfaces the error toast and does not close", async () => {
		const w = await mountAndOpen()
		contactServiceMock.addContact.mockRejectedValueOnce(new Error("boom"))
		await fill(w, "Alice", VALID_ADDRESS)
		await w.find('[data-testid="form-submit"]').trigger("click")
		await flushPromises()

		expect(w.emitted("onClose")).toBeFalsy()
		expect(openToastMock).toHaveBeenCalledWith({ label: "Something went wrong", icon: "warning" }, expect.anything())
	})

	test("duplicate name or address disables submit", async () => {
		const w = await mountAndOpen([{ id: "c1", name: "Alice", address: VALID_ADDRESS }])
		await fill(w, "Alice", `0x${"b".repeat(64)}`)
		expect(w.find('[data-testid="form-popup"]').attributes("data-submit-disabled")).toBe("true")

		await fill(w, "Bob", VALID_ADDRESS)
		expect(w.find('[data-testid="form-popup"]').attributes("data-submit-disabled")).toBe("true")

		// Hex is case-insensitive — an uppercase rendering of a saved address
		// is the same contact.
		await fill(w, "Bob", `0x${"A".repeat(64)}`)
		expect(w.find('[data-testid="form-popup"]').attributes("data-submit-disabled")).toBe("true")

		await fill(w, "Bob", `0x${"b".repeat(64)}`)
		expect(w.find('[data-testid="form-popup"]').attributes("data-submit-disabled")).toBe("false")
	})

	test("closing disconnects the contact service only", async () => {
		const w = await mountAndOpen()
		await w.setProps({ show: false })
		await flushPromises()
		expect(contactServiceMock.disconnect).toHaveBeenCalled()
	})
})
