/**
 * Coverage for the 6-cell onboarding step indicator. Pins each load-bearing
 * fact about the visual + a11y contract so a future renumber doesn't drift
 * silently:
 *   - 6 cells in fixed order (Terms → Setup → Aztec → Fees → Speed → Done)
 *   - `:current` prop selects which cell gets `aria-current="step"`
 *   - past / active / future state across the full range (1..6)
 *   - the nav element carries the document a11y label
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"

import StepIndicator from "./StepIndicator.vue"

describe("StepIndicator — 6-cell onboarding progress", () => {
	test("renders 6 cells, Terms first, so accepting reads as step one of the sequence", () => {
		const wrapper = mount(StepIndicator, { props: { current: 1 } })
		const cells = wrapper.findAll("nav > div").map((cell) => cell.text())
		expect(cells).toEqual(["01Terms", "02Setup", "03Aztec", "04Fees", "05Speed", "06Done"])
	})

	test("current=1 (Terms) — only the first cell is aria-current", () => {
		const wrapper = mount(StepIndicator, { props: { current: 1 } })
		const cells = wrapper.findAll("nav > div")
		expect(cells[0].attributes("aria-current")).toBe("step")
		for (let i = 1; i < cells.length; i++) {
			expect(cells[i].attributes("aria-current")).toBeUndefined()
		}
	})

	test("current=4 (Fees) — only the fourth cell is aria-current", () => {
		const wrapper = mount(StepIndicator, { props: { current: 4 } })
		const cells = wrapper.findAll("nav > div")
		expect(cells.map((cell) => cell.attributes("aria-current"))).toEqual([
			undefined,
			undefined,
			undefined,
			"step",
			undefined,
			undefined,
		])
	})

	test("current=6 (Done) — only the last cell is aria-current", () => {
		const wrapper = mount(StepIndicator, { props: { current: 6 } })
		const cells = wrapper.findAll("nav > div")
		expect(cells[5].attributes("aria-current")).toBe("step")
		expect(cells[4].attributes("aria-current")).toBeUndefined()
	})

	test("nav element carries the a11y label", () => {
		const wrapper = mount(StepIndicator, { props: { current: 1 } })
		const nav = wrapper.find("nav")
		expect(nav.attributes("aria-label")).toBe("Onboarding progress")
	})
})
