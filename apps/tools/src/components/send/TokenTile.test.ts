import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { SelectableToken } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"
import TokenTile from "./TokenTile.vue"

const sel = (t: string) => `[data-testid="${t}"]`

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"

function token(over: Partial<SelectableToken> = {}): SelectableToken {
	return {
		chainId: 1,
		address: USDC,
		symbol: "USDC",
		name: "USD Coin",
		decimals: 6,
		source: "manifest",
		logoKey: `1:${USDC}`,
		...over,
	} as SelectableToken
}

function tile(props: Partial<{ token: SelectableToken; selected: boolean; balance: bigint; decimals: number }> = {}) {
	return mount(TokenTile, { props: { token: token(), selected: false, ...props } })
}

describe("TokenTile", () => {
	it("uses the committed sprite when the key is in the sheet", () => {
		const w = tile()
		expect(w.find(sel(TESTIDS.sendTokenLogo)).find("use").attributes("href")).toBe(`#1:${USDC}`)
		expect(w.find(sel(TESTIDS.sendTokenMonogram)).exists()).toBe(false)
		w.unmount()
	})

	it("falls back to a monogram when the key is absent from the sheet", () => {
		const w = tile({ token: token({ chainId: 11155111, logoKey: `11155111:${USDC}` }) })
		expect(w.find(sel(TESTIDS.sendTokenLogo)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.sendTokenMonogram)).text()).toBe("US")
		w.unmount()
	})

	it("derives the monogram hue from the key, not the symbol", () => {
		const a = tile({ token: token({ logoKey: "11155111:0xaaa", symbol: "USDC" }) })
		const b = tile({ token: token({ logoKey: "11155111:0xbbb", symbol: "USDC" }) })
		const hueA = a.find(sel(TESTIDS.sendTokenMonogram)).attributes("data-hue")
		const hueB = b.find(sel(TESTIDS.sendTokenMonogram)).attributes("data-hue")
		expect(hueA).not.toBe(hueB)
		a.unmount()
		b.unmount()
	})

	it("emits select when clicked", async () => {
		const w = tile()
		await w.find(sel(TESTIDS.sendTokenTile)).trigger("click")
		expect(w.emitted("select")).toHaveLength(1)
		w.unmount()
	})

	it("reports selection to assistive tech and to CSS", () => {
		const w = tile({ selected: true })
		const root = w.find(sel(TESTIDS.sendTokenTile))
		expect(root.attributes("aria-selected")).toBe("true")
		expect(root.attributes("data-selected")).toBeDefined()
		expect(root.attributes("role")).toBe("option")
		w.unmount()
	})

	it("formats a balance in the token's own decimals", () => {
		const w = tile({ balance: 1_234_500_000n })
		expect(w.find(sel(TESTIDS.sendTokenTile)).text()).toContain("1,234.50")
		w.unmount()
	})

	it("honours an explicit decimals override", () => {
		const w = tile({ balance: 1_234_500_000n, decimals: 9 })
		expect(w.find(sel(TESTIDS.sendTokenTile)).text()).toContain("1.23")
		w.unmount()
	})

	it("shows the checksummed address under the symbol for anything the app did not publish", () => {
		const w = tile({ token: token({ source: "list" }) })
		const row = w.find(sel(TESTIDS.sendTokenAddress))
		// EIP-55 casing, and the FULL value on the title so the trimmed form is never the only copy.
		expect(row.attributes("title")).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
		expect(row.text()).toBe("0xA0b869…06eB48")
		w.unmount()
	})

	it("shows no address for a manifest token — the app published that row itself", () => {
		const w = tile()
		expect(w.find(sel(TESTIDS.sendTokenAddress)).exists()).toBe(false)
		w.unmount()
	})

	it("strips and caps a listed symbol and name before they reach the DOM", () => {
		const bidi = `USD${String.fromCodePoint(0x202e)}C`
		const w = tile({ token: token({ source: "list", symbol: bidi, name: "N".repeat(80) }) })
		const text = w.find(sel(TESTIDS.sendTokenTile)).text()
		expect(text).not.toContain(String.fromCodePoint(0x202e))
		expect(text).toContain("USDC")
		expect(text).toContain(`${"N".repeat(32)}…`)
		expect(text).not.toContain("N".repeat(33))
		w.unmount()
	})

	it("a row the user added says so beside its address, and shows no name line", () => {
		const w = tile({ token: token({ source: "pasted", symbol: "PAXG", name: "Paxos Gold", logoKey: "11155111:0xfeed" }) })
		const address = w.find(sel(TESTIDS.sendTokenAddress))
		expect(address.attributes("data-added")).toBeDefined()
		expect(address.text()).toContain("added by you")
		expect(w.text()).not.toContain("Paxos Gold")
		w.unmount()
	})

	it("names no provenance on any row — the address line is the only tell", () => {
		const w = tile({ token: token({ source: "list" }) })
		expect(w.text().toLowerCase()).not.toMatch(/\blist\b|manifest|pasted/)
		w.unmount()
	})

	it("shows no balance for a pasted token whose decimals are not read yet", () => {
		const w = tile({
			token: token({ source: "pasted", symbol: "", name: "", decimals: -1, logoKey: "11155111:0xfeed" }),
			balance: 5n,
		})
		expect(w.find(sel(TESTIDS.sendTokenTile)).text()).not.toContain("5")
		expect(w.find(sel(TESTIDS.sendTokenMonogram)).text()).toBe("??")
		w.unmount()
	})
})
