import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import FeeCostReadout from "./FeeCostReadout.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
}

const factory = (props: Record<string, unknown> = {}) => mount(FeeCostReadout, { props, global: { stubs: STUBS } })

describe("FeeCostReadout", () => {
	test("idle (no estimate, not estimating) shows the simulation hint", () => {
		const w = factory()
		expect(w.text()).toContain("Fee estimated after simulation")
	})

	test("estimating without a result shows the label + skeleton", () => {
		const w = factory({ isEstimating: true })
		expect(w.text()).toContain("Estimated Network Fee")
		expect(w.text()).not.toContain("Fee estimated after simulation")
	})

	test("estimate present renders the formatted amount with FJ suffix", () => {
		const w = factory({ estimate: { amount: "0.0042" } })
		expect(w.text()).toContain("Estimated Network Fee")
		expect(w.text()).toContain("~0.0042 FJ")
	})

	test("estimate takes precedence over the estimating skeleton", () => {
		const w = factory({ estimate: { amount: "1.0" }, isEstimating: true })
		expect(w.text()).toContain("~1.0 FJ")
	})
})
