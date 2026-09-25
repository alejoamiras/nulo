/**
 * The authorization card is a button row named by its kind; the revoke glyph is a named action
 * that never opens the card.
 */
import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import { RowAction } from "@nulo/design"
import AuthwitCard from "./AuthwitCard.vue"

const STUBS = {
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	Tooltip: { template: '<span><slot /><slot name="content" /></span>' },
}

const AUTHWIT = { id: "a1", kindName: "Call", content: { kind: "call", caller: "0xc", contract: "0xd", method: "transfer" } }

const mountCard = () =>
	mount(AuthwitCard, { props: { authwit: AUTHWIT }, global: { stubs: STUBS, components: { RowAction } }, attachTo: document.body })

describe("modules/settings/authwits/AuthwitCard", () => {
	test("renders the kind and the call fields", () => {
		const w = mountCard()
		expect(w.text()).toContain("Call")
		expect(w.text()).toContain("transfer")
		w.unmount()
	})

	test("the card is a button row named by its kind, with no tabindex of its own", () => {
		const w = mountCard()
		const target = w.find("[data-row-target]")
		expect(target.element.tagName).toBe("BUTTON")
		expect(w.find(`#${target.attributes("aria-labelledby")}`).text()).toBe("Call")
		expect(w.find("[tabindex]").exists()).toBe(false)
		w.unmount()
	})

	test("pressing the row emits 'open' with the authwit, once", async () => {
		const w = mountCard()
		await w.find("[data-row-target]").trigger("click")
		expect(w.emitted("open")).toEqual([[AUTHWIT]])
		w.unmount()
	})

	test("the revoke action is a named button outside the target; pressing it emits only 'revoke'", async () => {
		const w = mountCard()
		const revoke = w.find('button[aria-label="Revoke authwit"]')
		expect(revoke.exists()).toBe(true)
		expect(w.find("[data-row-target]").find('[aria-label="Revoke authwit"]').exists()).toBe(false)
		await revoke.trigger("click")
		expect(w.emitted("revoke")).toEqual([[AUTHWIT]])
		expect(w.emitted("open")).toBeUndefined()
		w.unmount()
	})

	test("no button contains another", () => {
		const w = mountCard()
		expect(w.findAll("button").some((el) => el.find("button, a, [tabindex]").exists())).toBe(false)
		w.unmount()
	})
})
