import { describe, expect, test } from "vitest"
import { ARRIVAL_PLAYED_CAP, type ArrivalState, ArrivalRowSchema, claimPlayed, isArrivalEligible } from "./arrival-state"

const rec = (id: string, l2BlockNumber: number, contract = "0xtok", amountRaw = "1") => ({ id, contract, l2BlockNumber, amountRaw })
const state = (over: Partial<ArrivalState> = {}): ArrivalState => ({ sinceBlock: 10, floors: {}, played: [], ...over })

describe("isArrivalEligible", () => {
	test("a receipt above both floors plays", () => {
		expect(isArrivalEligible(rec("a", 21), state({ floors: { "0xtok": 20 } }))).toBe(true)
	})

	test("a receipt in the account floor's block or the token floor's block is history", () => {
		expect(isArrivalEligible(rec("a", 10), state())).toBe(false)
		expect(isArrivalEligible(rec("a", 20), state({ floors: { "0xtok": 20 } }))).toBe(false)
	})

	test("a receipt of zero, or of an amount that does not parse, plays nothing", () => {
		expect(isArrivalEligible(rec("a", 50, "0xtok", "0"), state())).toBe(false)
		expect(isArrivalEligible(rec("a", 50, "0xtok", "-1"), state())).toBe(false)
		expect(isArrivalEligible(rec("a", 50, "0xtok", "1.5"), state())).toBe(false)
	})

	test("a played receipt, an unknown baseline and a pending token floor play nothing", () => {
		expect(isArrivalEligible(rec("a", 50), state({ played: ["a"] }))).toBe(false)
		expect(isArrivalEligible(rec("a", 50), state({ sinceBlock: null }))).toBe(false)
		expect(isArrivalEligible(rec("a", 50), state({ floors: { "0xtok": "pending" } }))).toBe(false)
	})
})

describe("claimPlayed", () => {
	test("past the cap the floor rises to the evicted block and nothing claimed can play again", () => {
		const receipts = Array.from({ length: ARRIVAL_PLAYED_CAP + 1 }, (_, i) => rec(`r${i + 1}`, i + 1))
		const row = claimPlayed({ sinceBlock: 0, played: [] }, receipts)

		expect(row.played).toHaveLength(ARRIVAL_PLAYED_CAP)
		expect(row.sinceBlock).toBe(1)
		const after = state({ sinceBlock: row.sinceBlock, played: row.played.map(([id]) => id) })
		expect(receipts.filter((r) => isArrivalEligible(r, after))).toEqual([])
		expect(isArrivalEligible(rec("unplayed", 1), after)).toBe(false)
		expect(ArrivalRowSchema.safeParse(row).success).toBe(true)
	})

	test("claiming an id twice keeps one entry", () => {
		const row = claimPlayed(claimPlayed({ sinceBlock: 0, played: [] }, [rec("a", 5)]), [rec("a", 5)])
		expect(row.played).toEqual([["a", 5]])
	})
})

describe("ArrivalRowSchema", () => {
	test("accepts a valid row", () => {
		expect(ArrivalRowSchema.safeParse({ sinceBlock: 0, played: [["x".repeat(200), 3]] }).success).toBe(true)
	})

	test.each([
		["a string floor", { sinceBlock: "5", played: [] }],
		["NaN", { sinceBlock: Number.NaN, played: [] }],
		["a negative floor", { sinceBlock: -1, played: [] }],
		["a fractional block", { sinceBlock: 1, played: [["a", 1.5]] }],
		["an oversized played list", { sinceBlock: 1, played: Array.from({ length: ARRIVAL_PLAYED_CAP + 1 }, (_, i) => [`r${i}`, i]) }],
		["a 201-character id", { sinceBlock: 1, played: [["x".repeat(201), 1]] }],
	])("rejects %s", (_name, row) => {
		expect(ArrivalRowSchema.safeParse(row).success).toBe(false)
	})
})
