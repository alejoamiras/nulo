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

describe("FeeCostReadout — fee USD (D2 + round-3 1b)", () => {
	test("estimate WITH usd → parenthesized beside the FJ amount, today's-rate tooltip", () => {
		const w = factory({ estimate: { amount: "0.0035", usd: "$0.007" } })
		expect(w.text()).toContain("~0.0035 FJ")
		const usd = w.find('[data-testid="fee-estimate-usd"]')
		expect(usd.exists()).toBe(true)
		expect(usd.text()).toBe("($0.007)")
		expect(usd.attributes("title")).toContain("today's")
	})

	test("estimate WITHOUT usd (no live quote) → FJ only, no fake dollar figure", () => {
		const w = factory({ estimate: { amount: "0.0035", usd: null } })
		expect(w.text()).toContain("~0.0035 FJ")
		expect(w.find('[data-testid="fee-estimate-usd"]').exists()).toBe(false)
		expect(w.text()).not.toContain("$")
	})
})
