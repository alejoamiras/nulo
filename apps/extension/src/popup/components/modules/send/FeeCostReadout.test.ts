import { describe, expect, test } from "vitest"
import { mount, type VueWrapper } from "@vue/test-utils"
import FeeCostReadout from "./FeeCostReadout.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
}

const factory = (props: Record<string, unknown> = {}) => mount(FeeCostReadout, { props, global: { stubs: STUBS } })

/** Every text node's trimmed content, joined by single spaces. */
function textOf(root: Node): string {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	const parts: string[] = []
	while (walker.nextNode()) {
		const text = walker.currentNode.textContent?.trim()
		if (text) parts.push(text)
	}
	return parts.join(" ")
}

const without = (w: VueWrapper, selector: string) => {
	const clone = w.element.cloneNode(true) as Element
	for (const node of clone.querySelectorAll(selector)) node.remove()
	return textOf(clone)
}
/** What a screen reader reaches. */
const spoken = (w: VueWrapper) => without(w, '[aria-hidden="true"]')
/** What is drawn. */
const drawn = (w: VueWrapper) => without(w, '[class*="visually_hidden"]')

const ESTIMATE = { amount: "3.577824", usd: "$0.215" }

describe("FeeCostReadout", () => {
	test("idle (no estimate, not estimating) shows the simulation hint", () => {
		const w = factory()
		expect(w.text()).toContain("Fee estimated after simulation")
	})

	test("estimating without a result shows the label + skeleton", () => {
		const w = factory({ isEstimating: true })
		expect(w.text()).toBe("You pay")
		expect(w.html()).toMatch(/skeleton/)
	})

	test("estimate takes precedence over the estimating skeleton", () => {
		const w = factory({ estimate: { amount: "1.0" }, isEstimating: true })
		expect(w.text()).toContain("~1.0 FJ")
	})
})

describe("FeeCostReadout · paying yourself", () => {
	test("priced: the amount, then the dollars beside it at today's rate; drawn and spoken alike", () => {
		const w = factory({ estimate: ESTIMATE })
		expect(drawn(w)).toBe("You pay ~3.577824 FJ ($0.215)")
		expect(spoken(w)).toBe(drawn(w))
		const usd = w.find('[data-testid="fee-estimate-usd"]')
		expect(usd.text()).toBe("($0.215)")
		expect(usd.attributes("title")).toContain("today's")
		expect(w.find("s").exists()).toBe(false)
	})

	test("unpriced: FJ only, no fake dollar figure", () => {
		const w = factory({ estimate: { amount: "0.0035", usd: null } })
		expect(drawn(w)).toBe("You pay ~0.0035 FJ")
		expect(w.find('[data-testid="fee-estimate-usd"]').exists()).toBe(false)
		expect(w.text()).not.toContain("$")
	})
})

describe("FeeCostReadout · Nulo's sponsor", () => {
	test("priced: Nothing, then the fee struck through; spoken as its own sentence only", () => {
		const w = factory({ estimate: ESTIMATE, payer: "sponsor" })
		expect(drawn(w)).toBe("You pay Nothing ~3.577824 FJ ($0.215)")
		expect(w.find("s").text()).toBe("~3.577824 FJ ($0.215)")
		expect(w.find('s [data-testid="fee-estimate-usd"]').text()).toBe("($0.215)")
		expect(spoken(w)).toBe("You pay nothing. The sponsor covers about $0.215.")
	})

	test("unpriced: the struck fee in FJ, and the sentence says FJ", () => {
		const w = factory({ estimate: { amount: "3.577824", usd: null }, payer: "sponsor" })
		expect(w.find("s").text()).toBe("~3.577824 FJ")
		expect(w.find('[data-testid="fee-estimate-usd"]').exists()).toBe(false)
		expect(spoken(w)).toBe("You pay nothing. The sponsor covers about 3.577824 FJ.")
	})

	test("under a tenth of a cent: the bound is said in words", () => {
		const w = factory({ estimate: { amount: "0.004", usd: "<$0.001" }, payer: "sponsor" })
		expect(w.find("s").text()).toBe("~0.004 FJ (<$0.001)")
		expect(spoken(w)).toBe("You pay nothing. The sponsor covers less than $0.001.")
	})
})

describe("FeeCostReadout · a sponsor added by hand", () => {
	test("a dash, spoken as what Nulo can't tell; no amount and no Nothing", () => {
		const w = factory({ estimate: ESTIMATE, payer: "unvouched" })
		expect(drawn(w)).toBe("You pay —")
		expect(spoken(w)).toBe("You pay Nulo can't tell what this fee contract charges you.")
		expect(w.text()).not.toContain("Nothing")
		expect(w.text()).not.toContain("3.577824")
		expect(w.find('[data-testid="fee-estimate-usd"]').exists()).toBe(false)
	})
})
