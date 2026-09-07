import { describe, expect, test } from "vitest"
import { usdThresholdToMicro } from "./incoming-dust"
import { foldLabel, isHiddenHolding } from "./token-fold"
import type { OrderableRow } from "./token-order"

const row = (symbol: string, over: Partial<OrderableRow> & { contract?: string } = {}): OrderableRow => ({
	token: { chainId: 1, contract: over.contract ?? `0x${symbol.toLowerCase()}`, name: `${symbol} Token`, symbol, decimals: 18 },
	publicBalance: over.publicBalance ?? "0",
	privateBalance: over.privateBalance ?? "0",
	updatedAt: over.updatedAt ?? 1,
})
const noPins = new Set<string>()
const ctx = (pins: ReadonlySet<string> = noPins) => ({ pinnedContracts: pins, fiatOf: () => undefined })
const dollar = usdThresholdToMicro(1)

describe("isHiddenHolding", () => {
	test("an empty row folds; a funded row above the threshold does not", () => {
		expect(isHiddenHolding(row("A"), { ctx: ctx(), usdRate: 2, thresholdMicro: dollar })).toBe(true)
		// 1 whole token at $2 ≥ $1.
		expect(
			isHiddenHolding(row("B", { privateBalance: (10n ** 18n).toString() }), { ctx: ctx(), usdRate: 2, thresholdMicro: dollar }),
		).toBe(false)
	})

	test("a funded row under the threshold folds as dust", () => {
		// 0.001 token at $2 = $0.002 < $1.
		expect(
			isHiddenHolding(row("D", { privateBalance: (10n ** 15n).toString() }), { ctx: ctx(), usdRate: 2, thresholdMicro: dollar }),
		).toBe(true)
	})

	test("dust fails open: no rate, threshold off, or an absurd decimals value keeps a funded row visible", () => {
		const funded = row("U", { privateBalance: "1" })
		expect(isHiddenHolding(funded, { ctx: ctx(), usdRate: undefined, thresholdMicro: dollar })).toBe(false)
		expect(isHiddenHolding(funded, { ctx: ctx(), usdRate: 2, thresholdMicro: 0n })).toBe(false)
		const absurd = { ...funded, token: { ...funded.token, decimals: 500 } }
		expect(isHiddenHolding(absurd, { ctx: ctx(), usdRate: 2, thresholdMicro: dollar })).toBe(false)
	})

	test("pinned, never-synced and malformed rows never fold", () => {
		expect(isHiddenHolding(row("P", { contract: "0xp" }), { ctx: ctx(new Set(["0xp"])), usdRate: 2, thresholdMicro: dollar })).toBe(
			false,
		)
		expect(isHiddenHolding(row("N", { updatedAt: 0 }), { ctx: ctx(), usdRate: 2, thresholdMicro: dollar })).toBe(false)
		expect(isHiddenHolding(row("X", { publicBalance: "1.5" }), { ctx: ctx(), usdRate: 2, thresholdMicro: dollar })).toBe(false)
	})
})

describe("foldLabel", () => {
	test("nothing hidden → no row", () => {
		expect(foldLabel({ hidden: 0, empty: 0, dust: 0, thresholdUsd: 1 })).toBeUndefined()
	})

	test("threshold off → only empties can hide, and the label says so", () => {
		expect(foldLabel({ hidden: 3, empty: 3, dust: 0, thresholdUsd: 0 })).toBe("3 empty")
	})

	test("threshold on → the split label", () => {
		expect(foldLabel({ hidden: 9, empty: 5, dust: 4, thresholdUsd: 5 })).toBe("9 hidden · 5 empty · 4 under $5")
	})
})
