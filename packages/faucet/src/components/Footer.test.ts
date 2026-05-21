import { mount } from "@vue/test-utils"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/contracts/deployments", () => ({
	DRIPPER: { toString: () => "0xdripper" },
	USDC: { toString: () => "0xusdc" },
	ETH: { toString: () => "0xeth" },
}))

import Footer from "./Footer.vue"

describe("Footer", () => {
	it("renders the contract labels (USDC, ETH, Dripper)", () => {
		const w = mount(Footer)
		expect(w.text()).toContain("USDC")
		expect(w.text()).toContain("ETH")
		expect(w.text()).toContain("Dripper")
	})

	it("renders the brutalist tagline verbatim", () => {
		const w = mount(Footer)
		expect(w.text()).toContain("Alpha-testnet only · Permissionless dripper · Fixed amounts · No rate limit")
	})

	it("renders external link to Wonderland aztec-standards", () => {
		const w = mount(Footer)
		const a = w.findAll("a").find((el) => el.text().includes("Wonderland"))
		expect(a?.attributes("href")).toBe("https://github.com/defi-wonderland/aztec-standards")
		expect(a?.attributes("target")).toBe("_blank")
		expect(a?.attributes("rel")).toContain("noopener")
	})

	it("renders 'Powered by Nulo' attribution", () => {
		const w = mount(Footer)
		expect(w.text()).toContain("Powered by Nulo")
	})

	it("does NOT render contract anchor tags when VITE_EXPLORER_BASE_URL is unset", () => {
		// In tests jsdom has no VITE_EXPLORER_BASE_URL → explorerAddressUrl
		// returns "". Footer falls back to plain text labels.
		const w = mount(Footer)
		const contractsLine = w.find(".contracts")
		// Should have NO anchor tag for USDC/ETH/Dripper labels (only
		// the external "Wonderland" / "Aztec" links).
		const anchors = contractsLine.findAll("a")
		expect(anchors.length).toBe(0)
	})
})
