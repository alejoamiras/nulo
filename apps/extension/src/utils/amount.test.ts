import { describe, expect, test } from "vitest"
import {
	balanceFormatted,
	clampDecimals,
	formatBaseUnits,
	isValidAmount,
	normalizeAmount,
	parseAmountToBaseUnits,
	purgeNumber,
} from "./amount"

/** Locale-pinned defaults so the tests don't depend on ambient locale.
 *  Production helpers default to `getDecimalSeparator()` / `getThousandSeparator()`,
 *  which read from `Number.toLocaleString` at runtime — fine in app context but
 *  flaky in CI. Pass these in to assert byte-exact strings. */
const PIN = { decimalSep: ".", thousandsSep: "," } as const

describe("amount/clampDecimals", () => {
	test("returns input unchanged when there's no dot", () => {
		expect(clampDecimals("12345", 4)).toBe("12345")
	})

	test("returns input unchanged when fractional length is below max", () => {
		expect(clampDecimals("1.5", 4)).toBe("1.5")
	})

	test("returns input unchanged when fractional length equals max", () => {
		expect(clampDecimals("1.5000", 4)).toBe("1.5000")
	})

	test("truncates fractional part to maxDecimals", () => {
		expect(clampDecimals("1.234567", 4)).toBe("1.2345")
	})

	test("truncates the example from the bug repro (14.0234375 on a 6-dec token)", () => {
		expect(clampDecimals("14.0234375", 6)).toBe("14.023437")
	})

	test("preserves a trailing dot (mid-typing)", () => {
		expect(clampDecimals("1.", 4)).toBe("1.")
	})

	test("preserves a leading dot", () => {
		expect(clampDecimals(".5", 4)).toBe(".5")
	})

	test("strips the dot when maxDecimals=0", () => {
		expect(clampDecimals("1.234", 0)).toBe("1")
	})

	test("strips a lone trailing dot when maxDecimals=0", () => {
		expect(clampDecimals("1.", 0)).toBe("1")
	})

	test("returns input unchanged for negative maxDecimals (defensive)", () => {
		expect(clampDecimals("1.234", -1)).toBe("1.234")
	})

	test("handles empty string", () => {
		expect(clampDecimals("", 4)).toBe("")
	})

	test("handles a lone dot (preserved as-is)", () => {
		expect(clampDecimals(".", 4)).toBe(".")
	})
})

describe("amount/parseAmountToBaseUnits", () => {
	test("integer input scales correctly", () => {
		expect(parseAmountToBaseUnits("1", 6)).toBe(1000000n)
	})

	test("fractional input within decimals scales correctly", () => {
		expect(parseAmountToBaseUnits("1.5", 6)).toBe(1500000n)
	})

	test("zero scales to zero", () => {
		expect(parseAmountToBaseUnits("0", 6)).toBe(0n)
		expect(parseAmountToBaseUnits("0.0", 6)).toBe(0n)
	})

	test("18-decimal token (Fee Juice) handles small fractions exactly", () => {
		expect(parseAmountToBaseUnits("0.0001", 18)).toBe(100000000000000n)
	})

	test("0-decimal token rejects fractional input", () => {
		expect(() => parseAmountToBaseUnits("1.5", 0)).toThrow(/too many decimals/)
	})

	test("0-decimal token accepts integer input", () => {
		expect(parseAmountToBaseUnits("1", 0)).toBe(1n)
	})

	test("missing fractional digits pad with zeros", () => {
		expect(parseAmountToBaseUnits("1", 18)).toBe(1000000000000000000n)
	})

	test("leading dot treated as 0.x", () => {
		expect(parseAmountToBaseUnits(".5", 6)).toBe(500000n)
	})

	test("trailing dot treated as x.0", () => {
		expect(parseAmountToBaseUnits("1.", 6)).toBe(1000000n)
	})

	test("rejects more fractional digits than the token supports (the bug)", () => {
		expect(() => parseAmountToBaseUnits("14.0234375", 6)).toThrow(/too many decimals/)
	})

	test("rejects empty string", () => {
		expect(() => parseAmountToBaseUnits("", 6)).toThrow(/empty/)
	})

	test("rejects a lone dot", () => {
		expect(() => parseAmountToBaseUnits(".", 6)).toThrow(/empty/)
	})

	test("rejects scientific notation", () => {
		expect(() => parseAmountToBaseUnits("1e5", 6)).toThrow(/non-numeric/)
	})

	test("rejects negative numbers", () => {
		expect(() => parseAmountToBaseUnits("-1", 6)).toThrow(/non-numeric/)
	})

	test("rejects multiple dots", () => {
		expect(() => parseAmountToBaseUnits("1.2.3", 6)).toThrow(/non-numeric/)
	})

	test("rejects letters", () => {
		expect(() => parseAmountToBaseUnits("1abc", 6)).toThrow(/non-numeric/)
	})

	test("rejects negative decimals (caller bug)", () => {
		expect(() => parseAmountToBaseUnits("1", -1)).toThrow(/Invalid decimals/)
	})

	test("rejects non-integer decimals (caller bug)", () => {
		expect(() => parseAmountToBaseUnits("1", 6.5)).toThrow(/Invalid decimals/)
	})

	test("rejects non-string input (defensive)", () => {
		// @ts-expect-error testing runtime guard
		expect(() => parseAmountToBaseUnits(123, 6)).toThrow(/empty/)
		// @ts-expect-error testing runtime guard
		expect(() => parseAmountToBaseUnits(null, 6)).toThrow(/empty/)
	})
})

