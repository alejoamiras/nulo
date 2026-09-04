import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { Direction, ResolvedToken, SelectableToken, TokenBalances } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"
import TokenStep from "./TokenStep.vue"

const sel = (t: string) => `[data-testid="${t}"]`

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7"

function token(address: string, symbol: string, over: Partial<SelectableToken> = {}): SelectableToken {
	return {
		chainId: 1,
		address,
		symbol,
		name: `${symbol} token`,
		decimals: 6,
		source: "manifest",
		logoKey: `1:${address}`,
		...over,
	} as SelectableToken
}

const TOKENS = [token(USDC, "USDC"), token(USDT, "USDT")]

function resolved(kind: "registered" | "portal-only" | "first-time"): ResolvedToken {
	return {
		...token(USDC, "USDC"),
		state: kind === "first-time" ? { kind } : { kind, registration: {}, l2Token: "0x01" },
		portal: "0xportal",
		words: { nameWord: "0x01", symbolWord: "0x02" },
		l2Token: "0x01",
	} as unknown as ResolvedToken
}

type Props = {
	direction: Direction
	tokens: SelectableToken[]
	search: string
	provenance: "fresh" | "cache" | "fallback" | "none"
	loading: boolean
	catalogError: string | null
	selected: SelectableToken | null
	resolved: ResolvedToken | null
	resolving: boolean
	selectionError: string | null
	balances: TokenBalances
	pasteError: string | null
}

function step(over: Partial<Props> = {}) {
	return mount(TokenStep, {
		attachTo: document.body,
		props: {
			direction: "l1-to-l2",
			tokens: TOKENS,
			search: "",
			provenance: "fresh",
			loading: false,
			catalogError: null,
			selected: null,
			resolved: null,
			resolving: false,
			selectionError: null,
			balances: {},
			pasteError: null,
			...over,
		},
	})
}

describe("TokenStep", () => {
	it("shows the current query and reports every keystroke", async () => {
		const w = step({ search: "usd" })
		const field = w.find(sel(TESTIDS.sendTokenSearch))
		expect((field.element as HTMLInputElement).value).toBe("usd")
		await field.setValue("usdt")
		expect(w.emitted("update:search")).toEqual([["usdt"]])
		w.unmount()
	})

	it("passes a row selection up", async () => {
		const w = step()
		await w.findAll(sel(TESTIDS.sendTokenTile))[1]?.trigger("click")
		expect(w.emitted("select")?.[0]).toEqual([TOKENS[1]])
		w.unmount()
	})

	it("passes a pasted address up, lowercased", async () => {
		const w = step()
		await w.find(sel(TESTIDS.sendPasteInput)).setValue(USDT.toUpperCase().replace("0X", "0x"))
		await w.find(sel(TESTIDS.sendPasteAdd)).trigger("click")
		expect(w.emitted("paste")).toEqual([[USDT]])
		w.unmount()
	})

	it("surfaces what the catalog said about a pasted address", () => {
		const w = step({ pasteError: "That token is already in the list." })
		expect(w.find(sel(TESTIDS.sendPasteError)).text()).toContain("already in the list")
		w.unmount()
	})

	it("surfaces a catalog failure without hiding the tokens it does have", () => {
		const w = step({ catalogError: "The token list could not be loaded." })
		expect(w.find(sel(TESTIDS.sendCatalogError)).text()).toContain("could not be loaded")
		expect(w.findAll(sel(TESTIDS.sendTokenTile))).toHaveLength(2)
		w.unmount()
	})

	it("a deposit reads the Ethereum balance", () => {
		const w = step({ selected: TOKENS[0], resolved: resolved("registered"), balances: { l1: 12_500_000n } })
		expect(w.find(sel(TESTIDS.sendBalanceL1)).text()).toContain("12.50 USDC")
		expect(w.find(sel(TESTIDS.sendBalanceL2Public)).exists()).toBe(false)
		w.unmount()
	})

	it("an exit reads both Aztec balances", () => {
		const w = step({
			direction: "l2-to-l1",
			selected: TOKENS[0],
			resolved: resolved("registered"),
			balances: { l2Public: 1_000_000n, l2Private: 2_000_000n },
		})
		expect(w.find(sel(TESTIDS.sendBalanceL2Private)).text()).toContain("2.00 USDC")
		expect(w.find(sel(TESTIDS.sendBalanceL2Public)).text()).toContain("1.00 USDC")
		expect(w.find(sel(TESTIDS.sendBalanceL1)).exists()).toBe(false)
		w.unmount()
	})

	it("shows no balance for a token whose decimals are not read yet", () => {
		const w = step({ selected: token(USDT, "", { decimals: -1, source: "pasted" }), balances: { l1: 5n } })
		expect(w.find(sel(TESTIDS.sendBalanceL1)).text()).toContain("—")
		w.unmount()
	})

	it("states the selected token's state as an outcome", () => {
		const w = step({ selected: TOKENS[0], resolved: resolved("first-time") })
		const state = w.find(sel(TESTIDS.sendTokenState))
		expect(state.attributes("data-state")).toBe("first-time")
		expect(state.text()).toContain("takes a little longer")
		w.unmount()
	})

	it("says it is reading a token instead of showing a stale state", () => {
		const w = step({ selected: TOKENS[0], resolved: resolved("registered"), resolving: true })
		expect(w.find(sel(TESTIDS.sendTokenState)).exists()).toBe(false)
		expect(w.text()).toContain("Reading this token")
		w.unmount()
	})

	it("announces a selection failure politely", () => {
		const w = step({ selected: TOKENS[0], selectionError: "That address is not an ERC-20." })
		const err = w.find(sel(TESTIDS.sendSelectionError))
		expect(err.attributes("aria-live")).toBe("polite")
		expect(err.text()).toContain("not an ERC-20")
		w.unmount()
	})

	it("cannot continue before a token resolves", async () => {
		const w = step({ selected: TOKENS[0], resolving: true })
		expect(w.find(sel(TESTIDS.sendTokenNext)).attributes("disabled")).toBeDefined()
		await w.setProps({ resolving: false, resolved: resolved("registered") })
		expect(w.find(sel(TESTIDS.sendTokenNext)).attributes("disabled")).toBeUndefined()
		await w.find(sel(TESTIDS.sendTokenNext)).trigger("click")
		expect(w.emitted("next")).toHaveLength(1)
		w.unmount()
	})

	it("keeps mechanism vocabulary out of the step", () => {
		const w = step({ selected: TOKENS[0], resolved: resolved("portal-only") })
		expect(w.text().toLowerCase()).not.toMatch(/portal|register/)
		w.unmount()
	})
})
