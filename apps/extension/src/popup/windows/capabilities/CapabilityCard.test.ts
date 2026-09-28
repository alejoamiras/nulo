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
	rowKey: "transaction",
	capId: "transaction",
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
	test("preserves the canonical 'cap-item' testid + cap-id + cap-name, and adds cap-row", () => {
		const w = factory()
		const card = w.find('[data-testid="cap-item"]')
		expect(card.exists()).toBe(true)
		expect(card.attributes("data-cap-id")).toBe("transaction")
		expect(card.attributes("data-cap-row")).toBe("transaction")
		expect(card.attributes("data-cap-name")).toBe("Send transactions")
	})

	test("a card standing for several types carries its row key and no cap-id", () => {
		const card = factory({ rowKey: "unknown", capId: undefined }).find('[data-testid="cap-item"]')
		expect(card.attributes("data-cap-row")).toBe("unknown")
		expect(card.attributes("data-cap-id")).toBeUndefined()
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

	test("the switch uses the neutral 'primary' color when on, not semantic green", () => {
		const w = factory({ selected: true, switchLabel: "Share address book" })
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

	test("granted + isUnknown variant ALSO renders the UNRECOGNIZED chip", () => {
		// Without it, "Already granted" gives no sign that a held grant is of an unrecognized type.
		const w = factory({ granted: true, isUnknown: true })
		expect(w.find('[data-testid="cap-unrecognized-badge"]').exists()).toBe(true)
	})

	test("clicking the head emits toggleExpanded (new variant)", async () => {
		const w = factory()
		await w.find('[data-testid="cap-detail-toggle"]').trigger("click")
		expect(w.emitted("toggleExpanded")).toHaveLength(1)
	})

	test("clicking the switch emits toggleSelected and never expands the card", async () => {
		const w = factory({ switchLabel: "Share address book" })
		await w.find('[data-testid="cap-toggle"]').trigger("click")
		expect(w.emitted("toggleSelected")).toHaveLength(1)
		expect(w.emitted("toggleExpanded")).toBeUndefined()
	})

	test("the switch is a named, focusable switch control reporting its state", () => {
		const on = factory({ selected: true, switchLabel: "Share private events" }).find('[data-testid="cap-toggle"]')
		expect(on.attributes("role")).toBe("switch")
		expect(on.attributes("aria-label")).toBe("Share private events")
		expect(on.attributes("aria-checked")).toBe("true")
		expect(on.attributes("tabindex")).toBe("0")
		const off = factory({ selected: false, switchLabel: "Share private events" }).find('[data-testid="cap-toggle"]')
		expect(off.attributes("aria-checked")).toBe("false")
	})

	test.each(["enter", "space"])("%s on the switch emits toggleSelected and never expands the card", async (key) => {
		const w = factory({ switchLabel: "Authorizations without asking" })
		await w.find('[data-testid="cap-toggle"]').trigger(`keydown.${key}`)
		expect(w.emitted("toggleSelected")).toHaveLength(1)
		expect(w.emitted("toggleExpanded")).toBeUndefined()
	})

	test("a disabled switch leaves the Tab order and ignores clicks and keys", async () => {
		const w = factory({ switchLabel: "Share address book", disabled: true })
		const toggle = w.find('[data-testid="cap-toggle"]')
		expect(toggle.attributes("tabindex")).toBe("-1")
		expect(toggle.attributes("aria-disabled")).toBe("true")
		await toggle.trigger("click")
		await toggle.trigger("keydown.space")
		expect(w.emitted("toggleSelected")).toBeUndefined()
	})

	test("a card without a switch name renders no switch control", () => {
		const w = factory()
		expect(w.find('[data-testid="cap-toggle"]').exists()).toBe(false)
		expect(w.find('[role="switch"]').exists()).toBe(false)
	})

	test("granted variant renders the readonly head (no cap-detail-toggle)", () => {
		const w = factory({ granted: true })
		expect(w.find('[data-testid="cap-detail-toggle"]').exists()).toBe(false)
	})

	test("expanded=true renders the detail panel", () => {
		const w = factory({ expanded: true })
		expect(w.find("[data-detail-panel]").exists()).toBe(true)
	})

	test("an expanded card renders one detail panel per panel capability", () => {
		const w = factory({
			expanded: true,
			panelCapabilities: [
				{ type: "unknown-a", foo: 1 },
				{ type: "unknown-b", foo: 2 },
			],
		})
		expect(w.findAll("[data-detail-panel]")).toHaveLength(2)
	})

	test("expanded=false hides the detail panel", () => {
		const w = factory()
		expect(w.find("[data-detail-panel]").exists()).toBe(false)
	})
})
