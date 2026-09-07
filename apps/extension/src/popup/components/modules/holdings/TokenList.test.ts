/**
 * TokenList mounted with the REAL TokenCard (not a stub) so hostile rows are proven to render
 * through the whole row, not just through the pure helpers.
 */
import { flushPromises, mount } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"
import { EventHandler } from "@nulo/wallet-core/utils"
import TokenList from "./TokenList.vue"

vi.mock("@/stores/app.store", () => ({ useAppStore: () => ({}) }))
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onQuotesUpdated: new EventHandler(),
			onConnected: new EventHandler(),
			refreshIfStale: vi.fn().mockResolvedValue({}),
		}
	}),
}))

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Spinner: { template: '<i data-testid="stub-spinner" />' },
	RouterLink: { template: '<a :href="to"><slot /></a>', props: ["to"] },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	MaterialIcon: { template: '<span data-testid="stub-micon" :data-name="name" />', props: ["name", "size", "color"] },
	Tooltip: { template: "<span><slot /></span>", props: ["side", "position", "delay"] },
}

type Row = {
	id: number
	token: { id: number; chainId: number; contract: string; name: string; symbol: string; decimals: number }
	account: string
	publicBalance?: string
	privateBalance?: string
	updatedAt: number
}
const row = (id: number, symbol: string, over: Partial<Row> & { name?: string; contract?: string; decimals?: number } = {}): Row => ({
	id,
	token: {
		id,
		chainId: 1,
		contract: over.contract ?? `0x${symbol.toLowerCase()}`,
		name: over.name ?? `${symbol} Token`,
		symbol,
		decimals: over.decimals ?? 18,
	},
	account: "0xacct",
	publicBalance: over.publicBalance ?? "0",
	privateBalance: over.privateBalance ?? "0",
	updatedAt: over.updatedAt ?? 1,
})
const ONE = (10n ** 18n).toString()
/** Prices keyed by symbol (micro-USD); absent = unpriced. */
const fiatBy = (prices: Record<string, bigint>) => (tb: Row) => prices[tb.token.symbol]
const rateBy = (rates: Record<string, number>) => (tb: Row) => rates[tb.token.symbol]

const mountList = (props: Record<string, unknown>) =>
	mount(TokenList, { props: { fiatOf: fiatBy({}), ...props } as never, global: { stubs: STUBS } })
const symbols = (w: ReturnType<typeof mountList>) => w.findAll('[data-testid="token-symbol"]').map((s) => s.attributes("data-symbol"))
const setQuery = async (w: ReturnType<typeof mountList>, q: string) => {
	await w.find('[data-testid="holdings-search"]').setValue(q)
	await flushPromises()
}

describe("TokenList — order, search, sort", () => {
	test("value order by default: priced desc, then unpriced held by name; the count reflects matches", async () => {
		const w = mountList({
			rows: [
				row(1, "ZED", { privateBalance: ONE }),
				row(2, "ETH", { privateBalance: ONE }),
				row(3, "ALPHA", { privateBalance: ONE }),
			],
			fiatOf: fiatBy({ ETH: 3_000n }),
		})
		await flushPromises()
		expect(symbols(w)).toEqual(["ETH", "ALPHA", "ZED"])
		expect(w.find('[data-testid="holdings-count"]').text()).toBe("3")
	})

	test("search filters by symbol, name and 0x prefix; a miss shows the no-results line", async () => {
		const w = mountList({
			rows: [row(1, "A+B", { name: "Alpha Plus", contract: "0xabc", privateBalance: ONE }), row(2, "ZED", { privateBalance: ONE })],
		})
		await setQuery(w, "a+b")
		expect(symbols(w)).toEqual(["A+B"])
		await setQuery(w, "plus")
		expect(symbols(w)).toEqual(["A+B"])
		await setQuery(w, "0xab")
		expect(symbols(w)).toEqual(["A+B"])
		await setQuery(w, "nothing")
		expect(w.find('[data-testid="holdings-no-results"]').exists()).toBe(true)
		expect(symbols(w)).toEqual([])
	})

	test("the sort toggle flips to name order and back", async () => {
		const w = mountList({
			rows: [row(1, "ZED", { privateBalance: ONE }), row(2, "ETH", { privateBalance: ONE })],
			fiatOf: fiatBy({ ETH: 3_000n, ZED: 1n }),
		})
		await flushPromises()
		expect(symbols(w)).toEqual(["ETH", "ZED"])
		await w.find('[data-testid="holdings-sort"]').trigger("click")
		expect(w.find('[data-testid="holdings-sort"]').attributes("data-sort")).toBe("name")
		expect(symbols(w)).toEqual(["ETH", "ZED"]) // ETH Token < ZED Token by name too
		await w.find('[data-testid="holdings-sort"]').trigger("click")
		expect(w.find('[data-testid="holdings-sort"]').attributes("data-sort")).toBe("value")
	})
})

