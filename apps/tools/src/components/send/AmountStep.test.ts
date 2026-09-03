import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { Direction, GasLegPlan, ResolvedToken, SendIntent, TokenBalances } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"
import AmountStep, { type RouteKind } from "./AmountStep.vue"

const sel = (t: string) => `[data-testid="${t}"]`

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"

const TOKEN = {
	chainId: 1,
	address: USDC,
	symbol: "USDC",
	name: "USD Coin",
	decimals: 6,
	source: "manifest",
	logoKey: `1:${USDC}`,
	state: { kind: "registered", registration: {}, l2Token: "0x01" },
	portal: "0xportal",
	words: { nameWord: "0x01", symbolWord: "0x02" },
	l2Token: "0x01",
} as unknown as ResolvedToken

const GAS = {
	fuelAmount: 2_000_000n,
	fuelFj: 300_000_000_000_000_000n,
	quote: 300_000_000_000_000_000n,
	minFuelOutput: 285_000_000_000_000_000n,
	route: { path: [], zeroForOnes: [] },
	capped: null,
} as unknown as GasLegPlan

type Props = {
	direction: Direction
	token: { symbol: string; decimals: number }
	resolving?: boolean
	balances: TokenBalances
	intent: SendIntent
	amount: string
	isPrivate: boolean
	gas: GasLegPlan | null
	routeKind: RouteKind | null
	routeLoading: boolean
	txTarget: number
	fjPerTx: bigint | null
	gasError: string | null
	blockedReason?: string | null
	tokenOnlyBlocked?: string | null
}

function step(over: Partial<Props> = {}) {
	return mount(AmountStep, {
		attachTo: document.body,
		props: {
			direction: "l1-to-l2",
			token: TOKEN,
			balances: { l1: 10_000_000n },
			intent: "token",
			amount: "5",
			isPrivate: true,
			gas: null,
			routeKind: "route",
			routeLoading: false,
			txTarget: 20,
			fjPerTx: 100_000_000_000_000_000n,
			gasError: null,
			...over,
		},
	})
}

const errorText = (w: ReturnType<typeof step>) => w.find(sel(TESTIDS.sendAmountError)).text()

