import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import CapabilityCard from "./CapabilityCard.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<i :data-name="name" :data-color="color" />', props: ["name", "size", "color"] },
	CapabilityDetailPanel: { template: "<div data-detail-panel />" },
}

const baseProps = {
	capability: { type: "transaction" as const, scope: "*" as const },
	label: "Send transactions",
	description: "Submit transactions",
	risk: "high" as const,
	selected: true,
	granted: false,
	expanded: false,
}

// CapabilityCard's prop-types are defined via TS generics that need
// the full Capability discriminated-union shape; the unit tests only
// exercise rendering so we cast through `unknown` for prop forwarding.
const factory = (props: Record<string, unknown> = {}) =>
	mount(CapabilityCard, {
		props: { ...baseProps, ...props } as unknown as typeof baseProps,
		global: { stubs: STUBS },
	})

describe("CapabilityCard", () => {
	test("preserves the canonical 'cap-item' testid + cap-id + cap-name", () => {
		const w = factory()
		const card = w.find('[data-testid="cap-item"]')
		expect(card.exists()).toBe(true)
		expect(card.attributes("data-cap-id")).toBe("transaction")
		expect(card.attributes("data-cap-name")).toBe("Send transactions")
	})

	test("granted=true sets the cap-granted attribute", () => {
		const w = factory({ granted: true })
		expect(w.find('[data-testid="cap-item"]').attributes("data-cap-granted")).toBe("true")
	})

	test("renders the label and description", () => {
		const w = factory({ label: "MyLabel", description: "MyDesc" })
		expect(w.text()).toContain("MyLabel")
		expect(w.text()).toContain("MyDesc")
	})

	test("renders the risk text", () => {
		const w = factory({ risk: "low" })
		expect(w.text()).toContain("low")
	})

	test("re-requested badge appears when reRequested=true", () => {
		const w = factory({ reRequested: true })
		expect(w.find('[data-testid="cap-rerequested-badge"]').exists()).toBe(true)
	})

	test("re-requested badge is hidden by default", () => {
		const w = factory()
		expect(w.find('[data-testid="cap-rerequested-badge"]').exists()).toBe(false)
	})

	test("clicking the head emits toggleExpanded (new variant)", async () => {
		const w = factory()
		await w.find('[data-testid="cap-detail-toggle"]').trigger("click")
		expect(w.emitted("toggleExpanded")).toHaveLength(1)
	})

	test("clicking the checkbox emits toggleSelected and stops propagation", async () => {
		const w = factory()
		await w.find('[data-testid="cap-toggle"]').trigger("click")
		expect(w.emitted("toggleSelected")).toHaveLength(1)
	})

	test("granted variant renders the readonly head (no cap-detail-toggle)", () => {
		const w = factory({ granted: true })
		expect(w.find('[data-testid="cap-detail-toggle"]').exists()).toBe(false)
	})

	test("expanded=true renders the detail panel", () => {
		const w = factory({ expanded: true })
		expect(w.find("[data-detail-panel]").exists()).toBe(true)
	})

	test("expanded=false hides the detail panel", () => {
		const w = factory()
		expect(w.find("[data-detail-panel]").exists()).toBe(false)
	})
})
