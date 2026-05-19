/**
 * `FeeJuiceCard` is currently a static placeholder (hard-coded "0 FJC",
 * opacity 0.5, pointer-events: none) with no callers in the current
 * codebase. Tests assert the rendered shape only.
 */
import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import FeeJuiceCard from "./FeeJuiceCard.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	Dropdown: { template: '<div data-testid="stub-dropdown"><slot name="trigger" /><slot name="popup" /></div>' },
	DropdownItem: { template: '<div data-testid="stub-dropdown-item"><slot /></div>' },
}

const mountCard = () => mount(FeeJuiceCard, { global: { stubs: STUBS } })

describe("composite/FeeJuiceCard", () => {
	test("renders the wrapper with the expected card structure", () => {
		const w = mountCard()
		expect(w.html()).toMatch(/wrapper/)
		expect(w.html()).toMatch(/card/)
	})

	test("renders the 'Fee Juice' label", () => {
		const w = mountCard()
		expect(w.text()).toContain("Fee Juice")
	})

	test("renders the placeholder amount '0 FJC'", () => {
		const w = mountCard()
		expect(w.text()).toContain("0 FJC")
	})

	test("renders the 'Estimated Fee Juice' line", () => {
		const w = mountCard()
		expect(w.text()).toContain("Estimated Fee Juice")
	})

	test("renders the placeholder dollar amount '$0.00'", () => {
		const w = mountCard()
		expect(w.text()).toContain("$0.00")
	})
})