describe("AmountStep", () => {
	it("offers the three outcomes on a deposit and reports the choice", async () => {
		const w = step()
		await w.find(sel(TESTIDS.sendChoiceTokenGas)).trigger("click")
		expect(w.emitted("update:intent")).toEqual([["token+gas"]])
		w.unmount()
	})

	it("an exit has one outcome and no gas route line", () => {
		const w = step({ direction: "l2-to-l1", balances: { l2Private: 1_000_000n } })
		expect(w.find(sel(TESTIDS.sendChoiceGas)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.sendRouteStatus)).exists()).toBe(false)
		w.unmount()
	})

	it("says nothing about a working route, and states one that cannot buy gas or is still being checked", async () => {
		expect(step().find(sel(TESTIDS.sendRouteStatus)).exists()).toBe(false)
		const w = step({ routeKind: "no-route" })
		const line = w.find(sel(TESTIDS.sendRouteStatus))
		expect(line.attributes("data-route")).toBe("no-route")
		expect(line.text()).toContain("can't buy Aztec gas")
		// A route still being checked shows nothing — no spinner line, no stale outcome.
		await w.setProps({ routeLoading: true })
		expect(w.find(sel(TESTIDS.sendRouteStatus)).exists()).toBe(false)
		w.unmount()
	})

	it("keeps the field's text verbatim — a trailing separator survives", async () => {
		const w = step()
		await w.find(sel(TESTIDS.sendAmountInput)).setValue("1.")
		expect(w.emitted("update:amount")).toEqual([["1."]])
		w.unmount()
	})

	it("refuses more decimal places than the token has", () => {
		const w = step({ amount: "1.1234567" })
		expect(errorText(w)).toContain("6 decimal places")
		expect(w.find(sel(TESTIDS.sendAmountNext)).attributes("disabled")).toBeDefined()
		w.unmount()
	})

	it("refuses text that is not a number", () => {
		const w = step({ amount: "1e6" })
		expect(errorText(w)).toContain("as a number")
		w.unmount()
	})

	it("refuses zero", () => {
		const w = step({ amount: "0.000000" })
		expect(errorText(w)).toContain("greater than zero")
		w.unmount()
	})

	it("refuses more than the balance it would spend", () => {
		const w = step({ amount: "10.000001" })
		expect(errorText(w)).toContain("more than your balance")
		w.unmount()
	})

	it("an exit checks against the balance the privacy choice names", async () => {
		const w = step({ direction: "l2-to-l1", amount: "3", balances: { l2Private: 2_000_000n, l2Public: 9_000_000n } })
		expect(errorText(w)).toContain("more than your balance")
		await w.setProps({ isPrivate: false })
		expect(w.find(sel(TESTIDS.sendAmountError)).exists()).toBe(false)
		w.unmount()
	})

	it("says nothing about an empty field, but will not continue from it", () => {
		const w = step({ amount: "" })
		expect(w.find(sel(TESTIDS.sendAmountError)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.sendAmountNext)).attributes("disabled")).toBeDefined()
		w.unmount()
	})

	it("Use all fills the balance at full precision, not the display rounding", async () => {
		const w = step({ balances: { l1: 12_345_678n } })
		await w.find(sel(TESTIDS.sendAmountMax)).trigger("click")
		expect(w.emitted("update:amount")).toEqual([["12.345678"]])
		w.unmount()
	})

	it("Use all sits beside the balance and is inert while the balance is unknown", () => {
		const w = step({ balances: {} })
		const max = w.find(sel(TESTIDS.sendAmountMax))
		expect(max.text()).toBe("Use all")
		expect(max.attributes("disabled")).toBeDefined()
		w.unmount()
	})

	it("shows the gas breakdown only when the send actually buys gas", async () => {
		const w = step()
		expect(w.find(sel(TESTIDS.sendGasBreakdown)).exists()).toBe(false)
		await w.setProps({ intent: "token+gas", gas: GAS })
		expect(w.find(sel(TESTIDS.sendGasBreakdownToken)).text()).toContain("3 USDC")
		w.unmount()
	})

	it("passes a changed tx target up", async () => {
		const w = step({ intent: "token+gas", gas: GAS })
		await w.find(sel(TESTIDS.sendGasTxTarget)).setValue("8")
		expect(w.emitted("update:txTarget")).toEqual([[8]])
		w.unmount()
	})

	it("the privacy row is one switch that reports its flip", async () => {
		const w = step()
		const toggle = w.find(sel(TESTIDS.sendPrivateToggle))
		expect(toggle.attributes("role")).toBe("switch")
		expect(toggle.attributes("aria-checked")).toBe("true")
		await toggle.trigger("click")
		expect(w.emitted("update:isPrivate")).toEqual([[false]])
		w.unmount()
	})

	it("will not continue into a gas send whose plan is missing", async () => {
		const w = step({ intent: "gas", gas: null })
		expect(w.find(sel(TESTIDS.sendAmountNext)).attributes("disabled")).toBeDefined()
		await w.setProps({ gas: GAS })
		expect(w.find(sel(TESTIDS.sendAmountNext)).attributes("disabled")).toBeUndefined()
		w.unmount()
	})

	it("moves both ways", async () => {
		const w = step()
		await w.find(sel(TESTIDS.sendAmountBack)).trigger("click")
		await w.find(sel(TESTIDS.sendAmountNext)).trigger("click")
		expect(w.emitted("back")).toHaveLength(1)
		expect(w.emitted("next")).toHaveLength(1)
		w.unmount()
	})

	it("reports its own verdict on the field, and only its own", async () => {
		const w = step({ amount: "" })
		expect(w.emitted("update:valid")).toEqual([[false]])
		await w.setProps({ amount: "5" })
		expect(w.emitted("update:valid")).toEqual([[false], [true]])
		await w.setProps({ amount: "10.000001" })
		expect(w.emitted("update:valid")).toEqual([[false], [true], [false]])
		w.unmount()
	})

	it("a block decided above the step renders its reason and keeps CONTINUE off, whatever the amount", () => {
		const w = step({ amount: "5", blockedReason: "The hub holds nothing to withdraw." })
		expect(w.find(sel(TESTIDS.sendAmountBlocked)).text()).toBe("The hub holds nothing to withdraw.")
		expect(w.find(sel(TESTIDS.sendAmountNext)).attributes("disabled")).toBeDefined()
		expect(w.emitted("update:valid")?.at(-1)).toEqual([false])
		w.unmount()
	})

	it("shows a sub-cent balance instead of rounding it to nothing", () => {
		const w = step({ balances: { l1: 5_000n } })
		expect(w.find(sel(TESTIDS.sendBalanceL1)).text()).toBe("Balance 0.005 USDC")
		w.unmount()
	})

	it("points the field at the complaint it just raised", async () => {
		const w = step({ amount: "1e6" })
		const input = w.find(sel(TESTIDS.sendAmountInput))
		expect(input.attributes("aria-invalid")).toBe("true")
		expect(input.attributes("aria-describedby")).toBe(w.find(sel(TESTIDS.sendAmountError)).attributes("id"))
		await w.setProps({ amount: "5" })
		expect(w.find(sel(TESTIDS.sendAmountInput)).attributes("aria-invalid")).toBeUndefined()
		expect(w.find(sel(TESTIDS.sendAmountInput)).attributes("aria-describedby")).toBeUndefined()
		w.unmount()
	})

	it("says why token alone cannot go without gas held, and keeps CONTINUE off until the intent moves", async () => {
		const w = step({ intent: "token", tokenOnlyBlocked: "Your Aztec account holds no gas yet." })
		expect(w.find(sel(TESTIDS.sendTokenOnlyBlocked)).text()).toContain("holds no gas")
		expect(w.find(sel(TESTIDS.sendAmountNext)).attributes("disabled")).toBeDefined()
		expect(w.emitted("update:valid")?.at(-1)).toEqual([false])
		await w.setProps({ intent: "token+gas", gas: GAS })
		expect(w.find(sel(TESTIDS.sendTokenOnlyBlocked)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.sendAmountNext)).attributes("disabled")).toBeUndefined()
		w.unmount()
	})

	it("renders on the row's own symbol while the chain is still being read, with CONTINUE off", async () => {
		const w = step({ token: { symbol: "USDC", decimals: 6 }, resolving: true, balances: {} })
		expect(w.find(sel(TESTIDS.sendAmountInput)).exists()).toBe(true)
		expect(w.text()).toContain("USDC")
		expect(w.text()).not.toMatch(/reading|loading|checking/i)
		expect(w.find(sel(TESTIDS.sendAmountNext)).attributes("disabled")).toBeDefined()
		await w.setProps({ resolving: false, balances: { l1: 10_000_000n } })
		expect(w.find(sel(TESTIDS.sendAmountNext)).attributes("disabled")).toBeUndefined()
		w.unmount()
	})

	it("the privacy switch takes its name from the row's label", () => {
		const w = step()
		const labelled = w.find(sel(TESTIDS.sendPrivateToggle)).attributes("aria-labelledby")
		expect(labelled).toBeDefined()
		expect(w.get(`#${labelled}`).text()).toContain("Private")
		w.unmount()
	})
})
