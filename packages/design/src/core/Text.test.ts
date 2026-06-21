import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import Text from "./Text.vue"

describe("Text", () => {
	test("renders slot content", () => {
		expect(mount(Text, { slots: { default: "hi" } }).text()).toBe("hi")
	})

	test("size → fz-- class", () => {
		expect(mount(Text, { props: { size: "14" } }).classes()).toContain("fz--14")
	})

	test("weight → fw-- class", () => {
		expect(mount(Text, { props: { weight: "600" } }).classes()).toContain("fw--600")
	})

	test("default height → lh--100", () => {
		expect(mount(Text).classes()).toContain("lh--100")
	})

	test("color → color-- class", () => {
		expect(mount(Text, { props: { color: "primary" } }).classes()).toContain("color--primary")
	})

	test("boolean flags → utility classes", () => {
		const w = mount(Text, { props: { mono: true, tabular: true, selectable: true, noWrap: true } })
		for (const c of ["mono", "tabular", "selectable", "no-wrap"]) expect(w.classes()).toContain(c)
	})

	// (PIN) verbatim behavior preserved from the pre-migration component:
	test("(PIN) off-scale/named size emits the class verbatim (no .fz--large in base.css → inherits at runtime)", () => {
		expect(mount(Text, { props: { size: "large" } }).classes()).toContain("fz--large")
	})
})
