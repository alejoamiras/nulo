import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import Spinner from "./Spinner.vue"

describe("Spinner (canonical superset)", () => {
	it("renders a status div with the wrapper class + default size", () => {
		const w = mount(Spinner)
		expect(w.element.tagName).toBe("DIV")
		expect(w.attributes("class")).toMatch(/wrapper/)
		expect(w.attributes("role")).toBe("status")
		expect(w.attributes("style")).toMatch(/width:\s*16px/)
		expect(w.attributes("style")).toMatch(/height:\s*16px/)
	})

	it("accepts size as a string or a number", () => {
		expect(mount(Spinner, { props: { size: "32" } }).attributes("style")).toMatch(/width:\s*32px/)
		expect(mount(Spinner, { props: { size: 24 } }).attributes("style")).toMatch(/width:\s*24px/)
	})

	it("wraps a `--`-prefixed color in var()", () => {
		const style = mount(Spinner, { props: { color: "--nulo-accent" } }).attributes("style") ?? ""
		expect(style).toMatch(/var\(--nulo-accent\)/)
	})

	it("uses a non-`--` color verbatim", () => {
		const style = mount(Spinner, { props: { color: "currentColor" } }).attributes("style") ?? ""
		expect(style).toMatch(/currentcolor/i)
		expect(style).not.toMatch(/var\(currentcolor\)/i)
	})

	it("defaults color to currentColor (tools-stable; not a fixed token)", () => {
		// Vue folds borderTopColor into the `border-color` shorthand, so assert on the resolved color
		// rather than a specific longhand: currentColor present, no fixed --txt-inverse token, no var().
		const style = mount(Spinner).attributes("style") ?? ""
		expect(style).toMatch(/currentcolor/i)
		expect(style).not.toMatch(/--txt-inverse/)
		expect(style).not.toMatch(/var\(/)
	})

	it("exposes a configurable aria-label", () => {
		expect(mount(Spinner).attributes("aria-label")).toBe("Loading")
		expect(mount(Spinner, { props: { label: "Verifying" } }).attributes("aria-label")).toBe("Verifying")
	})
})
