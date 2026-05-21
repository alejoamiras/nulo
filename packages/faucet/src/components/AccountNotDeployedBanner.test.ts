import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { TESTIDS } from "@/lib/testids"
import AccountNotDeployedBanner from "./AccountNotDeployedBanner.vue"

describe("AccountNotDeployedBanner", () => {
	it("renders the friendly fix copy", () => {
		const w = mount(AccountNotDeployedBanner)
		expect(w.text()).toMatch(/account isn't on-chain yet/i)
		expect(w.text()).toMatch(/send any transaction from your wallet first/i)
	})

	it("has role=alert for assistive tech", () => {
		const w = mount(AccountNotDeployedBanner)
		expect(w.get(".banner").attributes("role")).toBe("alert")
	})

	it("carries the stable testid for e2e", () => {
		const w = mount(AccountNotDeployedBanner)
		expect(w.find(`[data-testid="${TESTIDS.bannerAccountNotDeployed}"]`).exists()).toBe(true)
	})

	it("renders a status dot (visual cue, aria-hidden)", () => {
		const w = mount(AccountNotDeployedBanner)
		const dot = w.find(".dot")
		expect(dot.exists()).toBe(true)
		expect(dot.attributes("aria-hidden")).toBe("true")
	})

	it("renders as a single paragraph (so screen readers don't double-announce)", () => {
		const w = mount(AccountNotDeployedBanner)
		expect(w.findAll("p")).toHaveLength(1)
	})
})
