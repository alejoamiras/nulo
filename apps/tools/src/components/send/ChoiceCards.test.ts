import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { SendIntent } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"
import ChoiceCards from "./ChoiceCards.vue"

const sel = (t: string) => `[data-testid="${t}"]`

type Props = { intent: SendIntent; exitOnly: boolean; feeAsset: boolean; noRoute: boolean; tokenReason?: string | null }

function cards(over: Partial<Props> = {}) {
	return mount(ChoiceCards, {
		attachTo: document.body,
		props: { intent: "token", exitOnly: false, feeAsset: false, noRoute: false, ...over },
	})
}

describe("ChoiceCards", () => {
	it("offers token / token+gas / gas on a deposit", () => {
		const w = cards()
		expect(w.find(sel(TESTIDS.sendChoiceCards)).attributes("role")).toBe("tablist")
		expect(w.find(sel(TESTIDS.sendChoiceToken)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.sendChoiceTokenGas)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.sendChoiceGas)).exists()).toBe(true)
		w.unmount()
	})

	it("reduces an exit to the one outcome it has", () => {
		const w = cards({ exitOnly: true })
		expect(w.find(sel(TESTIDS.sendChoiceCards)).attributes("data-count")).toBe("1")
		expect(w.find(sel(TESTIDS.sendChoiceTokenGas)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.sendChoiceGas)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.sendChoiceToken)).text()).toContain("Ethereum")
		w.unmount()
	})

	it("emits the intent of the card that was clicked", async () => {
		const w = cards()
		await w.find(sel(TESTIDS.sendChoiceTokenGas)).trigger("click")
		expect(w.emitted("update:intent")).toEqual([["token+gas"]])
		w.unmount()
	})

	it("is ONE tab stop: the active card carries it", () => {
		const w = cards({ intent: "gas" })
		expect(w.find(sel(TESTIDS.sendChoiceToken)).attributes("tabindex")).toBe("-1")
		expect(w.find(sel(TESTIDS.sendChoiceGas)).attributes("tabindex")).toBe("0")
		expect(w.find(sel(TESTIDS.sendChoiceGas)).attributes("aria-selected")).toBe("true")
		w.unmount()
	})

	it("disables both gas choices, with the reason on hover and for assistive tech, when the token has no route", () => {
		const w = cards({ noRoute: true })
		expect(w.find(sel(TESTIDS.sendChoiceTokenGas)).attributes("disabled")).toBeDefined()
		expect(w.find(sel(TESTIDS.sendChoiceGas)).attributes("disabled")).toBeDefined()
		expect(w.find(sel(TESTIDS.sendChoiceToken)).attributes("disabled")).toBeUndefined()
		const gas = w.find(sel(TESTIDS.sendChoiceGas))
		expect(gas.attributes("title")).toContain("can't buy Aztec gas")
		expect(w.get(`#${gas.attributes("aria-describedby")}`).text()).toContain("can't buy Aztec gas")
		expect(w.find(sel(TESTIDS.sendChoiceToken)).attributes("aria-describedby")).toBeUndefined()
		w.unmount()
	})

	it("disables the token-only choice, with its reason on hover and for assistive tech, when the account holds no gas", async () => {
		const reason = "Your Aztec account holds no gas (Fee Juice) yet."
		const w = cards({ intent: "token+gas", tokenReason: reason })
		const token = w.find(sel(TESTIDS.sendChoiceToken))
		expect(token.attributes("disabled")).toBeDefined()
		expect(token.attributes("title")).toBe(reason)
		expect(w.get(`#${token.attributes("aria-describedby")}`).text()).toBe(reason)
		expect(w.find(sel(TESTIDS.sendChoiceTokenGas)).attributes("disabled")).toBeUndefined()
		expect(w.find(sel(TESTIDS.sendChoiceGas)).attributes("disabled")).toBeUndefined()
		await token.trigger("click")
		expect(w.emitted("update:intent")).toBeUndefined()
		// ← from the second choice skips the greyed-out token and lands on GAS.
		await w.find(sel(TESTIDS.sendChoiceTokenGas)).trigger("keydown", { key: "ArrowLeft" })
		expect(document.activeElement).toBe(w.find(sel(TESTIDS.sendChoiceGas)).element)
		expect(w.emitted("update:intent")).toEqual([["gas"]])
		w.unmount()
	})

	it("a disabled choice emits nothing when clicked", async () => {
		const w = cards({ noRoute: true })
		await w.find(sel(TESTIDS.sendChoiceGas)).trigger("click")
		expect(w.emitted("update:intent")).toBeUndefined()
		w.unmount()
	})

	it("→ moves focus to the next choice and switches to it", async () => {
		const w = cards()
		await w.find(sel(TESTIDS.sendChoiceToken)).trigger("keydown", { key: "ArrowRight" })
		expect(document.activeElement).toBe(w.find(sel(TESTIDS.sendChoiceTokenGas)).element)
		expect(w.emitted("update:intent")).toEqual([["token+gas"]])
		w.unmount()
	})

	it("→ from the last choice wraps to the first", async () => {
		const w = cards({ intent: "gas" })
		await w.find(sel(TESTIDS.sendChoiceGas)).trigger("keydown", { key: "ArrowRight" })
		expect(document.activeElement).toBe(w.find(sel(TESTIDS.sendChoiceToken)).element)
		expect(w.emitted("update:intent")).toEqual([["token"]])
		w.unmount()
	})

	it("arrow keys skip a disabled choice rather than stranding focus on it", async () => {
		const w = cards({ noRoute: true })
		await w.find(sel(TESTIDS.sendChoiceToken)).trigger("keydown", { key: "ArrowRight" })
		expect(document.activeElement).toBe(w.find(sel(TESTIDS.sendChoiceToken)).element)
		expect(w.emitted("update:intent")).toEqual([["token"]])
		w.unmount()
	})

	it("← walks backwards", async () => {
		const w = cards({ intent: "token+gas" })
		await w.find(sel(TESTIDS.sendChoiceTokenGas)).trigger("keydown", { key: "ArrowLeft" })
		expect(document.activeElement).toBe(w.find(sel(TESTIDS.sendChoiceToken)).element)
		expect(w.emitted("update:intent")).toEqual([["token"]])
		w.unmount()
	})

	it("says the gas conversion is one for one when the token IS the gas asset", () => {
		const w = cards({ feeAsset: true })
		expect(w.find(sel(TESTIDS.sendChoiceTokenGas)).text()).toContain("One for one")
		expect(w.find(sel(TESTIDS.sendChoiceGas)).text()).toContain("One for one")
		w.unmount()
	})

	it("Enter and Space activate the focused choice", async () => {
		const w = cards()
		await w.find(sel(TESTIDS.sendChoiceGas)).trigger("keydown", { key: "Enter" })
		await w.find(sel(TESTIDS.sendChoiceTokenGas)).trigger("keydown", { key: " " })
		expect(w.emitted("update:intent")).toEqual([["gas"], ["token+gas"]])
		w.unmount()
	})
})
