/**
 * TransactionTerminalCard — colocated unit tests (Phase 2 follow-up).
 *
 * Mirrors the `TransactionAwaitingCard.test.ts` pattern: stub the layout
 * + atoms, mount the card with various prop combinations, assert that
 * the props flow through to the right slots / classes / data attrs.
 *
 * No journal-state mapping logic here — the card is presentational only;
 * `@/utils/journal-state.ts` owns the kind → display mapping and has its
 * own test suite. This file pins the *rendering* contract.
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import TransactionTerminalCard from "./TransactionTerminalCard.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: {
		template: '<span data-testid="stub-icon" :data-name="name" :data-color="color" />',
		props: ["name", "size", "color"],
	},
	Spinner: { template: '<span data-testid="stub-spinner" />' },
	TransactionCardLayout: {
		template: `
			<div :data-testid="testId">
				<span class="title">{{ title }}</span>
				<slot name="title-trailing" />
				<span class="layout-icon" :data-icon="icon" />
				<slot name="badge" />
				<slot name="secondary" />
				<slot name="actions" />
				<span class="amount">{{ amount }}</span>
				<span class="symbol">{{ amountSymbol }}</span>
			</div>
		`,
		props: ["title", "icon", "amount", "amountSymbol", "testId"],
	},
}

type CardProps = {
	title: string
	subtitle: string
	icon: string
	color: "gray" | "amber" | "red"
	activityIcon?: string
	originLabel?: string | null
	transferTypeLabel?: string | null
	amount?: string | null
	amountSymbol?: string | null
}

const CANCELLED: CardProps = { title: "swap", subtitle: "Cancelled", icon: "cancel", color: "gray" }
const INTERRUPTED: CardProps = { title: "swap", subtitle: "Transaction was interrupted", icon: "refresh-circle", color: "amber" }
const FAILED: CardProps = { title: "swap", subtitle: "Network error", icon: "close-circle", color: "red" }

const mountCard = (props: CardProps) => mount(TransactionTerminalCard, { props, global: { stubs: STUBS } })

describe("composite/TransactionTerminalCard", () => {
	test("renders the title verbatim", () => {
		const w = mountCard({ ...FAILED, title: "Sending 5 USDC" })
		expect(w.text()).toContain("Sending 5 USDC")
	})

	test("renders the subtitle verbatim", () => {
		const w = mountCard({ ...INTERRUPTED, subtitle: "Transaction was interrupted" })
		expect(w.text()).toContain("Transaction was interrupted")
	})

	test("subtitle status region is atomic (cross-AT consistency per WAI ARIA-22)", () => {
		const w = mountCard(CANCELLED)
		const statusEl = w.find('[role="status"]')
		expect(statusEl.attributes("aria-live")).toBe("polite")
		expect(statusEl.attributes("aria-atomic")).toBe("true")
	})

	test("Cancelled state: gray status icon + cancel", () => {
		const w = mountCard(CANCELLED)
		const badgeIcon = w.find('[data-testid="stub-icon"][data-color="gray"]')
		expect(badgeIcon.exists()).toBe(true)
		expect(badgeIcon.attributes("data-name")).toBe("cancel")
	})

	test("Interrupted state: amber status icon + refresh-circle", () => {
		const w = mountCard(INTERRUPTED)
		const badgeIcon = w.find('[data-testid="stub-icon"][data-color="amber"]')
		expect(badgeIcon.exists()).toBe(true)
		expect(badgeIcon.attributes("data-name")).toBe("refresh-circle")
	})

	test("Failed state: red status icon + close-circle", () => {
		const w = mountCard(FAILED)
		const badgeIcon = w.find('[data-testid="stub-icon"][data-color="red"]')
		expect(badgeIcon.exists()).toBe(true)
		expect(badgeIcon.attributes("data-name")).toBe("close-circle")
	})

	test("renders originLabel chip when supplied (dApp terminal)", () => {
		const w = mountCard({ ...FAILED, originLabel: "swap.aztec-kit.example" })
		expect(w.text()).toContain("swap.aztec-kit.example")
		expect(w.html()).toMatch(/chip/)
	})

	test("renders transferTypeLabel chip when supplied (UI transfer terminal)", () => {
		const w = mountCard({ ...CANCELLED, transferTypeLabel: "Private → Private" })
		expect(w.text()).toContain("Private → Private")
		expect(w.html()).toMatch(/chip/)
	})

	test("suppresses chip when neither originLabel nor transferTypeLabel is set", () => {
		const w = mountCard(FAILED)
		expect(w.text()).not.toContain("undefined")
		expect(w.html()).not.toMatch(/title_sep/)
	})

	test("amount + amountSymbol flow through to the layout (transfer card case)", () => {
		const w = mountCard({ ...FAILED, amount: "5.00", amountSymbol: "USDC" })
		expect(w.text()).toContain("5.00")
		expect(w.text()).toContain("USDC")
	})

	test("activityIcon prop overrides the default 'zap' on the layout", () => {
		const w = mountCard({ ...FAILED, activityIcon: "arrow-narrow-up-right" })
		expect(w.find(".layout-icon").attributes("data-icon")).toBe("arrow-narrow-up-right")
	})

	test("defaults activityIcon to 'zap' when not supplied (dApp generic case)", () => {
		const w = mountCard(FAILED)
		expect(w.find(".layout-icon").attributes("data-icon")).toBe("zap")
	})

	test("testId attribute is 'tx-terminal-card' for e2e selectors", () => {
		const w = mountCard(FAILED)
		expect(w.find('[data-testid="tx-terminal-card"]').exists()).toBe(true)
	})
})
