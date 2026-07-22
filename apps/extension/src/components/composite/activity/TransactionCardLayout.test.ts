import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import { defineComponent, h, nextTick, ref } from "vue"
import TransactionCardLayout from "./TransactionCardLayout.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
}

const mountLayout = (props: Record<string, unknown> = {}, slots: Record<string, string | (() => unknown)> = {}) =>
	mount(TransactionCardLayout, {
		props: { title: "Test title", icon: "zap", ...props },
		slots,
		global: { stubs: STUBS },
	})

describe("composite/TransactionCardLayout", () => {
	test("renders the title prop in the title slot", () => {
		const w = mountLayout({ title: "Sending 5 USDC" })
		expect(w.text()).toContain("Sending 5 USDC")
	})

	test("renders an Icon for the activity icon prop", () => {
		const w = mountLayout({ icon: "zap" })
		expect(w.find('[data-name="zap"]').exists()).toBe(true)
	})

	test("badge slot renders inside the activity icon's badge wrapper", () => {
		const w = mountLayout({}, { badge: "<span data-testid='badge-content'>!</span>" })
		expect(w.find("[data-testid='badge-content']").exists()).toBe(true)
		expect(w.html()).toMatch(/badge/)
	})

	test("badge wrapper does NOT render when no badge slot is provided", () => {
		const w = mountLayout()
		// No `.badge` class block should exist when slot is empty.
		const html = w.html()
		expect(html).not.toMatch(/class="[^"]*\bbadge\b/)
	})

	test("secondary slot renders inside the secondary row", () => {
		const w = mountLayout({}, { secondary: "<span data-testid='secondary-content'>subline</span>" })
		expect(w.find("[data-testid='secondary-content']").exists()).toBe(true)
	})

	test("title-trailing slot renders inline next to the title", () => {
		const w = mountLayout({}, { "title-trailing": "<span data-testid='trailing'>↗</span>" })
		expect(w.find("[data-testid='trailing']").exists()).toBe(true)
	})

	test("amount + amountSymbol render in the right column when both provided", () => {
		const w = mountLayout({ amount: "5.00", amountSymbol: "USDC" })
		expect(w.text()).toContain("5.00")
		expect(w.text()).toContain("USDC")
	})

	test("amount column is suppressed when amount is null/empty", () => {
		const w = mountLayout()
		expect(w.html()).not.toMatch(/class="[^"]*amount_col/)
	})

	test("testId prop is forwarded to the wrapper as data-testid", () => {
		const w = mountLayout({ testId: "custom-tx-card" })
		expect(w.find("[data-testid='custom-tx-card']").exists()).toBe(true)
	})

	test("tx-* pass-through props render as data-tx-* attributes on the root", () => {
		const w = mountLayout({
			testId: "tx-card",
			txAmountDisplay: "10",
			txTransferTypeLabel: "Public → Public",
			txStatus: "confirmed",
			txHash: "0xabcd1234",
		})
		const root = w.find("[data-testid='tx-card']")
		expect(root.attributes("data-tx-amount-display")).toBe("10")
		expect(root.attributes("data-tx-transfer-type")).toBe("Public → Public")
		expect(root.attributes("data-tx-status")).toBe("confirmed")
		expect(root.attributes("data-tx-hash")).toBe("0xabcd1234")
	})

	test("tx-* attributes are omitted when their props are undefined (awaiting/terminal phase)", () => {
		const w = mountLayout({ testId: "tx-card" })
		const root = w.find("[data-testid='tx-card']")
		expect(root.attributes("data-tx-amount-display")).toBeUndefined()
		expect(root.attributes("data-tx-transfer-type")).toBeUndefined()
		expect(root.attributes("data-tx-status")).toBeUndefined()
		expect(root.attributes("data-tx-hash")).toBeUndefined()
	})

	test("data-tx-status renders the literal string for each lifecycle state", () => {
		const states = ["pending", "confirmed", "failed", "unknown"]
		for (const s of states) {
			const w = mountLayout({ testId: "tx-card", txStatus: s })
			expect(w.find("[data-testid='tx-card']").attributes("data-tx-status")).toBe(s)
		}
	})

	test("stage prop renders as data-stage on the root for each journal stage", () => {
		// Journal FSM (canonical: packages/wallet-core/src/jobs/types.ts JobStage).
		// e2e tests synchronize on `data-stage` via waitForSendTxProvingStage to
		// avoid waiting on the dApp's full sendTx promise on slow CI runners.
		const stages = ["pending", "queued", "simulating", "proving", "submitting", "succeeded", "failed", "cancelled"]
		for (const s of stages) {
			const w = mountLayout({ testId: "tx-card", stage: s })
			expect(w.find("[data-testid='tx-card']").attributes("data-stage")).toBe(s)
		}
	})

	test("data-stage is omitted when stage prop is undefined (settled phase)", () => {
		const w = mountLayout({ testId: "tx-card" })
		expect(w.find("[data-testid='tx-card']").attributes("data-stage")).toBeUndefined()
	})

	// Phase 2 follow-up v4: visual clash fix. The wrapper gains a
	// `wrapper_has_actions` modifier class when the `#actions` slot is
	// filled, which adds `padding-right: 36px` so the absolute-positioned
	// action button doesn't overlap the amount column on transfer cards.
	test("wrapper has `wrapper_has_actions` modifier when the actions slot is filled", () => {
		const w = mountLayout({}, { actions: "<button data-testid='action'>X</button>" })
		expect(w.html()).toMatch(/wrapper_has_actions/)
	})

	test("wrapper does NOT have the modifier when the actions slot is empty", () => {
		const w = mountLayout()
		expect(w.html()).not.toMatch(/wrapper_has_actions/)
	})

	// A parent template like `<template #actions><Btn v-if="cancellable"/></template>`
	// declares the slot but can render zero VNodes when the condition is false.
	// `$slots.actions` is still truthy in that case, so we must invoke the slot
	// and check VNode count; otherwise the wrapper picks up 36px of right-padding
	// for nothing and the empty `.actions` container ships in the DOM.
	test("wrapper does NOT have the modifier when actions slot is declared but renders nothing", () => {
		// A parent like `<template #actions><Btn v-if="cancellable"/></template>`
		// with `cancellable=false` declares the slot function but produces zero
		// real VNodes. Modeled here with a function slot returning null.
		const w = mountLayout({}, { actions: () => null })
		expect(w.html()).not.toMatch(/wrapper_has_actions/)
		expect(w.html()).not.toMatch(/class="[^"]*\bactions\b/)
	})

	// Regression: the first cut of the slot-filled check used a `computed()` —
	// but slot vnodes aren't reactive deps, so the computed cached the FIRST
	// evaluation and never re-ran when the parent's `<template v-if="..." #actions>`
	// later started declaring the slot. Result in production: cancellable cards
	// mounted before the v-if condition flipped true rendered with no X and no
	// padding for the rest of the awaiting phase. This test wraps the layout in
	// a parent whose v-if toggles after mount and asserts the modifier follows.
	test("wrapper reacts when a parent's conditional #actions slot becomes active after mount", async () => {
		const show = ref(false)
		const Parent = defineComponent({
			setup() {
				return () =>
					h(
						TransactionCardLayout,
						{ title: "Test title", icon: "zap" },
						{
							actions: show.value ? () => h("button", { "data-testid": "x" }, "X") : undefined,
						},
					)
			},
		})
		const w = mount(Parent, { global: { stubs: STUBS } })
		expect(w.html()).not.toMatch(/wrapper_has_actions/)
		show.value = true
		await nextTick()
		expect(w.html()).toMatch(/wrapper_has_actions/)
		expect(w.find("[data-testid='x']").exists()).toBe(true)
	})
})

describe("composite/TransactionCardLayout — amountFiat (D2 activity rows)", () => {
	test("renders the fiat line under the amount when provided", () => {
		const w = mountLayout({ amount: "−125.00", amountSymbol: "cUSD", amountFiat: "≈ $124.98" })
		const fiat = w.find('[data-testid="activity-fiat"]')
		expect(fiat.exists()).toBe(true)
		expect(fiat.text()).toBe("≈ $124.98")
		expect(fiat.attributes("title")).toBe("At today's price")
	})

	test("no fiat element when amountFiat is null (unpriced — never a fake $0.00)", () => {
		const w = mountLayout({ amount: "−125.00", amountSymbol: "TST" })
		expect(w.find('[data-testid="activity-fiat"]').exists()).toBe(false)
		expect(w.text()).not.toContain("$")
	})

	test("no fiat element without an amount at all", () => {
		const w = mountLayout({ amountFiat: "≈ $1.00" })
		expect(w.find('[data-testid="activity-fiat"]').exists()).toBe(false)
	})
})
