/**
 * Locks the brutalist contract for ContactRow:
 *   - testid + data-contact-name preserved (e2e selectors depend on them)
 *   - sender chip renders only when isSender=true
 *   - select / copy / edit / delete actions emit independently
 */
import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import ContactRow from "./ContactRow.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
}

const baseContact = { id: "abc", name: "Alice", address: "0xaaaa", abbr: "AL" }

const mountRow = (props: Record<string, unknown> = {}) =>
	mount(ContactRow, {
		props: { contact: baseContact, ...props },
		global: { stubs: STUBS },
	})

describe("modules/settings/contacts/ContactRow", () => {
	test("renders contact name, abbr initials, and preserves data-contact-name + testid", () => {
		const w = mountRow()
		expect(w.attributes("data-testid")).toBe("contact-row")
		expect(w.attributes("data-contact-name")).toBe("Alice")
		expect(w.text()).toContain("Alice")
		expect(w.text()).toContain("AL")
	})

	test("emits select on click and on Enter keypress", async () => {
		const w = mountRow()
		await w.trigger("click")
		await w.trigger("keydown.enter")
		expect(w.emitted("select")).toHaveLength(2)
		expect(w.emitted("select")![0]).toEqual([baseContact])
	})

	test("sender chip renders only when isSender is true", () => {
		const without = mountRow()
		expect(without.find('[data-testid="contact-sender-chip"]').exists()).toBe(false)
		const withSender = mountRow({ isSender: true })
		expect(withSender.find('[data-testid="contact-sender-chip"]').exists()).toBe(true)
	})

	test("edit and delete action buttons emit their own events without bubbling select", async () => {
		const w = mountRow()
		await w.find('[data-testid="contact-edit"]').trigger("click")
		await w.find('[data-testid="contact-delete"]').trigger("click")
		expect(w.emitted("edit")).toHaveLength(1)
		expect(w.emitted("delete")).toHaveLength(1)
		expect(w.emitted("select")).toBeUndefined()
	})

	test("avatar block does not carry an inline backgroundColor (brutalist neutral)", () => {
		// Post-brutalist sweep: the avatar fills via the .avatar style module
		// (background: var(--nulo-surface-high)), NOT via an inline rainbow.
		// Asserting absence of inline style is the structural contract that
		// guards against a regression that re-introduces per-contact rainbow.
		const w = mountRow()
		const avatar = w.find("div > div > div").element as HTMLElement
		expect(avatar.style.backgroundColor).toBe("")
	})
})
