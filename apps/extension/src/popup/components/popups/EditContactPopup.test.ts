/**
 * Component tests for EditContactPopup, pinning the decoupled behavior:
 * editing a contact (including its ADDRESS) touches the contact service
 * ONLY — no sender toggle, no registration migration.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"

// ── Mocks ────────────────────────────────────────────────────────────

const contactServiceMock = {
	getContacts: vi.fn(),
	updateContact: vi.fn(),
	disconnect: vi.fn(),
	onContactAdded: { add: vi.fn(), remove: vi.fn() },
	onContactUpdated: { add: vi.fn(), remove: vi.fn() },
	onContactDeleted: { add: vi.fn(), remove: vi.fn() },
}

const openToastMock = vi.fn()

const cacheStoreState: { contactToEditIdx: string; importContact: unknown } = {
	contactToEditIdx: "",
	importContact: null,
}

// Vitest 4 requires `function` expressions (not arrow functions) for mocks
// instantiated with `new`.
vi.mock("@/wallet/services/contact/client", () => ({
	ContactServiceClient: vi.fn(function () {
		return contactServiceMock
	}),
}))

vi.mock("@/stores/cache.store", () => ({
	useCacheStore: () => cacheStoreState,
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { edit_contact: { order: 1 } } }),
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
				<slot name="belowSubmit" />
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
	Button: { template: "<button><slot /></button>" },
	Transition: { template: "<div><slot /></div>" },
}

// Lazy import after vi.mock calls hoist
import EditContactPopup from "./EditContactPopup.vue"

const OLD_ADDRESS = `0x${"a".repeat(64)}`
const NEW_ADDRESS = `0x${"b".repeat(64)}`
const CONTACT = { id: "c1", name: "Alice", address: OLD_ADDRESS }

async function mountAndOpen(contacts = [CONTACT], editId = "c1") {
	cacheStoreState.contactToEditIdx = editId
	const w = mount(EditContactPopup, {
		props: { show: false },
		global: { stubs: STUBS },
	})
	contactServiceMock.getContacts.mockResolvedValueOnce(contacts)
	await w.setProps({ show: true })
	await flushPromises()
	return w
}

beforeEach(() => {
	vi.clearAllMocks()
	cacheStoreState.contactToEditIdx = ""
	cacheStoreState.importContact = null
})
afterEach(() => {
	vi.restoreAllMocks()
})

describe("EditContactPopup — decoupled from sender registration", () => {
	test("prefills fields from the edited contact and disables submit while clean", async () => {
		const w = await mountAndOpen()
		expect((w.find('[data-testid="name-input"]').element as HTMLInputElement).value).toBe("Alice")
		expect((w.find('[data-testid="address-input"]').element as HTMLInputElement).value).toBe(OLD_ADDRESS)
		expect(w.find('[data-testid="form-popup"]').attributes("data-submit-disabled")).toBe("true")
	})

	test("address edit calls updateContact only — no sender migration, no toggle", async () => {
		const w = await mountAndOpen()
		expect(w.find('[data-testid="edit-contact-sender-toggle"]').exists()).toBe(false)
		expect(w.text()).not.toContain("Register as sender")

		contactServiceMock.updateContact.mockResolvedValueOnce({ ...CONTACT, address: NEW_ADDRESS })
		await w.find('[data-testid="address-input"]').setValue(NEW_ADDRESS)
		await flushPromises()
		await w.find('[data-testid="form-submit"]').trigger("click")
		await flushPromises()

		expect(contactServiceMock.updateContact).toHaveBeenCalledWith("c1", "Alice", NEW_ADDRESS)
		expect(w.emitted("onClose")).toBeTruthy()
		expect(openToastMock).toHaveBeenCalledWith({ label: "Contact is updated" })
	})

	test("saves an edited address canonicalized to lowercase", async () => {
		const w = await mountAndOpen()
		contactServiceMock.updateContact.mockResolvedValueOnce({ ...CONTACT, address: NEW_ADDRESS })
		await w.find('[data-testid="address-input"]').setValue(NEW_ADDRESS.toUpperCase().replace("0X", "0x"))
		await flushPromises()
		await w.find('[data-testid="form-submit"]').trigger("click")
		await flushPromises()

		expect(contactServiceMock.updateContact).toHaveBeenCalledWith("c1", "Alice", NEW_ADDRESS)
	})

	test("name edit is trimmed on update", async () => {
		const w = await mountAndOpen()
		contactServiceMock.updateContact.mockResolvedValueOnce({ ...CONTACT, name: "Alicia" })
		await w.find('[data-testid="name-input"]').setValue(" Alicia ")
		await flushPromises()
		await w.find('[data-testid="form-submit"]').trigger("click")
		await flushPromises()
		expect(contactServiceMock.updateContact).toHaveBeenCalledWith("c1", "Alicia", OLD_ADDRESS)
	})

	test("updateContact failure surfaces the error toast and does not close", async () => {
		const w = await mountAndOpen()
		contactServiceMock.updateContact.mockRejectedValueOnce(new Error("boom"))
		await w.find('[data-testid="name-input"]').setValue("Alicia")
		await flushPromises()
		await w.find('[data-testid="form-submit"]').trigger("click")
		await flushPromises()

		expect(w.emitted("onClose")).toBeFalsy()
		expect(openToastMock).toHaveBeenCalledWith({ label: "Something went wrong", icon: "warning" }, expect.anything())
	})

	test("Enter with a clean form is a no-op (dirty gate holds on the keyboard path)", async () => {
		const w = await mountAndOpen()
		const input = w.find('[data-testid="name-input"]').element as HTMLInputElement
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
		await flushPromises()

		expect(contactServiceMock.updateContact).not.toHaveBeenCalled()
		expect(w.emitted("onClose")).toBeFalsy()
		expect(openToastMock).not.toHaveBeenCalled()
	})

	test("import mode writes cacheStore.importContact and never calls the service", async () => {
		cacheStoreState.importContact = { id: "", name: "Staged", address: OLD_ADDRESS }
		const w = await mountAndOpen([], "")
		await w.find('[data-testid="name-input"]').setValue("Renamed")
		await flushPromises()
		await w.find('[data-testid="form-submit"]').trigger("click")
		await flushPromises()

		expect(contactServiceMock.updateContact).not.toHaveBeenCalled()
		expect((cacheStoreState.importContact as { name: string; updated: boolean }).name).toBe("Renamed")
		expect((cacheStoreState.importContact as { updated: boolean }).updated).toBe(true)
		expect(w.emitted("onClose")).toBeTruthy()
	})
})
