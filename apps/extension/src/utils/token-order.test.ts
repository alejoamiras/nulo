import { describe, expect, test } from "vitest"
import { HOME_TOKEN_ROWS, type OrderableRow, capTokenRows, classifyRow, forChain, orderTokenRows } from "./token-order"

const row = (symbol: string, over: Partial<OrderableRow> & { contract?: string; name?: string; chainId?: number } = {}): OrderableRow => ({
	token: {
		chainId: over.chainId ?? 1,
		contract: over.contract ?? `0x${symbol.toLowerCase()}`,
		name: over.name ?? `${symbol} Token`,
		symbol,
		decimals: 6,
	},
	publicBalance: over.publicBalance ?? "0",
	privateBalance: over.privateBalance ?? "0",
	updatedAt: over.updatedAt ?? 1,
})

/** Price table keyed by symbol; absent = unpriced. */
const fiatBy = (prices: Record<string, bigint>) => (tb: OrderableRow) => prices[tb.token.symbol]
const noPins = new Set<string>()
const ctx = (prices: Record<string, bigint>, pins: ReadonlySet<string> = noPins) => ({ pinnedContracts: pins, fiatOf: fiatBy(prices) })

describe("classifyRow", () => {
	test("empty before price: a priced zero row is empty, a funded unpriced row is held", () => {
		expect(classifyRow(row("USDC"), ctx({ USDC: 0n }))).toBe("empty")
		expect(classifyRow(row("AZTK", { privateBalance: "5" }), ctx({}))).toBe("held-unpriced")
		expect(classifyRow(row("ETH", { privateBalance: "5" }), ctx({ ETH: 100n }))).toBe("held-priced")
	})

	test("never-synced and malformed rows are their own classes; absurd decimals are malformed too", () => {
		expect(classifyRow(row("NEW", { updatedAt: 0 }), ctx({}))).toBe("unsynced")
		expect(classifyRow(row("BAD", { publicBalance: "1.5" }), ctx({}))).toBe("unknown")
		const huge = row("HUGE", { privateBalance: "1" })
		huge.token.decimals = 500
		expect(classifyRow(huge, ctx({}))).toBe("unknown")
	})

	test("pin membership wins before any number is read", () => {
		const pins = new Set(["0xbad"])
		expect(classifyRow(row("BAD", { publicBalance: "junk" }), ctx({}, pins))).toBe("pinned")
	})
})

describe("orderTokenRows", () => {
	test("priced by fiat desc, then unpriced-held by name, then unsynced, unknown, empty", () => {
		const rows = [
			row("EMPTY"),
			row("ZED", { privateBalance: "1", name: "Zed" }),
			row("NEW", { updatedAt: 0 }),
			row("ETH", { privateBalance: "1" }),
			row("BAD", { publicBalance: "-1" }),
			row("ALPHA", { privateBalance: "1", name: "Alpha" }),
			row("USDC", { publicBalance: "1" }),
		]
		const out = orderTokenRows(rows, ctx({ ETH: 3_000n, USDC: 10n }))
		expect(out.map((r) => r.token.symbol)).toEqual(["ETH", "USDC", "ALPHA", "ZED", "NEW", "BAD", "EMPTY"])
	})

	test("pinned first, priced pins before unpriced pins, a malformed pin stays in the top three", () => {
		const pins = new Set(["0xa", "0xb", "0xbad"])
		const rows = [
			row("RICH", { privateBalance: "1" }),
			row("A", { contract: "0xa", privateBalance: "1" }),
			row("BAD", { contract: "0xbad", publicBalance: "x" }),
			row("B", { contract: "0xb", privateBalance: "1" }),
			row("MORE", { privateBalance: "1" }),
		]
		const out = orderTokenRows(rows, ctx({ RICH: 9_999n, A: 1n, B: 5n, MORE: 50n }, pins))
		expect(out.slice(0, 3).map((r) => r.token.symbol)).toEqual(["B", "A", "BAD"])
		expect(out.map((r) => r.token.symbol)).toEqual(["B", "A", "BAD", "RICH", "MORE"])
	})

	test("a malformed pin sorts behind a valid unpriced pin, whatever their names", () => {
		const pins = new Set(["0xa_bad", "0xz_good"])
		const rows = [
			row("A_BAD", { contract: "0xa_bad", publicBalance: "x", name: "A" }),
			row("Z_GOOD", { contract: "0xz_good", privateBalance: "1", name: "Z" }),
		]
		expect(orderTokenRows(rows, ctx({}, pins)).map((r) => r.token.symbol)).toEqual(["Z_GOOD", "A_BAD"])
	})

	test("fiat kill-switch (everything unpriced) falls back to name order among held rows", () => {
		const rows = [row("B", { privateBalance: "1", name: "Bravo" }), row("A", { privateBalance: "9", name: "Alpha" })]
		expect(orderTokenRows(rows, ctx({})).map((r) => r.token.symbol)).toEqual(["A", "B"])
	})

	test("never mutates the input", () => {
		const rows = [row("B", { privateBalance: "1" }), row("A", { privateBalance: "1" })]
		const snapshot = [...rows]
		orderTokenRows(rows, ctx({}))
		expect(rows).toEqual(snapshot)
	})
})

describe("capTokenRows", () => {
	test("budget is HOME_TOKEN_ROWS; overflow counts the rest", () => {
		expect(HOME_TOKEN_ROWS).toBe(3)
		expect(capTokenRows([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], overflow: 2 })
		expect(capTokenRows([1, 2])).toEqual({ shown: [1, 2], overflow: 0 })
		expect(capTokenRows([])).toEqual({ shown: [], overflow: 0 })
	})
})

describe("forChain", () => {
	test("keeps the active chain's rows and drops a same-address row from another chain", () => {
		const rows = [row("A", { chainId: 1 }), row("B", { chainId: 2 })]
		expect(forChain(rows, 1).map((r) => r.token.symbol)).toEqual(["A"])
		expect(forChain(rows, undefined)).toEqual([])
	})
})