describe("amount/isValidAmount", () => {
	test("accepts a positive integer string", () => {
		expect(isValidAmount("1")).toBe(true)
	})

	test("accepts a positive fractional string under 18 decimals", () => {
		expect(isValidAmount("1.5")).toBe(true)
	})

	test("rejects zero", () => {
		expect(isValidAmount("0")).toBe(false)
	})

	test("rejects empty string", () => {
		expect(isValidAmount("")).toBe(false)
	})

	test("rejects negative", () => {
		expect(isValidAmount("-1")).toBe(false)
	})

	test("rejects non-string", () => {
		expect(isValidAmount(1)).toBe(false)
		expect(isValidAmount(null)).toBe(false)
		expect(isValidAmount(undefined)).toBe(false)
		expect(isValidAmount({})).toBe(false)
	})

	test("rejects > 18 fractional digits (which can never round-trip into FJ either)", () => {
		expect(isValidAmount("0.0000000000000000001")).toBe(false)
	})
})

describe("amount/purgeNumber", () => {
	test("returns valid numeric strings unchanged", () => {
		expect(purgeNumber("1.5")).toBe("1.5")
		expect(purgeNumber("0")).toBe("0")
		expect(purgeNumber("100")).toBe("100")
	})

	test("strips non-numeric characters", () => {
		expect(purgeNumber("1abc")).toBe("1")
		expect(purgeNumber("1,000")).toBe("1000")
		expect(purgeNumber("$5.00")).toBe("5.00")
	})

	test("preserves the dot", () => {
		expect(purgeNumber("a.b")).toBe(".")
	})
})

describe("amount/normalizeAmount", () => {
	test("expands a lone dot to '0.'", () => {
		expect(normalizeAmount(".")).toBe("0.")
	})

	test("trims a duplicate dot from the end", () => {
		expect(normalizeAmount("1.5.")).toBe("1.5")
	})

	test("preserves a single trailing dot (in-progress typing)", () => {
		expect(normalizeAmount("1.")).toBe("1.")
	})

	test("returns empty string for empty input", () => {
		expect(normalizeAmount("")).toBe("")
	})

	test("clamps astronomically large numbers", () => {
		expect(normalizeAmount("99999999999999")).toBe("9999999999999")
	})

	test("returns undefined for valid passthrough inputs", () => {
		expect(normalizeAmount("1.5")).toBeUndefined()
		expect(normalizeAmount("100")).toBeUndefined()
	})
})

