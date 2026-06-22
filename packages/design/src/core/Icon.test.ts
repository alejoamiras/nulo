import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import Icon from "./Icon.vue"

describe("Icon", () => {
	test("string icon renders a single <path>", () => {
		expect(mount(Icon, { props: { name: "external-link" } }).findAll("path")).toHaveLength(1)
	})

	// Pins the dead-branch removal: a multi-path (array) icon renders all paths with no
	// `path.opacity`-on-undefined crash (the old non-array-object branch was provably dead).
	test("array icon renders multiple <path>s without crashing", () => {
		expect(mount(Icon, { props: { name: "copy" } }).findAll("path").length).toBeGreaterThan(1)
	})

	test("renders an svg with role=img", () => {
		const w = mount(Icon, { props: { name: "external-link" } })
		expect(w.element.tagName.toLowerCase()).toBe("svg")
		expect(w.attributes("role")).toBe("img")
	})

	test("color → fill-- class", () => {
		expect(mount(Icon, { props: { name: "external-link", color: "primary" } }).classes()).toContain("fill--primary")
	})

	test("size sets the svg width/height", () => {
		expect(mount(Icon, { props: { name: "external-link", size: 24 } }).attributes("width")).toBe("24")
	})

	test("no color → fill: currentColor on the svg style", () => {
		expect(mount(Icon, { props: { name: "external-link" } }).attributes("style") || "").toMatch(/currentcolor/i)
	})
})
