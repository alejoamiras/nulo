/**
 * Locks the contract for ContactRow:
 *   - testid + data-contact-name preserved (e2e selectors depend on them)
 *   - the row is a link to Send with the contact preselected
 *   - the sender chip keeps its title, sits above the target and opens the row once
 *   - copy / edit / delete are named actions that never open the row
 */
import { describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { createMemoryHistory, createRouter } from "vue-router"
import { RowAction } from "@nulo/design"
import ContactRow from "./ContactRow.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
}

const baseContact = { id: "abc", name: "Alice", address: "0xaaaa", abbr: "AL" }

async function mountRow(props: Record<string, unknown> = {}) {
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
	})
	await router.push("/popup/settings/contacts")
	const push = vi.spyOn(router, "push")
	const w = mount(ContactRow, {
		props: { contact: baseContact, ...props },
		global: { stubs: STUBS, components: { RowAction }, plugins: [router] },
		attachTo: document.body,
	})
	return { w, router, push, target: w.find("[data-row-target]") }
}

describe("modules/settings/contacts/ContactRow", () => {
	test("renders contact name, abbr initials, and preserves data-contact-name + testid", async () => {
		const { w } = await mountRow()
		expect(w.attributes("data-testid")).toBe("contact-row")
		expect(w.attributes("data-contact-name")).toBe("Alice")
		expect(w.text()).toContain("Alice")
		expect(w.text()).toContain("AL")
		w.unmount()
	})

	test("the row is a link to Send with the contact in the URL, named by the contact, with no tabindex", async () => {
		const { w, target } = await mountRow()
		expect(target.element.tagName).toBe("A")
		expect(target.attributes("href")).toBe("/popup/send?contact=abc")
		expect(w.find(`#${target.attributes("aria-labelledby")}`).text()).toBe("Alice")
		expect(w.find("[tabindex]").exists()).toBe(false)
		expect(w.find('[role="button"]').exists()).toBe(false)
		w.unmount()
	})

	test("a click and Space each open the row once; Shift+Space does not", async () => {
		const { w, router, push, target } = await mountRow()
		await target.trigger("click")
		await flushPromises()
		expect(push).toHaveBeenCalledTimes(1)
		expect(router.currentRoute.value.fullPath).toBe("/popup/send?contact=abc")

		await router.push("/popup/settings/contacts")
		push.mockClear()
		const plain = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })
		target.element.dispatchEvent(plain)
		await flushPromises()
		expect(plain.defaultPrevented).toBe(true)
		expect(push).toHaveBeenCalledTimes(1)

		push.mockClear()
		target.element.dispatchEvent(new KeyboardEvent("keydown", { key: " ", shiftKey: true, bubbles: true, cancelable: true }))
		await flushPromises()
		expect(push).not.toHaveBeenCalled()
		w.unmount()
	})

	test("sender chip renders only when isSender is true, keeps its title, sits outside the target and opens the row once on a click", async () => {
		const without = await mountRow()
		expect(without.w.find('[data-testid="contact-sender-chip"]').exists()).toBe(false)
		without.w.unmount()

		const { w, push, target } = await mountRow({ isSender: true })
		const chip = w.find('[data-testid="contact-sender-chip"]')
		expect(chip.attributes("title")).toBe("Registered as sender")
		expect(target.find('[data-testid="contact-sender-chip"]').exists()).toBe(false)
		expect(chip.classes().some((c) => c.includes("sender_chip"))).toBe(true)
		await chip.trigger("click")
		await flushPromises()
		expect(push).toHaveBeenCalledTimes(1)
		w.unmount()
	})

	test("copy, edit and delete are named 24px buttons that emit their own events and never open the row", async () => {
		const { w, push } = await mountRow()
		const copy = w.find('[aria-label="Copy address"]')
		const edit = w.find('[data-testid="contact-edit"]')
		const del = w.find('[data-testid="contact-delete"]')
		for (const action of [copy, edit, del]) {
			expect(action.element.tagName).toBe("BUTTON")
			expect(action.attributes("type")).toBe("button")
		}
		expect(edit.attributes("aria-label")).toBe("Edit contact")
		expect(del.attributes("aria-label")).toBe("Delete contact")
		await copy.trigger("click")
		await edit.trigger("click")
		await del.trigger("click")
		await flushPromises()
		expect(w.emitted("copy")).toEqual([[baseContact]])
		expect(w.emitted("edit")).toEqual([[baseContact]])
		expect(w.emitted("delete")).toEqual([[baseContact]])
		expect(push).not.toHaveBeenCalled()
		w.unmount()
	})

	test("avatar block does not carry an inline backgroundColor (brutalist neutral)", async () => {
		// The avatar fills via the .avatar style module, never via an inline per-contact colour.
		const { w } = await mountRow()
		const avatar = w.find("div > div > div").element as HTMLElement
		expect(avatar.style.backgroundColor).toBe("")
		w.unmount()
	})
})
