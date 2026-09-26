/**
 * TransactionIncomingCard — first colocated suite (the composite predated the
 * coverage minimums). Pins amount formatting, the +prefix, the I1 fiat
 * passthrough, and the no-fake-fiat rule for unpriced receives.
 */

import { flushPromises, mount } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"
import { createMemoryHistory, createRouter } from "vue-router"
import TransactionIncomingCard from "./TransactionIncomingCard.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	TransactionCardLayout: {
		template: `
			<div data-testid="layout">
				<span class="title">{{ title }}</span>
				<span class="title-trailing"><slot name="title-trailing" /></span>
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

	test("kind chip defaults to 'Received' (testid tx-incoming-kind-chip)", () => {
		const chip = mountCard().find('[data-testid="tx-incoming-kind-chip"]')
		expect(chip.exists()).toBe(true)
		expect(chip.text()).toBe("Received")
	})

	test("kind chip renders the resolved receivedLabel (D5-D)", () => {
		const chip = mountCard({ receivedLabel: "Private → Public" }).find('[data-testid="tx-incoming-kind-chip"]')
		expect(chip.text()).toBe("Private → Public")
	})
})

describe("composite/TransactionIncomingCard — the row, on the real layout and router", () => {
	const { TransactionCardLayout: _stub, ...ATOMS } = STUBS
	const makeRouter = () =>
		createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] })
	const mountRow = async (props: Record<string, unknown> = {}) => {
		const router = makeRouter()
		await router.push("/popup/general")
		const push = vi.spyOn(router, "push")
		const w = mount(TransactionIncomingCard, {
			props: { tokenSymbol: "cUSD", amountRaw: (500n * 10n ** 6n).toString(), tokenDecimals: 6, to: "/popup/received/r1", ...props },
			global: { stubs: ATOMS, plugins: [router] },
			attachTo: document.body,
		})
		return { w, router, push }
	}

	test("the row links to its receipt, named by the token", async () => {
		const { w } = await mountRow()
		const target = w.find("[data-row-target]")
		expect(target.element.tagName).toBe("A")
		expect(target.attributes("href")).toBe("/popup/received/r1")
		expect(w.find(`#${target.attributes("aria-labelledby")}`).text()).toBe("cUSD")
		w.unmount()
	})

	test("the priced span keeps its title, sits outside the target above it, and a click opens the row once", async () => {
		const { w, router, push } = await mountRow({ amountFiat: "≈ $499.93" })
		const fiat = w.find('[data-testid="activity-fiat"]')
		expect(fiat.attributes("title")).toBe("At today's price")
		expect(fiat.classes().some((c) => c.includes("raised"))).toBe(true)
		expect(w.find("[data-row-target]").find('[data-testid="activity-fiat"]').exists()).toBe(false)
		await fiat.trigger("click")
		await flushPromises()
		expect(push).toHaveBeenCalledTimes(1)
		expect(router.currentRoute.value.path).toBe("/popup/received/r1")
		w.unmount()
	})

	test.each([-1, 1.5, 1000])("tokenDecimals %s renders the row without an amount column and without throwing", async (decimals) => {
		const { w } = await mountRow({ tokenDecimals: decimals, amountFiat: "≈ $1.00" })
		expect(w.find('[data-testid="tx-incoming-card"]').exists()).toBe(true)
		expect(w.text()).not.toContain("+")
		expect(w.find('[data-testid="activity-fiat"]').exists()).toBe(false)
		w.unmount()
	})

	test("`arriving` stamps the root", async () => {
		const { w } = await mountRow({ arriving: true })
		expect(w.find('[data-testid="tx-incoming-card"]').attributes("data-arriving")).toBe("true")
		w.unmount()
	})

	test("a receipt whose token has invalid decimals still plays, with no amount column", async () => {
		const { w } = await mountRow({ arriving: true, tokenDecimals: 1.5 })
		const root = w.find('[data-testid="tx-incoming-card"]')
		expect(root.attributes("data-arriving")).toBe("true")
		expect(root.classes().some((c) => c.includes("n-row-glow"))).toBe(true)
		expect(w.text()).not.toContain("+")
		w.unmount()
	})
})
