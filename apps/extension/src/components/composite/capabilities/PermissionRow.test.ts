import { Icon, MaterialIcon, Toggle } from "@nulo/design"
import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import PermissionRow from "./PermissionRow.vue"

const AUTH = {
	icon: "signature",
	title: "Act for you in transactions you approve",
	subOn: "Nulo signs its authorizations without asking.",
	subOff: "You confirm each authorization first.",
	switchLabel: "Authorizations without asking",
}

const mountRow = (props: Record<string, unknown> = {}, options: { slots?: Record<string, string>; attrs?: Record<string, string> } = {}) =>
	mount(PermissionRow, {
		props: { ...AUTH, modelValue: true, ...props } as never,
		attrs: options.attrs,
		slots: options.slots,
		global: { components: { Icon, MaterialIcon, Toggle } },
	})

/** The compiled `<style module>` class names; a script-setup instance does not expose `$style`. */
const STYLE = (PermissionRow as unknown as { __cssModules: { $style: Record<string, string> } }).__cssModules.$style
const sub = (w: ReturnType<typeof mountRow>) => w.find('[data-testid="cap-row-sub"]')
const toggle = (w: ReturnType<typeof mountRow>) => w.find('[data-testid="cap-toggle"]')

describe("composite/capabilities/PermissionRow", () => {
	test("renders the icon, the title and, without a switch, the line", () => {
		const w = mountRow({ switchLabel: undefined, subOff: undefined, icon: "task_alt", title: "Every transaction", subOn: "Line" })
		expect(w.text()).toContain("task_alt")
		expect(w.text()).toContain("Every transaction")
		expect(sub(w).text()).toBe("Line")
	})

	test("a switch row reads the on line while on and the off line while off", async () => {
		const w = mountRow()
		expect(sub(w).text()).toBe(AUTH.subOn)
		await w.setProps({ modelValue: false })
		expect(sub(w).text()).toBe(AUTH.subOff)
	})

	test("a row with no line renders no line element", () => {
		const w = mountRow({ switchLabel: undefined, subOn: undefined, subOff: undefined })
		expect(sub(w).exists()).toBe(false)
	})

	test("the sub slot replaces the line and learns the switch's state", async () => {
		const w = mountRow({ modelValue: false }, { slots: { sub: '<template #sub="{ on }"><b>{{ on ? "yes" : "no" }}</b></template>' } })
		expect(sub(w).html()).toContain("<b>no</b>")
		await w.setProps({ modelValue: true })
		expect(sub(w).text()).toBe("yes")
	})

	test("the chip renders only when given", () => {
		expect(mountRow().text()).not.toContain("Any contract")
		const w = mountRow({ chip: "Any contract" })
		expect(w.text()).toContain("Any contract")
	})

	test("a badge sits on the title line beside the title, only when given", () => {
		expect(mountRow().find('[data-testid="cap-rerequested-badge"]').exists()).toBe(false)
		const w = mountRow({ badge: "previously denied" })
		const badge = w.find('[data-testid="cap-rerequested-badge"]')
		expect(badge.text()).toBe("previously denied")
		expect(badge.classes()).toContain(STYLE.badge)
		expect(badge.element.parentElement?.className).toBe(STYLE.title_line)
		expect(badge.element.parentElement?.textContent).toBe(`${AUTH.title}previously denied`)
	})

	test("the title can carry a testid", () => {
		const w = mountRow({ titleTestid: "cap-unrecognized-badge" })
		expect(w.find('[data-testid="cap-unrecognized-badge"]').text()).toBe(AUTH.title)
	})

	test("a flagged row carries the flagged class that turns its icon orange", () => {
		const w = mountRow({ flagged: true })
		expect(w.classes()).toContain(STYLE.flagged)
		expect(mountRow().classes()).not.toContain(STYLE.flagged)
	})

	test("without a switch name there is no switch and no Tab stop", () => {
		const w = mountRow({ switchLabel: undefined })
		expect(toggle(w).exists()).toBe(false)
		expect(w.find('[role="switch"]').exists()).toBe(false)
		expect(w.find("[tabindex]").exists()).toBe(false)
	})

	test("the switch is named by the row and described by its current line", () => {
		const w = mountRow()
		const el = toggle(w)
		expect(el.attributes("role")).toBe("switch")
		expect(el.attributes("aria-label")).toBe(AUTH.switchLabel)
		expect(el.attributes("tabindex")).toBe("0")
		expect(el.attributes("aria-describedby")).toBe(sub(w).attributes("id"))
		expect(sub(w).attributes("id")).toBeTruthy()
	})

	test("a click on the switch emits the flipped value", async () => {
		const w = mountRow({ modelValue: false })
		await toggle(w).trigger("click")
		expect(w.emitted("update:modelValue")).toEqual([[true]])
	})

	test.each(["space", "enter"])("%s on the switch flips it", async (key) => {
		const w = mountRow({ modelValue: true })
		await toggle(w).trigger(`keydown.${key}`)
		expect(w.emitted("update:modelValue")).toEqual([[false]])
	})

	test("the switch carries the row's focus-ring class", () => {
		const w = mountRow()
		expect(toggle(w).classes()).toContain(STYLE.switch)
	})

	test("the row itself has no hover class and a click on it does nothing", async () => {
		const w = mountRow()
		expect(w.classes()).toEqual([STYLE.row])
		await w.trigger("click")
		await w.find("div").trigger("click")
		expect(w.emitted("update:modelValue")).toBeUndefined()
	})

	test("attributes pass through to the row, and the switch's testid can be named", () => {
		const w = mountRow(
			{ switchTestid: "connected-app-authorizations-toggle" },
			{ attrs: { "data-cap-row": "authorizations", "data-testid": "connected-app-authorizations" } },
		)
		expect(w.attributes("data-cap-row")).toBe("authorizations")
		expect(w.attributes("data-testid")).toBe("connected-app-authorizations")
		expect(w.find('[data-testid="connected-app-authorizations-toggle"]').attributes("role")).toBe("switch")
		expect(toggle(w).exists()).toBe(false)
	})
})
