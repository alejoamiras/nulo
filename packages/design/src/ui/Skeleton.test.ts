import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import Skeleton from "./Skeleton.vue"

describe("Skeleton", () => {
	it("renders a decorative span with the default 60×12 box", () => {
		const w = mount(Skeleton)
		expect(w.element.tagName).toBe("SPAN")
		expect(w.attributes("class")).toMatch(/skeleton/)
		expect(w.attributes("aria-hidden")).toBe("true")
		expect(w.attributes("style")).toMatch(/width:\s*60px/)
		expect(w.attributes("style")).toMatch(/height:\s*12px/)
	})

	it("treats numbers as px", () => {
		const style = mount(Skeleton, { props: { width: 150, height: 40 } }).attributes("style") ?? ""
		expect(style).toMatch(/width:\s*150px/)
		expect(style).toMatch(/height:\s*40px/)
	})

	it("treats a numeric string as px", () => {
		const style = mount(Skeleton, { props: { width: "72", height: "9.5" } }).attributes("style") ?? ""
		expect(style).toMatch(/width:\s*72px/)
		expect(style).toMatch(/height:\s*9\.5px/)
	})

	it("passes a CSS length through verbatim", () => {
		const style = mount(Skeleton, { props: { width: "100%", height: "1em" } }).attributes("style") ?? ""
		expect(style).toMatch(/width:\s*100%/)
		expect(style).toMatch(/height:\s*1em/)
	})

	it("renders no text and takes no slot content", () => {
		const w = mount(Skeleton, { slots: { default: "ignored" } })
		expect(w.text()).toBe("")
	})

	it("forwards attributes such as data-testid to the root", () => {
		const w = mount(Skeleton, { attrs: { "data-testid": "gas-skeleton-public" } })
		expect(w.attributes("data-testid")).toBe("gas-skeleton-public")
	})
})
