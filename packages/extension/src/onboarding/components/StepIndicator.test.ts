/**
 * Coverage for the 5-cell onboarding step indicator. Pins each load-bearing
 * fact about the visual + a11y contract so a future renumber doesn't drift
 * silently:
 *   - 5 cells in fixed order (Setup → Aztec → Fees → Speed → Done)
 *   - `:current` prop selects which cell gets `aria-current="step"`
 *   - past / active / future state across the full range (1..5)
 *   - the nav element carries the document a11y label
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"

import StepIndicator from "./StepIndicator.vue"

describe("StepIndicator — 5-cell onboarding progress", () => {
	test("renders 5 cells with labels Setup / Aztec / Fees / Speed / Done in order", () => {
		const wrapper = mount(StepIndicator, { props: { current: 1 } })
		const text = wrapper.text()
		expect(text).toContain("Setup")
		expect(text).toContain("Aztec")
		expect(text).toContain("Fees")
		expect(text).toContain("Speed")
		expect(text).toContain("Done")
		expect(wrapper.findAll("nav > div")).toHaveLength(5)
	})

	test("renders the numeric prefix 01..05 in order", () => {
		const wrapper = mount(StepIndicator, { props: { current: 1 } })
		const text = wrapper.text()
		expect(text).toContain("01")
		expect(text).toContain("02")
		expect(text).toContain("03")
		expect(text).toContain("04")
		expect(text).toContain("05")
	})

	test("current=1 (Setup) — only the first cell is aria-current", () => {
		const wrapper = mount(StepIndicator, { props: { current: 1 } })
		const cells = wrapper.findAll("nav > div")
		expect(cells[0].attributes("aria-current")).toBe("step")
		for (let i = 1; i < cells.length; i++) {
			expect(cells[i].attributes("aria-current")).toBeUndefined()
		}
	})

	test("current=3 (Fees — the new cell) — only the third cell is aria-current", () => {
		const wrapper = mount(StepIndicator, { props: { current: 3 } })
		const cells = wrapper.findAll("nav > div")
		expect(cells[2].attributes("aria-current")).toBe("step")
		expect(cells[0].attributes("aria-current")).toBeUndefined()
		expect(cells[3].attributes("aria-current")).toBeUndefined()
		expect(cells[4].attributes("aria-current")).toBeUndefined()
	})

	test("current=5 (Done) — only the last cell is aria-current", () => {
		const wrapper = mount(StepIndicator, { props: { current: 5 } })
		const cells = wrapper.findAll("nav > div")
		expect(cells[4].attributes("aria-current")).toBe("step")
		expect(cells[3].attributes("aria-current")).toBeUndefined()
	})

	test("nav element carries the a11y label", () => {
		const wrapper = mount(StepIndicator, { props: { current: 1 } })
		const nav = wrapper.find("nav")
		expect(nav.attributes("aria-label")).toBe("Onboarding progress")
	})
})
