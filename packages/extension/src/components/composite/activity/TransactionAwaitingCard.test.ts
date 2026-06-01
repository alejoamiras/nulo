import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import TransactionAwaitingCard from "./TransactionAwaitingCard.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	Spinner: { template: '<span data-testid="stub-spinner" />' },
	TransactionCardLayout: {
		template: `
			<div :data-testid="testId" :data-stage="stage">
				<span class="title">{{ title }}</span>
				<slot name="title-trailing" />
				<slot name="badge" />
				<slot name="secondary" />
				<slot name="actions" />
				<span class="amount">{{ amount }}</span>
				<span class="symbol">{{ amountSymbol }}</span>
			</div>
		`,
		props: ["title", "icon", "amount", "amountSymbol", "testId", "stage"],
	},
}

const mountCard = (props: Record<string, unknown> = {}) => mount(TransactionAwaitingCard, { props, global: { stubs: STUBS } })

describe("composite/TransactionAwaitingCard", () => {
	test("renders the default title 'Creating transaction'", () => {
		const w = mountCard()
		expect(w.text()).toContain("Creating transaction")
	})

	test("renders the default subtitle 'Preparing...'", () => {
		const w = mountCard()
		expect(w.text()).toContain("Preparing...")
	})

	test("custom title prop overrides the default", () => {
		const w = mountCard({ title: "Sending 5 USDC" })
		expect(w.text()).toContain("Sending 5 USDC")
	})

	test("renders a Spinner stub in the badge slot of the layout", () => {
		const w = mountCard()
		expect(w.find("[data-testid='stub-spinner']").exists()).toBe(true)
	})

	test("originLabel prop renders an origin chip when provided", () => {
		const w = mountCard({ originLabel: "example.dapp.io" })
		expect(w.text()).toContain("example.dapp.io")
	})

	test("originLabel is suppressed when not provided", () => {
		const w = mountCard()
		expect(w.html()).not.toMatch(/origin_chip/)
	})

	test("forwards the testId 'tx-awaiting-card' to the underlying layout", () => {
		const w = mountCard()
		expect(w.find("[data-testid='tx-awaiting-card']").exists()).toBe(true)
	})

	test("forwards the stage prop to the underlying layout (e2e selector contract)", () => {
		// E2E tests wait for `[data-testid="tx-awaiting-card"][data-stage="proving"]`
		// via waitForSendTxProvingStage. Contract: this card threads its `stage`
		// prop through to TransactionCardLayout, which renders it as `data-stage`
		// on the root (real binding tested in TransactionCardLayout.test.ts).
		const w = mountCard({ stage: "proving" })
		expect(w.find("[data-testid='tx-awaiting-card']").attributes("data-stage")).toBe("proving")
	})

	test("forwards amount + amountSymbol props to the layout", () => {
		const w = mountCard({ amount: "5.00", amountSymbol: "USDC" })
		expect(w.text()).toContain("5.00")
		expect(w.text()).toContain("USDC")
	})

	test("transferTypeLabel renders a chip when provided; suppressed when null", () => {
		const withChip = mountCard({ transferTypeLabel: "Private → Public" })
		expect(withChip.text()).toContain("Private → Public")
		expect(withChip.html()).toMatch(/transfer_chip/)

		const noChip = mountCard()
		expect(noChip.html()).not.toMatch(/transfer_chip/)
	})

	// Chip-fit contract: subtitle ellipsis-classes + aria-atomic + the chip
	// uses the single merged class. transferTypeLabel and originLabel are
	// mutually exclusive on the chip — transfer ops carry the first, dApp
	// ops carry the second; the template prefers transferTypeLabel.
	test("subtitle has chip-fit classes; chip renders for either chip prop", () => {
		const w = mountCard({ subtitle: "Generating proof...", transferTypeLabel: "Private → Public" })
		const subtitleSpan = w.find('[role="status"]')
		expect(subtitleSpan.attributes("class")).toMatch(/subtitle/)
		expect(subtitleSpan.attributes("aria-atomic")).toBe("true")
		expect(w.html()).toMatch(/transfer_chip/)
		expect(w.text()).toContain("Private → Public")

		const dapp = mountCard({ subtitle: "Generating proof...", originLabel: "example.dapp.io" })
		expect(dapp.html()).toMatch(/transfer_chip/)
		expect(dapp.text()).toContain("example.dapp.io")
	})

	// Phase 2 follow-up: Cancel surface.
	describe("Cancel button (Phase 2)", () => {
		test("renders Cancel button when cancellable + jobId + stage != submitting", () => {
			const w = mountCard({ cancellable: true, jobId: "abc123", stage: "proving" })
			expect(w.find('[data-testid="tx-awaiting-cancel"]').exists()).toBe(true)
		})

		test("does NOT render when cancellable is false", () => {
			const w = mountCard({ cancellable: false, jobId: "abc123", stage: "proving" })
			expect(w.find('[data-testid="tx-awaiting-cancel"]').exists()).toBe(false)
		})

		test("does NOT render when jobId is null (defensive)", () => {
			const w = mountCard({ cancellable: true, jobId: null, stage: "proving" })
			expect(w.find('[data-testid="tx-awaiting-cancel"]').exists()).toBe(false)
		})

		test("hides when stage is 'submitting' (FSM forbids cancel; removing the affordance is honest)", () => {
			const w = mountCard({ cancellable: true, jobId: "abc123", stage: "submitting" })
			expect(w.find('[data-testid="tx-awaiting-cancel"]').exists()).toBe(false)
		})

		test("clicking the button emits 'cancel' with the card's jobId payload", async () => {
			const w = mountCard({ cancellable: true, jobId: "abc123", stage: "proving" })
			await w.find('[data-testid="tx-awaiting-cancel"]').trigger("click")
			const events = w.emitted("cancel")
			expect(events).toBeTruthy()
			expect(events?.[0]).toEqual(["abc123"])
		})
	})
})
