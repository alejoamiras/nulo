import { describe, expect, test, vi } from "vitest"
import type { Token } from "@/wallet/services/token/spec"
import { getTokenInfo } from "@/wallet/services/token/utils"
import { MAX_DECIMALS, isValidDecimals, knownDecimals, parseRawBalance, safeFiatOf } from "./token-amount"

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

describe("knownDecimals", () => {
	const row = (over: Partial<Token>): Token => ({
		id: 1,
		profileId: "p1",
		chainId: 1,
		contract: `0x${"0a".repeat(32)}`,
		name: "Test",
		symbol: "TST",
		decimals: 18,
		getDecimalsFn: { name: "decimals", impl: 0 },
		...over,
	})

	test.each([
		["a getter at 18", row({}), 18],
		["a getter at 0", row({ decimals: 0 }), 0],
		["no getter, stored 0", row({ decimals: 0, getDecimalsFn: undefined }), null],
		["a getter at 255", row({ decimals: 255 }), null],
	])("%s", (_name, token, expected) => {
		expect(knownDecimals(getTokenInfo(token))).toBe(expected)
	})

	test("no token", () => {
		expect(knownDecimals(undefined)).toBeNull()
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

describe("safeFiatOf — row reads", () => {
	test("a row without a token reads as unpriced and never reaches the lookup", () => {
		const inner = vi.fn(() => 42n)
		expect(safeFiatOf(inner)({ publicBalance: "1", privateBalance: "0" })).toBeUndefined()
		expect(inner).not.toHaveBeenCalled()
	})

	test("each balance property is read once before the lookup", () => {
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
			token: { decimals: 6 },
		}
		expect(safeFiatOf(() => 7n)(counted)).toBe(7n)
		expect(reads).toEqual({ pub: 1, priv: 1 })
	})
})