describe("amount/formatBaseUnits", () => {
	test("zero formats as '0' (no decimal)", () => {
		expect(formatBaseUnits(0n, 6, PIN)).toBe("0")
	})

	test("null/undefined/empty string formats as '0'", () => {
		expect(formatBaseUnits(null, 6, PIN)).toBe("0")
		expect(formatBaseUnits(undefined, 6, PIN)).toBe("0")
		expect(formatBaseUnits("", 6, PIN)).toBe("0")
	})

	test("integer base units (no fractional)", () => {
		expect(formatBaseUnits(15000000n, 6, PIN)).toBe("15")
	})

	test("fractional base units, default trim", () => {
		expect(formatBaseUnits(15500000n, 6, PIN)).toBe("15.5")
	})

	test("preserves all fractional digits when no maxDecimals set", () => {
		expect(formatBaseUnits(123456789n, 6, PIN)).toBe("123.456789")
	})

	test("maxDecimals TRUNCATES (round-down) — never rounds up", () => {
		// 14999999n on a 6-dec token = 14.999999 — must show 14.9999, NOT 15.0000.
		expect(formatBaseUnits(14999999n, 6, { maxDecimals: 4, ...PIN })).toBe("14.9999")
	})

	test("maxDecimals truncates the bug-repro value safely", () => {
		// The exact value the QA bug surfaced: `14.0234375 × 10^6 = 14023437` (after
		// integer scaling). Display truncated to 4 places must NOT round up.
		expect(formatBaseUnits(14023437n, 6, { maxDecimals: 4, ...PIN })).toBe("14.0234")
	})

	test("maxDecimals=0 strips the fractional part entirely", () => {
		expect(formatBaseUnits(15999999n, 6, { maxDecimals: 0, ...PIN })).toBe("15")
	})

	test("minDecimals: solo behaves as 'at least N digits' (no truncation, no trim by default)", () => {
		// 15500000n / 1e6 = 15.500000. minDecimals=4 means 'show at least 4 digits';
		// the actual precision is 6, so all 6 are kept.
		expect(formatBaseUnits(15500000n, 6, { minDecimals: 4, ...PIN })).toBe("15.500000")
	})

	test("minDecimals pads when fracStr is shorter (combined with maxDecimals)", () => {
		// 1n / 1e18 = 0.000000000000000001. maxDecimals=8 truncates to "00000000".
		// minDecimals=4 enforces 4 digits — but trim default for minDecimals>0 is false,
		// so all 8 zeros stay. Caller wanting fixed N passes both maxDecimals AND minDecimals.
		expect(formatBaseUnits(1n, 18, { maxDecimals: 8, minDecimals: 4, ...PIN })).toBe("0.00000000")
	})

	test("minDecimals + maxDecimals together gives fixed N digits", () => {
		expect(formatBaseUnits(14999999n, 6, { minDecimals: 4, maxDecimals: 4, ...PIN })).toBe("14.9999")
		expect(formatBaseUnits(15000000n, 6, { minDecimals: 4, maxDecimals: 4, ...PIN })).toBe("15.0000")
	})

	test("trimTrailingZeros default is true when minDecimals is 0/undefined", () => {
		expect(formatBaseUnits(15500000n, 6, PIN)).toBe("15.5")
	})

	test("trimTrailingZeros false keeps trailing zeros after maxDecimals truncation", () => {
		// 15500000n / 1e6 = 15.500000. maxDecimals=4 truncates to "5000". With
		// trimTrailingZeros=false, the trailing "000" stays.
		expect(formatBaseUnits(15500000n, 6, { maxDecimals: 4, trimTrailingZeros: false, ...PIN })).toBe("15.5000")
	})

	test("thousandsSep default is locale-derived; explicit ',' inserts on integer part only", () => {
		expect(formatBaseUnits(1500000000n, 6, { thousandsSep: "," })).toBe("1,500")
	})

	test("explicit thousandsSep='' produces no separator", () => {
		expect(formatBaseUnits(1500000000n, 6, { thousandsSep: "", decimalSep: "." })).toBe("1500")
	})

	test("decimalSep override (locale-flexible)", () => {
		expect(formatBaseUnits(15500000n, 6, { decimalSep: ",", thousandsSep: "." })).toBe("15,5")
	})

	test("18-decimal Fee Juice format with thousandsSep", () => {
		expect(formatBaseUnits(1500000000000000000n, 18, PIN)).toBe("1.5")
	})

	test("0-decimal token (integer-only)", () => {
		expect(formatBaseUnits(42n, 0, PIN)).toBe("42")
	})

	test("very small bigint (single base unit at 18 decimals)", () => {
		expect(formatBaseUnits(1n, 18, PIN)).toBe("0.000000000000000001")
	})

	test("very small bigint truncated to 4 places strips to '0' by default", () => {
		// 1n / 1e18 truncated to 4 = "0000". Default trim strips to "" → output "0".
		// Caller wanting "0.0000" fixed-width passes minDecimals OR trim=false.
		// Caller wanting "<0.0001" hint detects this case at its layer.
		expect(formatBaseUnits(1n, 18, { maxDecimals: 4, ...PIN })).toBe("0")
	})

	test("very small bigint with minDecimals=maxDecimals=4 shows fixed '0.0000'", () => {
		expect(formatBaseUnits(1n, 18, { maxDecimals: 4, minDecimals: 4, ...PIN })).toBe("0.0000")
	})

	test("string input parses to bigint", () => {
		expect(formatBaseUnits("15500000", 6, PIN)).toBe("15.5")
	})

	test("negative value formats with leading '-'", () => {
		expect(formatBaseUnits(-1500000n, 6, PIN)).toBe("-1.5")
	})

	test("rejects negative decimals", () => {
		expect(() => formatBaseUnits(1n, -1, PIN)).toThrow(/Invalid decimals/)
	})

	test("rejects non-integer decimals", () => {
		expect(() => formatBaseUnits(1n, 6.5, PIN)).toThrow(/Invalid decimals/)
	})

	test("exact-precision parity for typical balance-render inputs", () => {
		// These were validated against BN.toFormat() during the BN→bigint
		// migration. They anchor the no-display-drift contract for the most
		// common balance rendering paths.
		expect(formatBaseUnits(15000000n, 6, PIN)).toBe("15")
		expect(formatBaseUnits(1n, 18, PIN)).toBe("0.000000000000000001")
		expect(formatBaseUnits(1234567890n, 6, PIN)).toBe("1,234.56789")
		expect(formatBaseUnits(1500000000000000000n, 18, PIN)).toBe("1.5")
		expect(formatBaseUnits(0n, 6, PIN)).toBe("0")
	})
})

