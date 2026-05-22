import { beforeEach, describe, expect, test, vi } from "vitest"
import { mount } from "@vue/test-utils"

// vi.mock() gets hoisted; mocks must be declared via vi.hoisted().
const { getContactByAddress, openToast, writeText } = vi.hoisted(() => ({
	getContactByAddress: vi.fn(),
	openToast: vi.fn(),
	writeText: vi.fn(),
}))

// Mock `managers.contact` and assert it's NEVER called. Class IDs LOOK
// like addresses (long hex) but routing them through the contact book
// would let an attacker pick a class ID that collides with a saved
// contact to imply a relationship that doesn't exist.
vi.mock("@/utils/core", () => ({
	managers: { contact: { getContactByAddress } },
}))

beforeEach(() => {
	getContactByAddress.mockReset()
	openToast.mockReset()
	writeText.mockReset()
	vi.stubGlobal("useToast", () => ({ openToast, closeToast: vi.fn(), toast: { value: null } }))
	Object.assign(navigator, { clipboard: { writeText } })
})

import ScopeClassId from "./ScopeClassId.vue"

const STUBS = {
	Text: { template: "<span><slot /></span>" },
}

const factory = (props: { id: string }) =>
	mount(ScopeClassId, {
		props,
		global: { stubs: STUBS },
	})

describe("ScopeClassId", () => {
	test("renders the trimmed raw class id", () => {
		const w = factory({ id: "0x1234567890abcdef" })
		expect(w.text()).toMatch(/0x1234.+cdef/)
	})

	test("does NOT call managers.contact (class IDs are not addresses)", () => {
		factory({ id: "0xclass1" })
		expect(getContactByAddress).not.toHaveBeenCalled()
	})

	test("never renders a contact annotation", () => {
		factory({ id: "0xclass1" })
		const w = factory({ id: "0xclass1" })
		expect(w.text()).not.toMatch(/\(@/)
	})

	test("click writes the RAW class id to clipboard with class-specific toast copy", async () => {
		const w = factory({ id: "0xclass1" })
		await w.find('[data-testid="scope-class-id"]').trigger("click")
		expect(writeText).toHaveBeenCalledWith("0xclass1")
		expect(openToast).toHaveBeenCalledWith(expect.objectContaining({ label: "Class id is copied" }))
	})

	test("Enter key copies (a11y parity)", async () => {
		const w = factory({ id: "0xclass1" })
		await w.find('[data-testid="scope-class-id"]').trigger("keydown.enter")
		expect(writeText).toHaveBeenCalledWith("0xclass1")
	})

	test("preserves the canonical testid + data attr for e2e", () => {
		const w = factory({ id: "0xclass1" })
		const el = w.find('[data-testid="scope-class-id"]')
		expect(el.exists()).toBe(true)
		expect(el.attributes("data-scope-class-id")).toBe("0xclass1")
	})
})
