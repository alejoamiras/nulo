import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import Tag from "./Tag.vue"

describe("Tag", () => {
	it("renders slot content", () => {
		const wrapper = mount(Tag, { slots: { default: "Test token" } })
		expect(wrapper.text()).toBe("Test token")
	})

	it("defaults to neutral tone", () => {
		const wrapper = mount(Tag, { slots: { default: "x" } })
		expect(wrapper.get(".tag").classes()).toContain("tag--neutral")
	})

	it("applies the test tone class", () => {
		const wrapper = mount(Tag, { props: { tone: "test" }, slots: { default: "x" } })
		expect(wrapper.get(".tag").classes()).toContain("tag--test")
	})

	it("applies the warn tone class", () => {
		const wrapper = mount(Tag, { props: { tone: "warn" }, slots: { default: "x" } })
		expect(wrapper.get(".tag").classes()).toContain("tag--warn")
	})

	it("forwards data-testid attribute to the root", () => {
		const wrapper = mount(Tag, {
			attrs: { "data-testid": "fa-tag-disclaimer" },
			slots: { default: "x" },
		})
		expect(wrapper.get(".tag").attributes("data-testid")).toBe("fa-tag-disclaimer")
	})
})