describe("amount/balanceFormatted", () => {
	test("returns '0' when input is null/undefined/zero/empty-string", () => {
		expect(balanceFormatted(null, 6)).toEqual({ value: "0", slashed: false })
		expect(balanceFormatted(undefined, 6)).toEqual({ value: "0", slashed: false })
		expect(balanceFormatted(0n, 6)).toEqual({ value: "0", slashed: false })
		expect(balanceFormatted("", 6)).toEqual({ value: "0", slashed: false })
	})

	test("formats a non-zero bigint without truncation when no length is given", () => {
		// 1500000n / 1e6 = 1.5
		const result = balanceFormatted(1500000n, 6)
		expect(result.slashed).toBe(false)
		expect(result.value).toMatch(/^1[.,]5$/)
	})

	test("slices to length and sets slashed when output exceeds length", () => {
		// 1234567890n / 1e9 = 1.23456789 → 10 chars. With length=5: slice to 5 chars,
		// no "..." suffix — callers gate their own affordance off `slashed`.
		const result = balanceFormatted(1234567890n, 9, 5)
		expect(result.slashed).toBe(true)
		expect(result.value.length).toBe(5)
		expect(result.value).toBe("1.234")
	})

	test("renders <0.0001-style fallback for very small balances at narrow widths", () => {
		// 1n / 1e9 = 0.000000001. length=5 → hintDigits=3. Threshold=10^(9-3)=1e6.
		// u=1 < 1e6 → small-value hint fires.
		const result = balanceFormatted(1n, 9, 5)
		expect(result.slashed).toBe(true)
		expect(result.value.startsWith("<0")).toBe(true)
	})

	test("accepts string inputs", () => {
		expect(balanceFormatted("1500000", 6).value).toMatch(/^1[.,]5$/)
	})
})
