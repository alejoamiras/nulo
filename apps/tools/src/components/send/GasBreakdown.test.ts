import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { GasLegPlan, ResolvedToken } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"
import GasBreakdown from "./GasBreakdown.vue"

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

function gasPlan(over: Partial<GasLegPlan> = {}): GasLegPlan {
	return {
		fuelAmount: 2_000_000n,
		fuelFj: 300_000_000_000_000_000n,
		quote: 300_000_000_000_000_000n,
		minFuelOutput: 285_000_000_000_000_000n,
		route: { path: [], zeroForOnes: [] },
		capped: null,
		...over,
	} as GasLegPlan
}

type Props = {
	token: ResolvedToken
	amount: bigint
	gas: GasLegPlan | null
	txTarget: number
	loading: boolean
	error: string | null
}

function breakdown(over: Partial<Props> = {}) {
	return mount(GasBreakdown, {
		props: { token: TOKEN, amount: 10_000_000n, gas: gasPlan(), txTarget: 20, loading: false, error: null, ...over },
	})
}

describe("GasBreakdown", () => {
	it("says how much of the amount stays a token", () => {
		const w = breakdown()
		expect(w.find(sel(TESTIDS.sendGasBreakdownToken)).text()).toContain("8 USDC")
		w.unmount()
	})

	it("says how much gas the slice buys", () => {
		const w = breakdown()
		expect(w.find(sel(TESTIDS.sendGasBreakdownFuel)).text()).toContain("0.3 FJ")
		w.unmount()
	})

	it("names the slice in the token's own units", () => {
		const w = breakdown()
		expect(w.find(sel(TESTIDS.sendGasShare)).text()).toContain("2 USDC")
		w.unmount()
	})

	it("states the floor the send is signed against", () => {
		const w = breakdown()
		expect(w.find(sel(TESTIDS.sendGasFloor)).text()).toContain("0.285 FJ")
		w.unmount()
	})

	it("never renders a negative remainder when the slice covers everything", () => {
		const w = breakdown({ amount: 1_000_000n })
		expect(w.find(sel(TESTIDS.sendGasBreakdownToken)).text()).toContain("0 USDC")
		w.unmount()
	})

	it("shows the gas value as pending while the slice is being sized", () => {
		const w = breakdown({ loading: true })
		expect(w.find(sel(TESTIDS.sendGasBreakdownFuel)).text()).toContain("sizing")
		expect(w.find(sel(TESTIDS.sendGasBreakdown)).attributes("data-loading")).toBeDefined()
		w.unmount()
	})

	it("renders without a plan instead of guessing one", () => {
		const w = breakdown({ gas: null })
		expect(w.find(sel(TESTIDS.sendGasShare)).text()).toContain("—")
		expect(w.find(sel(TESTIDS.sendGasBreakdownToken)).text()).toContain("10 USDC")
		w.unmount()
	})

	it("surfaces the gas error", () => {
		const w = breakdown({ error: "The quote failed." })
		expect(w.find(sel(TESTIDS.sendGasBreakdown)).text()).toContain("The quote failed.")
		w.unmount()
	})

	it("keeps the tx-target control behind `change`", () => {
		const w = breakdown()
		expect(w.find(sel(TESTIDS.sendGasTxTarget)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.sendGasChange)).attributes("aria-expanded")).toBe("false")
		w.unmount()
	})

	it("`change` reveals the control at the current target", async () => {
		const w = breakdown({ txTarget: 35 })
		await w.find(sel(TESTIDS.sendGasChange)).trigger("click")
		expect(w.find(sel(TESTIDS.sendGasChange)).attributes("aria-expanded")).toBe("true")
		expect((w.find(sel(TESTIDS.sendGasTxTarget)).element as HTMLInputElement).value).toBe("35")
		w.unmount()
	})

	it("emits the new target as a number", async () => {
		const w = breakdown()
		await w.find(sel(TESTIDS.sendGasChange)).trigger("click")
		await w.find(sel(TESTIDS.sendGasTxTarget)).setValue("12")
		expect(w.emitted("update:txTarget")).toEqual([[12]])
		w.unmount()
	})

	it("ignores a half-typed target rather than sizing for zero", async () => {
		const w = breakdown()
		await w.find(sel(TESTIDS.sendGasChange)).trigger("click")
		await w.find(sel(TESTIDS.sendGasTxTarget)).setValue("")
		await w.find(sel(TESTIDS.sendGasTxTarget)).setValue("0")
		expect(w.emitted("update:txTarget")).toBeUndefined()
		w.unmount()
	})

	it("never rounds a small slice away — the split shown is the one signed", () => {
		const w = breakdown({ amount: 6_000n, gas: gasPlan({ fuelAmount: 1_000n, quote: 5_000n, minFuelOutput: 4_500n }) })
		expect(w.find(sel(TESTIDS.sendGasBreakdownToken)).text()).toContain("0.005 USDC")
		expect(w.find(sel(TESTIDS.sendGasShare)).text()).toContain("0.001 USDC")
		expect(w.find(sel(TESTIDS.sendGasBreakdownFuel)).text()).toContain("0.000000000000005 FJ")
		expect(w.find(sel(TESTIDS.sendGasFloor)).text()).toContain("0.0000000000000045 FJ")
		w.unmount()
	})

	it("says when the slice was capped", () => {
		const w = breakdown({ gas: gasPlan({ capped: "half" }) })
		expect(w.find(sel(TESTIDS.sendGasBreakdown)).attributes("data-capped")).toBe("half")
		expect(w.find(sel(TESTIDS.sendGasBreakdown)).text()).toContain("capped at half")
		w.unmount()
	})
})
