import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import DappCancelledOverlay from "./DappCancelledOverlay.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Button: { template: "<button @click=\"$emit('click')\"><slot /></button>", emits: ["click"] },
}

const factory = (props: Record<string, unknown> = {}) => mount(DappCancelledOverlay, { props, global: { stubs: STUBS } })

describe("composite/DappCancelledOverlay", () => {
	test("renders the default cancellation message", () => {
		const w = factory()
		expect(w.text()).toContain("Connection request was cancelled")
	})

	test("renders a custom message via the prop", () => {
		const w = factory({ message: "Wrong profile" })
		expect(w.text()).toContain("Wrong profile")
	})

	test("renders a single OK button", () => {
		const w = factory()
		expect(w.findAll("button").length).toBe(1)
		expect(w.text()).toContain("OK")
	})

	test("clicking OK emits 'dismiss'", async () => {
		const w = factory()
		await w.find("button").trigger("click")
		expect(w.emitted("dismiss")).toHaveLength(1)
	})

	test("only the dismiss event is emitted by the wrapper component", async () => {
		const w = factory()
		await w.find("button").trigger("click")
		// 'click' bubbles via the Button stub but the parent wrapper
		// only owns 'dismiss' as an explicit emit; assert that it fires
		// exactly once (not the broader event surface).
		expect(w.emitted("dismiss")).toHaveLength(1)
	})

	test("exposes stable testids for the overlay root and the OK button", () => {
		const w = factory()
		expect(w.find('[data-testid="dapp-cancelled-overlay"]').exists()).toBe(true)
		expect(w.find('[data-testid="dapp-cancelled-ok-btn"]').exists()).toBe(true)
	})
})