describe("TokenList — pinned partition", () => {
	test("pinned rows sit above the rule; the rule only renders when both sides have rows", async () => {
		const pins = new Set(["0xp"])
		const w = mountList({
			rows: [row(1, "RICH", { privateBalance: ONE }), row(2, "P", { contract: "0xp", privateBalance: ONE })],
			fiatOf: fiatBy({ RICH: 9_999n }),
			pinnedContracts: pins,
		})
		await flushPromises()
		expect(symbols(w)).toEqual(["P", "RICH"])
		expect(w.find('[data-testid="token-list-divider"]').exists()).toBe(true)

		await setQuery(w, "P")
		expect(symbols(w)).toEqual(["P"])
		expect(w.find('[data-testid="token-list-divider"]').exists()).toBe(false)
	})

	test("a pinned empty row never folds and a pinned malformed row still renders", async () => {
		const pins = new Set(["0xe", "0xbad"])
		const w = mountList({
			rows: [
				row(1, "E", { contract: "0xe" }),
				row(2, "BAD", { contract: "0xbad", publicBalance: "1.5" }),
				row(3, "HELD", { privateBalance: ONE }),
			],
			pinnedContracts: pins,
		})
		await flushPromises()
		// Both pinned; the malformed pin ranks behind every readable pin, the held row after both.
		expect(symbols(w)).toEqual(["E", "BAD", "HELD"])
		expect(w.find('[data-testid="holdings-fold"]').exists()).toBe(false)
		expect(w.find('[data-malformed="true"]').text()).toBe("—")
	})
})

describe("TokenList — fold", () => {
	test("empties fold behind a labelled row; expanding shows them; threshold 0 says 'N empty'", async () => {
		const w = mountList({ rows: [row(1, "HELD", { privateBalance: ONE }), row(2, "E1"), row(3, "E2")] })
		await flushPromises()
		expect(symbols(w)).toEqual(["HELD"])
		const fold = w.find('[data-testid="holdings-fold"]')
		expect(fold.text()).toContain("2 empty")
		await fold.trigger("click")
		expect(symbols(w)).toEqual(["HELD", "E1", "E2"])
		expect(w.find('[data-testid="holdings-fold"]').attributes("data-open")).toBe("true")
	})

	test("with a threshold and rates, dust folds too and the label splits the count", async () => {
		const w = mountList({
			rows: [row(1, "BIG", { privateBalance: ONE }), row(2, "DUST", { privateBalance: "1000" }), row(3, "E")],
			fiatOf: fiatBy({ BIG: 2_000_000n, DUST: 1n }),
			usdRateOf: rateBy({ BIG: 2, DUST: 2 }),
			dustThresholdUsd: 1,
		})
		await flushPromises()
		expect(symbols(w)).toEqual(["BIG"])
		expect(w.find('[data-testid="holdings-fold"]').text()).toContain("2 hidden · 1 empty · 1 under $1")
	})

	test("never-synced and malformed rows stay visible; a malformed row renders a dash through the real card", async () => {
		const w = mountList({
			rows: [
				row(1, "NEW", { updatedAt: 0 }),
				row(2, "BAD", { publicBalance: "junk" }),
				row(3, "HUGE", { publicBalance: "1", decimals: 500 }),
			],
		})
		await flushPromises()
		// unsynced first, then the two unknown rows by name ("BAD Token" < "HUGE Token").
		expect(symbols(w)).toEqual(["NEW", "BAD", "HUGE"])
		expect(w.find('[data-testid="holdings-fold"]').exists()).toBe(false)
		expect(w.findAll('[data-malformed="true"]')).toHaveLength(2)
	})

	test("no rows at all renders no fold, no rule and no results line", async () => {
		const w = mountList({ rows: [] })
		await flushPromises()
		expect(w.find('[data-testid="holdings-fold"]').exists()).toBe(false)
		expect(w.find('[data-testid="token-list-divider"]').exists()).toBe(false)
		expect(w.find('[data-testid="holdings-no-results"]').exists()).toBe(false)
	})
})
