import { describe, expect, test } from "vitest"
import { restingAmount } from "./amount-field"

describe("composite/send/restingAmount", () => {
	test.each([
		["1234567.5", 18, "1,234,567.5"],
		["1.50", 18, "1.5"],
		["1.", 18, "1"],
		["007", 18, "7"],
		[".5", 18, "0.5"],
		["0.00", 18, "0"],
		[" 12.5 ", 18, "12.5"],
		// Whatever the parser refuses comes back as typed, so the validator judges what was typed.
		["1,234,567.5", 18, "1,234,567.5"],
		["1.234,56", 6, "1.234,56"],
		["abc", 18, "abc"],
		["1.2.3", 18, "1.2.3"],
		["-1", 18, "-1"],
		["1e-7", 18, "1e-7"],
		["1.1234567", 6, "1.1234567"],
	])("%s at %i decimals rests as %s, and stays there", (value, decimals, rest) => {
		expect(restingAmount(value, decimals)).toBe(rest)
		expect(restingAmount(rest, decimals)).toBe(rest)
	})
})
