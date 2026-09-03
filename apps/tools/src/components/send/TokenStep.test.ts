import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import type { LookupState } from "@/composables/useAddressLookup"
import type { Direction, ResolvedToken, SelectableToken, TokenBalances } from "@/lib/send-model"
import { TESTIDS } from "@/lib/testids"
import TokenStep from "./TokenStep.vue"

const sel = (t: string) => `[data-testid="${t}"]`

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7"
const LINK = "0x779877a7b0d9e8603169ddbd7836e478b4624789"

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

const LOGO = `1:${LINK}`
const FOUND: LookupState = {
	status: "found",
	address: LINK,
	logoKey: LOGO,
	identity: { symbol: "LINK", name: "ChainLink Token", decimals: 18 },
}

type Props = {
	direction: Direction
	tokens: SelectableToken[]
	search: string
	loading: boolean
	catalogError: string | null
	lookup: LookupState | null
	addError: string | null
	selected: SelectableToken | null
	resolved: ResolvedToken | null
	resolving: boolean
	selectionError: string | null
	balances: TokenBalances
	rowBalances?: Record<string, bigint>
}

function step(over: Partial<Props> = {}) {
	return mount(TokenStep, {
		attachTo: document.body,
		props: {
			direction: "l1-to-l2",
			tokens: TOKENS,
			search: "",
			loading: false,
			catalogError: null,
			lookup: null,
			addError: null,
			selected: null,
			resolved: null,
			resolving: false,
			selectionError: null,
			balances: {},
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

	it("shows what an unlisted address resolves to, with the address itself, and ADD passes it up", async () => {
		const w = step({ lookup: FOUND })
		const row = w.find(sel(TESTIDS.sendTokenLookup))
		expect(row.attributes("data-status")).toBe("found")
		expect(row.text()).toContain("LINK")
		expect(row.text()).toContain("ChainLink Token")
		expect(row.text()).toContain("18 decimals")
		expect(row.text()).toContain("0x779877…624789")
		await w.find(sel(TESTIDS.sendLookupAdd)).trigger("click")
		expect(w.emitted("add")).toEqual([[LINK]])
		w.unmount()
	})

	it("hides the list while a lookup is showing, and says it is reading", () => {
		const w = step({ lookup: { status: "reading", address: LINK, logoKey: LOGO } })
		expect(w.find(sel(TESTIDS.sendTokenList)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.sendTokenLookup)).text()).toContain("Reading")
		expect(w.find(sel(TESTIDS.sendLookupAdd)).exists()).toBe(false)
		w.unmount()
	})

	it("shows the contract's complaint when the address is not a token, with nothing to add", () => {
		const w = step({ lookup: { status: "error", address: LINK, logoKey: LOGO, message: "Token has no usable decimals()." } })
		expect(w.find(sel(TESTIDS.sendTokenLookup)).text()).toContain("no usable decimals")
		expect(w.find(sel(TESTIDS.sendLookupAdd)).exists()).toBe(false)
		w.unmount()
	})

	it("strips a looked-up symbol before it renders", () => {
		const bidi = `LI${String.fromCodePoint(0x202e)}NK`
		const w = step({ lookup: { ...FOUND, identity: { ...FOUND.identity, symbol: bidi } } })
		const text = w.find(sel(TESTIDS.sendTokenLookup)).text()
		expect(text).not.toContain(String.fromCodePoint(0x202e))
		expect(text).toContain("LINK")
		w.unmount()
	})

	it("surfaces what the catalog said when the address was added", () => {
		const w = step({ addError: "That token is already in the list." })
		expect(w.find(sel(TESTIDS.sendLookupError)).text()).toContain("already in the list")
		w.unmount()
	})

	it("surfaces a catalog failure without hiding the tokens it does have", () => {
		const w = step({ catalogError: "The token list could not be loaded." })
		expect(w.find(sel(TESTIDS.sendCatalogError)).text()).toContain("could not be loaded")
		expect(w.findAll(sel(TESTIDS.sendTokenTile))).toHaveLength(2)
		w.unmount()
	})

	it("hands the rows their Ethereum balances", () => {
		const w = step({ rowBalances: { [`1:${USDT}`]: 2_500_000n } })
		expect(w.findAll(sel(TESTIDS.sendTokenTile))[1]?.text()).toContain("2.50")
		w.unmount()
	})

	it("a deposit sums up the token and its Ethereum balance", () => {
		const w = step({ selected: TOKENS[0], resolved: resolved("registered"), balances: { l1: 12_500_000n } })
		expect(w.find(sel(TESTIDS.sendTokenSummary)).text()).toContain("Sending USDC")
		expect(w.find(sel(TESTIDS.sendBalanceL1)).text()).toBe("12.50 USDC")
		expect(w.find(sel(TESTIDS.sendBalanceL2Public)).exists()).toBe(false)
		w.unmount()
	})

	it("an exit sums up both Aztec balances", () => {
		const w = step({
			direction: "l2-to-l1",
			selected: TOKENS[0],
			resolved: resolved("registered"),
			balances: { l2Public: 1_000_000n, l2Private: 2_000_000n },
		})
		expect(w.find(sel(TESTIDS.sendBalanceL2Private)).text()).toBe("2.00 USDC")
		expect(w.find(sel(TESTIDS.sendBalanceL2Public)).text()).toBe("1.00 USDC")
		expect(w.find(sel(TESTIDS.sendBalanceL1)).exists()).toBe(false)
		w.unmount()
	})

	it("shows no balance for a token whose decimals are not read yet", () => {
		const w = step({ selected: token(USDT, "", { decimals: -1, source: "pasted" }), balances: { l1: 5n } })
		expect(w.find(sel(TESTIDS.sendBalanceL1)).text()).toBe("—")
		w.unmount()
	})

	it("says it is reading a token instead of summing up a stale one", () => {
		const w = step({ selected: TOKENS[0], resolved: resolved("registered"), resolving: true, balances: { l1: 5n } })
		expect(w.find(sel(TESTIDS.sendTokenSummary)).text()).toBe("Reading this token…")
		expect(w.find(sel(TESTIDS.sendBalanceL1)).exists()).toBe(false)
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

	it("keeps mechanism and first-time vocabulary out of the step", () => {
		const w = step({ selected: TOKENS[0], resolved: resolved("first-time") })
		expect(w.text().toLowerCase()).not.toMatch(/portal|register|first time/)
		w.unmount()
	})
})
