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

	test("renders the risk word in uppercase", () => {
		expect(factory({ risk: "low" }).text()).toContain("LOW")
		expect(factory({ risk: "medium" }).text()).toContain("MED")
		expect(factory({ risk: "high" }).text()).toContain("HIGH")
	})

	test("exposes data-cap-risk as the authoritative selector for e2e + screenshots", () => {
		const w = factory({ risk: "medium" })
		const tag = w.find("[data-cap-risk]")
		expect(tag.exists()).toBe(true)
		expect(tag.attributes("data-cap-risk")).toBe("medium")
	})

	test("renders the risk glyph next to the word", () => {
		// Glyphs are wallet-controlled (the wire `risk` field doesn't exist).
		// Pin the mapping so a future copy edit can't accidentally swap glyphs.
		expect(factory({ risk: "high" }).text()).toContain("▲")
		expect(factory({ risk: "medium" }).text()).toContain("●")
		expect(factory({ risk: "low" }).text()).toContain("—")
	})

	test("checkbox uses neutral 'primary' color when checked, not semantic green", () => {
		// Phase 2: drop the saturated green check; checkbox stays brutalist mono.
		const w = factory({ selected: true })
		const check = w.find('i[data-name="check-circle"]')
		expect(check.exists()).toBe(true)
		expect(check.attributes("data-color")).toBe("primary")
	})

	test("re-requested badge appears when reRequested=true", () => {
		const w = factory({ reRequested: true })
		expect(w.find('[data-testid="cap-rerequested-badge"]').exists()).toBe(true)
	})

	test("re-requested badge is hidden by default", () => {
		const w = factory()
		expect(w.find('[data-testid="cap-rerequested-badge"]').exists()).toBe(false)
	})

	test("unrecognized badge appears when isUnknown=true", () => {
		const w = factory({ isUnknown: true })
		expect(w.find('[data-testid="cap-unrecognized-badge"]').exists()).toBe(true)
		expect(w.text().toLowerCase()).toContain("unrecognized")
	})

	test("unrecognized badge is hidden when isUnknown is not set", () => {
		const w = factory()
		expect(w.find('[data-testid="cap-unrecognized-badge"]').exists()).toBe(false)
	})

	test("both badges coexist when an unknown cap was previously denied", () => {
		// Edge case: a dApp re-requests an unknown capability that the user
		// previously rejected. Both warning signals should show.
		const w = factory({ isUnknown: true, reRequested: true })
		expect(w.find('[data-testid="cap-unrecognized-badge"]').exists()).toBe(true)
		expect(w.find('[data-testid="cap-rerequested-badge"]').exists()).toBe(true)
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
