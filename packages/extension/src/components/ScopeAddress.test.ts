import { beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"

// vi.mock() gets hoisted to the top of the file, so the mocks must be
// declared via vi.hoisted() — otherwise the factory closure runs before
// the module-scope `const`s are initialized.
const { getContactByAddress, openToast, writeText } = vi.hoisted(() => ({
	getContactByAddress: vi.fn(),
	openToast: vi.fn(),
	writeText: vi.fn(),
}))

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

import ScopeAddress from "./ScopeAddress.vue"

const STUBS = {
	Text: { template: "<span><slot /></span>" },
}

const factory = (props: { address: string }) =>
	mount(ScopeAddress, {
		props,
		global: { stubs: STUBS },
	})

describe("ScopeAddress", () => {
	test("renders the trimmed raw address as primary text", async () => {
		getContactByAddress.mockResolvedValueOnce(null)
		const w = factory({ address: "0x1234567890abcdef" })
		await flushPromises()
		// trimAddress gives 0x1234…cdef (default trim).
		expect(w.text()).toMatch(/0x1234.+cdef/)
	})

	test("shows a parenthetical contact annotation when a contact name resolves", async () => {
		getContactByAddress.mockResolvedValueOnce({ name: "Alice" })
		const w = factory({ address: "0xabc" })
		await flushPromises()
		expect(w.text()).toMatch(/\(@Alice\)/)
	})

	test("hides the contact annotation when no contact matches", async () => {
		getContactByAddress.mockResolvedValueOnce(null)
		const w = factory({ address: "0xabc" })
		await flushPromises()
		expect(w.text()).not.toMatch(/\(@/)
	})

	test("the contact name passes through sanitizeWireString (bidi-control stripped)", async () => {
		getContactByAddress.mockResolvedValueOnce({ name: `evil‮name` })
		const w = factory({ address: "0xabc" })
		await flushPromises()
		expect(w.text()).toMatch(/\(@evilname\)/)
	})

	test("click writes the RAW (untrimmed) address to the clipboard", async () => {
		getContactByAddress.mockResolvedValueOnce(null)
		const w = factory({ address: "0x1234567890abcdef" })
		await flushPromises()
		await w.find('[data-testid="scope-address"]').trigger("click")
		expect(writeText).toHaveBeenCalledWith("0x1234567890abcdef")
		expect(openToast).toHaveBeenCalled()
	})

	test("Enter key copies (a11y parity with click)", async () => {
		getContactByAddress.mockResolvedValueOnce(null)
		const w = factory({ address: "0xenter" })
		await flushPromises()
		await w.find('[data-testid="scope-address"]').trigger("keydown.enter")
		expect(writeText).toHaveBeenCalledWith("0xenter")
	})

	test("preserves the canonical testid + data attr for e2e", async () => {
		getContactByAddress.mockResolvedValueOnce(null)
		const w = factory({ address: "0xabc" })
		await flushPromises()
		const el = w.find('[data-testid="scope-address"]')
		expect(el.exists()).toBe(true)
		expect(el.attributes("data-scope-addr")).toBe("0xabc")
	})
})
