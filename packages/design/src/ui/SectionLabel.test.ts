import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import SectionLabel from "./SectionLabel.vue"

describe("ui/SectionLabel", () => {
	test("renders the label prop text", () => {
		const w = mount(SectionLabel, { props: { label: "Profiles" } })
		expect(w.text()).toContain("Profiles")
	})

	test("count is hidden when not provided (default null)", () => {
		const w = mount(SectionLabel, { props: { label: "Profiles" } })
		const html = w.html()
		expect(html).not.toMatch(/class="[^"]*count[^"]*"/)
	})

	test("numeric count is rendered", () => {
		const w = mount(SectionLabel, { props: { label: "Profiles", count: 5 } })
		expect(w.text()).toContain("5")
	})

	test("count=0 is rendered (zero is a meaningful display)", () => {
		const w = mount(SectionLabel, { props: { label: "Profiles", count: 0 } })
		expect(w.text()).toContain("0")
	})

	test("string count is rendered as-is (e.g. '12+')", () => {
		const w = mount(SectionLabel, { props: { label: "Profiles", count: "12+" } })
		expect(w.text()).toContain("12+")
	})
})
