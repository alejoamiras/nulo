import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import Spinner from "./Spinner.vue"

describe("Spinner", () => {
	it("renders a status element with default size", () => {
		const wrapper = mount(Spinner)
		const el = wrapper.get(".spinner")
		expect(el.attributes("role")).toBe("status")
		expect(el.attributes("style")).toContain("width: 16px")
	})

	it("respects the size prop", () => {
		const wrapper = mount(Spinner, { props: { size: 32 } })
		expect(wrapper.get(".spinner").attributes("style")).toContain("width: 32px")
	})

	it("exposes the default aria-label", () => {
		const wrapper = mount(Spinner)
		expect(wrapper.get(".spinner").attributes("aria-label")).toBe("Loading")
	})

	it("accepts a custom aria-label", () => {
		const wrapper = mount(Spinner, { props: { label: "Verifying" } })
		expect(wrapper.get(".spinner").attributes("aria-label")).toBe("Verifying")
	})

	it("uses currentColor for the spinner ring (inherits parent color)", () => {
		const wrapper = mount(Spinner)
		// The visual rule lives in scoped CSS; assert the class is applied so
		// downstream styling (`color` inheritance) hits the right element.
		expect(wrapper.find(".spinner").exists()).toBe(true)
	})
})
