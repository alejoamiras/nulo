import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import TokenSeedRow from "./TokenSeedRow.vue"

const STUBS = { Flex: { template: "<div><slot /></div>" } }
const entry = (status: string) => ({ chainId: 1, contract: "0xseed", symbol: "cUSDC", displayName: "Clean USDC", status })
const mountRow = (status: string) => mount(TokenSeedRow, { props: { entry: entry(status) }, global: { stubs: STUBS } })

describe("TokenSeedRow", () => {
	test("pending, seeding and seeded-awaiting-its-row look the same: compiled-in symbol and label, a skeleton amount, no button", () => {
		for (const status of ["pending", "seeding", "seeded"]) {
			const w = mountRow(status)
			const row = w.get('[data-testid="token-seed-row"]')
			expect(row.attributes("data-status")).toBe(status)
			expect(row.attributes("data-symbol")).toBe("cUSDC")
			expect(row.attributes("aria-busy")).toBe("true")
			expect(w.text()).toContain("cUSDC")
			expect(w.text()).toContain("Clean USDC")
			expect(w.findAll('[aria-hidden="true"]')).toHaveLength(2)
			expect(w.find("button").exists()).toBe(false)
		}
	})

	test("failed: says so and offers RETRY, which emits and nothing else", async () => {
		const w = mountRow("failed")
		expect(w.get('[data-testid="token-seed-reason"]').text()).toBe("Couldn't set up")
		expect(w.get('[data-testid="token-seed-row"]').attributes("aria-busy")).toBeUndefined()
		await w.get('[data-testid="token-seed-retry"]').trigger("click")
		expect(w.emitted("retry")).toHaveLength(1)
	})

	test("rejected: a failed verification is not the user's to retry — no button at all", () => {
		const w = mountRow("rejected")
		expect(w.get('[data-testid="token-seed-reason"]').text()).toBe("Couldn't verify")
		expect(w.find("button").exists()).toBe(false)
	})

	test("inert: a div, never a link — there is no token page to open yet", () => {
		for (const status of ["pending", "failed", "rejected"]) {
			const w = mountRow(status)
			expect(w.element.tagName).toBe("DIV")
			expect(w.find("a").exists()).toBe(false)
			expect(w.html()).not.toContain("href")
		}
	})

	test("renders its strings as text, never as markup", () => {
		const w = mount(TokenSeedRow, {
			props: { entry: { ...entry("pending"), symbol: "<b>x</b>", displayName: "<img src=x>" } },
			global: { stubs: STUBS },
		})
		expect(w.find("b").exists()).toBe(false)
		expect(w.find("img").exists()).toBe(false)
		expect(w.text()).toContain("<b>x</b>")
	})
})
