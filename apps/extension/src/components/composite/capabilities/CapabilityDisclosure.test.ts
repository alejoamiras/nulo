import { MaterialIcon } from "@nulo/design"
import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import CapabilityDisclosure from "./CapabilityDisclosure.vue"

const mountFold = (props: Record<string, unknown> = {}, slot = '<button data-testid="inside">Inside</button>') =>
	mount(CapabilityDisclosure, {
		props: { label: "Already allowed", tag: "5", testid: "cap-already-allowed", ...props } as never,
		slots: { default: slot },
		global: { components: { MaterialIcon } },
	})

/** The compiled `<style module>` class names; a script-setup instance does not expose `$style`. */
const STYLE = (CapabilityDisclosure as unknown as { __cssModules: { $style: Record<string, string> } }).__cssModules.$style
const toggle = (w: ReturnType<typeof mountFold>) => w.find("button")

describe("composite/capabilities/CapabilityDisclosure", () => {
	test("a native button, so Enter and Space press it", () => {
		const el = toggle(mountFold()).element as HTMLButtonElement
		expect(el.tagName).toBe("BUTTON")
		expect(el.type).toBe("button")
	})

	test("reads the label, then the tag after a middle dot", () => {
		expect(toggle(mountFold()).find("span").text()).toBe("Already allowed · 5")
		expect(
			toggle(mountFold({ label: "Details", tag: "any contract" }))
				.find("span")
				.text(),
		).toBe("Details · any contract")
	})

	test("the tag is its own quiet span", () => {
		expect(mountFold().find(`.${STYLE.tag}`).text()).toBe("· 5")
	})

	test("the testid lands on the button", () => {
		expect(mountFold().find('[data-testid="cap-already-allowed"]').element.tagName).toBe("BUTTON")
	})

	test("starts closed, with no panel", () => {
		const w = mountFold()
		expect(toggle(w).attributes("aria-expanded")).toBe("false")
		expect(w.find(`.${STYLE.panel}`).exists()).toBe(false)
		expect(w.find('[data-testid="inside"]').exists()).toBe(false)
	})

	test("a click opens the panel on its slot", async () => {
		const w = mountFold()
		await toggle(w).trigger("click")
		expect(toggle(w).attributes("aria-expanded")).toBe("true")
		expect(w.find(`.${STYLE.panel}`).find('[data-testid="inside"]').text()).toBe("Inside")
	})

	test("a second click closes it again", async () => {
		const w = mountFold()
		await toggle(w).trigger("click")
		await toggle(w).trigger("click")
		expect(toggle(w).attributes("aria-expanded")).toBe("false")
		expect(w.find(`.${STYLE.panel}`).exists()).toBe(false)
	})

	test("aria-controls names the panel only while it exists", async () => {
		const w = mountFold()
		expect(toggle(w).attributes("aria-controls")).toBeUndefined()
		await toggle(w).trigger("click")
		expect(toggle(w).attributes("aria-controls")).toBe(w.find(`.${STYLE.panel}`).attributes("id"))
	})

	test("the chevron is hidden from screen readers", () => {
		const chevron = mountFold().find(`.${STYLE.chevron}`)
		expect(chevron.attributes("aria-hidden")).toBe("true")
		expect(chevron.text()).toBe("chevron_right")
	})

	test("two folds keep their own state and panel ids", async () => {
		const w = mount(
			{
				components: { CapabilityDisclosure },
				template:
					'<div><CapabilityDisclosure label="A" tag="1" testid="a">one</CapabilityDisclosure><CapabilityDisclosure label="B" tag="2" testid="b">two</CapabilityDisclosure></div>',
			},
			{ global: { components: { MaterialIcon } } },
		)
		await w.find('[data-testid="a"]').trigger("click")
		await w.find('[data-testid="b"]').trigger("click")
		const ids = w.findAll(`.${STYLE.panel}`).map((panel) => panel.attributes("id"))
		expect(new Set(ids).size).toBe(2)
		await w.find('[data-testid="a"]').trigger("click")
		expect(w.find('[data-testid="a"]').attributes("aria-expanded")).toBe("false")
		expect(w.find('[data-testid="b"]').attributes("aria-expanded")).toBe("true")
	})

	test("opening emits nothing: only the screen changes", async () => {
		const w = mountFold()
		await toggle(w).trigger("click")
		expect(Object.keys(w.emitted()).filter((name) => name !== "click")).toEqual([])
	})
})
