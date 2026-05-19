import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import SendTypesCard from "./SendTypesCard.vue"

const mountCard = (props: Record<string, unknown> = {}) => mount(SendTypesCard, { props })

const fullToken = {
	hasPrivateTransfers: true,
	hasPublicTransfers: true,
	hasPrivateBalances: true,
	hasPublicBalances: true,
}

describe("composite/SendTypesCard", () => {
	test("renders both From and To toggle pairs with PRIVATE + PUBLIC labels", () => {
		const w = mountCard({ token: fullToken, sendType: "private", receiverType: "private" })
		expect(w.find("[data-testid='send-from-type']").exists()).toBe(true)
		expect(w.find("[data-testid='send-to-type']").exists()).toBe(true)
		expect(w.text()).toContain("PRIVATE")
		expect(w.text()).toContain("PUBLIC")
	})

	test("clicking the From toggle flips sendType from private to public", async () => {
		const w = mountCard({ token: fullToken, sendType: "private", receiverType: "private" })
		await w.find("[data-testid='send-from-type']").trigger("click")
		expect(w.emitted("update:sendType")?.[0]).toEqual(["public"])
	})

	test("clicking the To toggle flips receiverType from private to public", async () => {
		const w = mountCard({ token: fullToken, sendType: "private", receiverType: "private" })
		await w.find("[data-testid='send-to-type']").trigger("click")
		expect(w.emitted("update:receiverType")?.[0]).toEqual(["public"])
	})

	test("clicking does nothing when no token is provided", async () => {
		const w = mountCard({ sendType: "private", receiverType: "private" })
		await w.find("[data-testid='send-from-type']").trigger("click")
		expect(w.emitted("update:sendType")).toBeUndefined()
	})

	test("does not flip From when token only supports private transfers (one direction)", async () => {
		const w = mountCard({
			token: { ...fullToken, hasPublicTransfers: false },
			sendType: "private",
			receiverType: "private",
		})
		await w.find("[data-testid='send-from-type']").trigger("click")
		expect(w.emitted("update:sendType")).toBeUndefined()
	})

	test("does not flip To when token only supports private balances (one destination)", async () => {
		const w = mountCard({
			token: { ...fullToken, hasPublicBalances: false },
			sendType: "private",
			receiverType: "private",
		})
		await w.find("[data-testid='send-to-type']").trigger("click")
		expect(w.emitted("update:receiverType")).toBeUndefined()
	})

	test("toggle_active class follows the current sendType selection", () => {
		const w = mountCard({ token: fullToken, sendType: "public", receiverType: "private" })
		const fromBtns = w.find("[data-testid='send-from-type']").findAll("span")
		// Two btns: PRIVATE (first), PUBLIC (second). Public should be active.
		expect(fromBtns[1].classes().some((c) => c.includes("toggle_active"))).toBe(true)
		expect(fromBtns[0].classes().some((c) => c.includes("toggle_active"))).toBe(false)
	})
})
