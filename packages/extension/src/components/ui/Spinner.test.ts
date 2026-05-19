import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import Spinner from "./Spinner.vue"

describe("ui/Spinner", () => {
	test("renders a single div with the wrapper class", () => {
		const w = mount(Spinner)
		expect(w.element.tagName).toBe("DIV")
		expect(w.attributes("class")).toMatch(/wrapper/)
	})

	test("size prop drives width/height inline styles (default 16)", () => {
		const w = mount(Spinner)
		const style = w.attributes("style") ?? ""
		expect(style).toMatch(/width:\s*16px/)
		expect(style).toMatch(/height:\s*16px/)
	})

	test("custom size prop is honored", () => {
		const w = mount(Spinner, { props: { size: "32" } })
		const style = w.attributes("style") ?? ""
		expect(style).toMatch(/width:\s*32px/)
		expect(style).toMatch(/height:\s*32px/)
	})

	test("color prop starting with `--` is wrapped in var()", () => {
		const w = mount(Spinner, { props: { color: "--nulo-accent" } })
		const style = w.attributes("style") ?? ""
		expect(style).toMatch(/var\(--nulo-accent\)/)
	})

	test("color prop without `--` is used verbatim (e.g. currentColor)", () => {
		const w = mount(Spinner, { props: { color: "currentColor" } })
		const style = w.attributes("style") ?? ""
		expect(style).toMatch(/currentcolor/i)
		expect(style).not.toMatch(/var\(currentcolor\)/i)
	})

	test("default color is the --txt-inverse CSS var", () => {
		const w = mount(Spinner)
		const style = w.attributes("style") ?? ""
		expect(style).toMatch(/var\(--txt-inverse\)/)
	})
})
