import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import Flex from "./Flex.vue"

describe("Flex", () => {
	test("default → .flex on a div", () => {
		const w = mount(Flex)
		expect(w.classes()).toContain("flex")
		expect(w.element.tagName).toBe("DIV")
	})

	test("align → items-*", () => {
		expect(mount(Flex, { props: { align: "center" } }).classes()).toContain("items-center")
	})

	test("justify → justify-*", () => {
		expect(mount(Flex, { props: { justify: "between" } }).classes()).toContain("justify-between")
	})

	test("gap → gap--N", () => {
		expect(mount(Flex, { props: { gap: "8" } }).classes()).toContain("gap--8")
	})

	test("direction + wrap + wide", () => {
		const w = mount(Flex, { props: { direction: "column", wrap: "wrap", wide: true } })
		for (const c of ["flex-direction-column", "wrap-wrap", "flex-wide"]) expect(w.classes()).toContain(c)
	})

	test("tag renders a custom element", () => {
		expect(mount(Flex, { props: { tag: "section" } }).element.tagName).toBe("SECTION")
	})

	test("exposes the wrapper ref (defineExpose, bound to the root element)", () => {
		const w = mount(Flex)
		expect((w.vm as unknown as { wrapper: HTMLElement }).wrapper).toBe(w.element)
	})
})
