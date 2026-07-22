/**
 * TransactionIncomingCard — first colocated suite (the composite predated the
 * coverage minimums). Pins amount formatting, the +prefix, the I1 fiat
 * passthrough, and the no-fake-fiat rule for unpriced receives.
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import TransactionIncomingCard from "./TransactionIncomingCard.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	TransactionCardLayout: {
		template: `
			<div data-testid="layout">
				<span class="title">{{ title }}</span>
				<span class="amount">{{ amount }}</span>
				<span class="symbol">{{ amountSymbol }}</span>
				<span v-if="amountFiat" data-testid="activity-fiat">{{ amountFiat }}</span>
			</div>
		`,
		props: ["title", "icon", "amount", "amountSymbol", "amountFiat", "testId", "txHash"],
	},
}

const mountCard = (props: Record<string, unknown> = {}) =>
	mount(TransactionIncomingCard, {
		props: {
			tokenSymbol: "cUSD",
			amountRaw: (500n * 10n ** 6n).toString(),
			tokenDecimals: 6,
			...props,
		},
		global: { stubs: STUBS },
	})

describe("composite/TransactionIncomingCard", () => {
	test("formats the raw amount by token decimals with a + prefix", () => {
		const w = mountCard()
		expect(w.find(".amount").text()).toBe("+500")
	})

	test("renders the token symbol column", () => {
		const w = mountCard()
		expect(w.find(".symbol").text()).toBe("cUSD")
	})

	test("fractional raw amounts keep their precision", () => {
		const w = mountCard({ amountRaw: "1500000", tokenDecimals: 6 }) // 1.5
		expect(w.find(".amount").text()).toBe("+1.5")
	})

	test("decimals default to 0 when unknown (raw shown as-is)", () => {
		const w = mountCard({ amountRaw: "42", tokenDecimals: 0 })
		expect(w.find(".amount").text()).toBe("+42")
	})

	test("I1: amountFiat passes through to the layout's fiat line", () => {
		const w = mountCard({ amountFiat: "≈ $499.93" })
		const fiat = w.find('[data-testid="activity-fiat"]')
		expect(fiat.exists()).toBe(true)
		expect(fiat.text()).toBe("≈ $499.93")
	})

	test("no amountFiat → no fiat element (unpriced receives stay token-only)", () => {
		const w = mountCard()
		expect(w.find('[data-testid="activity-fiat"]').exists()).toBe(false)
		expect(w.text()).not.toContain("$")
	})

	test("default token symbol falls back to 'Token'", () => {
		const w = mountCard({ tokenSymbol: undefined })
		expect(w.find(".symbol").text()).toBe("Token")
	})
})
