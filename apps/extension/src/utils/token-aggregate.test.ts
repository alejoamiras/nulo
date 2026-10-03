import { describe, expect, test } from "vitest"
import { aggregateFiat } from "./token-aggregate"

type Row = { publicBalance?: string; privateBalance?: string; token: { symbol: string; decimals: number } }
const row = (symbol: string, pub = "0", priv = "0"): Row => ({ publicBalance: pub, privateBalance: priv, token: { symbol, decimals: 6 } })
const fiatBy = (prices: Record<string, bigint>) => (tb: Row) => prices[tb.token.symbol]

describe("aggregateFiat", () => {
	test("sums priced holdings; zero rows are neither holdings nor gaps", () => {
		const out = aggregateFiat([row("A", "10"), row("B", "0", "5"), row("Z")], fiatBy({ A: 100n, B: 7n, Z: 1n }))
		expect(out).toEqual({ micro: 107n, priced: 2, holdings: 2, partial: false })
	})

	test("an unpriced holding makes the total partial", () => {
		const out = aggregateFiat([row("A", "10"), row("U", "1")], fiatBy({ A: 100n }))
		expect(out).toEqual({ micro: 100n, priced: 1, holdings: 2, partial: true })
	})

	test("a malformed row is a holding with no price → partial, never a throw", () => {
		const out = aggregateFiat([row("A", "10"), row("BAD", "1.5")], fiatBy({ A: 100n, BAD: 999n }))
		expect(out).toEqual({ micro: 100n, priced: 1, holdings: 2, partial: true })
	})

	test("a zero-balance row with invalid decimals is still a malformed holding → partial", () => {
		const bad = { ...row("BAD"), token: { symbol: "BAD", decimals: 500 } }
		expect(aggregateFiat([row("A", "10"), bad], fiatBy({ A: 100n, BAD: 999n }))).toEqual({
			micro: 100n,
			priced: 1,
			holdings: 2,
			partial: true,
		})
	})

	test("nothing held → $0.00 and not partial", () => {
		expect(aggregateFiat([row("A"), row("B")], fiatBy({}))).toEqual({ micro: 0n, priced: 0, holdings: 0, partial: false })
	})
})

describe("aggregateFiat — row reads", () => {
	test("a row without a token but with a parseable balance is a holding with no price", () => {
		const tokenless = { publicBalance: "3", privateBalance: "0" } as unknown as Row
		expect(aggregateFiat([row("A", "10"), tokenless], fiatBy({ A: 100n }))).toEqual({
			micro: 100n,
			priced: 1,
			holdings: 2,
			partial: true,
		})
	})

	test("each balance property is read once per row", () => {
		const reads = { pub: 0, priv: 0 }
		const counted = {
			get publicBalance() {
				reads.pub++
				return "5"
			},
			get privateBalance() {
				reads.priv++
				return "0"
			},
			token: { symbol: "C", decimals: 6 },
		}
		aggregateFiat([counted], () => 1n)
		expect(reads).toEqual({ pub: 1, priv: 1 })
	})
})
