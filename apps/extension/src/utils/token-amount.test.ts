import { describe, expect, test, vi } from "vitest"
import { MAX_DECIMALS, isValidDecimals, parseRawBalance, safeFiatOf } from "./token-amount"

describe("parseRawBalance", () => {
	test("sums both sides; an absent side is zero", () => {
		expect(parseRawBalance({ publicBalance: "10", privateBalance: "5" })).toBe(15n)
		expect(parseRawBalance({ publicBalance: "7" })).toBe(7n)
		expect(parseRawBalance({})).toBe(0n)
	})

	test("any malformed side makes the whole row unknown", () => {
		for (const bad of ["-1", "1.5", "1e3", "0x10", "", " 1", "abc", "1".repeat(81)]) {
			expect(parseRawBalance({ publicBalance: bad, privateBalance: "1" }), bad).toBeUndefined()
			expect(parseRawBalance({ publicBalance: "1", privateBalance: bad }), bad).toBeUndefined()
		}
		expect(parseRawBalance({ publicBalance: 5 as unknown as string })).toBeUndefined()
	})
})

describe("isValidDecimals", () => {
	test("integers 0..MAX_DECIMALS only", () => {
		expect(isValidDecimals(0)).toBe(true)
		expect(isValidDecimals(18)).toBe(true)
		expect(isValidDecimals(MAX_DECIMALS)).toBe(true)
		expect(isValidDecimals(MAX_DECIMALS + 1)).toBe(false)
		expect(isValidDecimals(-1)).toBe(false)
		expect(isValidDecimals(1.5)).toBe(false)
		expect(isValidDecimals("18")).toBe(false)
		expect(isValidDecimals(Number.NaN)).toBe(false)
		expect(isValidDecimals(undefined)).toBe(false)
	})
})

describe("safeFiatOf", () => {
	const row = (over: Record<string, unknown> = {}) => ({
		publicBalance: "1",
		privateBalance: "0",
		token: { decimals: 6 },
		...over,
	})

	test("calls through for a well-formed row", () => {
		const inner = vi.fn(() => 42n)
		expect(safeFiatOf(inner)(row())).toBe(42n)
		expect(inner).toHaveBeenCalledTimes(1)
	})

	test("never calls the lookup for a malformed balance or invalid decimals", () => {
		const inner = vi.fn(() => 42n)
		const safe = safeFiatOf(inner)
		expect(safe(row({ publicBalance: "nope" }))).toBeUndefined()
		expect(safe(row({ token: { decimals: 500 } }))).toBeUndefined()
		expect(safe(row({ token: { decimals: -3 } }))).toBeUndefined()
		expect(inner).not.toHaveBeenCalled()
	})

	test("a throwing lookup reads as unpriced", () => {
		const safe = safeFiatOf(() => {
			throw new Error("boom")
		})
		expect(safe(row())).toBeUndefined()
	})
})
