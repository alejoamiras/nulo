import { describe, expect, it } from "vitest"
import { formatBigInt, parseAmount, trimAddress } from "./format"

describe("formatBigInt", () => {
	it("formats zero with the requested display places", () => {
		expect(formatBigInt(0n, 6)).toBe("0.00")
		expect(formatBigInt(0n, 18, 4)).toBe("0.0000")
	})

	it("formats 1,000 USDC (decimals=6) correctly", () => {
		expect(formatBigInt(1_000_000_000n, 6)).toBe("1,000.00")
	})

	it("formats 1 ETH (decimals=18) correctly", () => {
		expect(formatBigInt(1_000_000_000_000_000_000n, 18)).toBe("1.00")
	})

	it("truncates fractional digits beyond displayPlaces (no rounding)", () => {
		expect(formatBigInt(1_234_567n, 6, 2)).toBe("1.23")
	})

	it("preserves fractional zeros when 0 < value < 1", () => {
		expect(formatBigInt(50_000n, 6, 2)).toBe("0.05")
	})
})

describe("trimAddress", () => {
	const long = "0x12345678901234567890123456789012345678901234567890123456789012ab"

	it("shortens a long address using default head/tail", () => {
		expect(trimAddress(long)).toBe(`${long.slice(0, 6)}…${long.slice(-4)}`)
	})

	it("returns an em-dash for empty input", () => {
		expect(trimAddress("")).toBe("-")
	})

	it("returns the original when shorter than head+tail+2", () => {
		expect(trimAddress("0x123")).toBe("0x123")
	})
})

describe("parseAmount (BigInt-safe fixed-decimal parsing)", () => {
	it("parses whole + fractional inputs at 6 and 18 decimals", () => {
		expect(parseAmount("100", 6)).toBe(100_000_000n)
		expect(parseAmount("1.5", 18)).toBe(1_500_000_000_000_000_000n)
		expect(parseAmount("0.000001", 6)).toBe(1n)
	})

	it("18-dec precision survives where Number() dies (>2^53 base units)", () => {
		expect(parseAmount("9007199254.740993", 18)).toBe(9_007_199_254_740_993_000_000_000_000n)
	})

	it("excess fractional digits TRUNCATE (never round up a spend)", () => {
		expect(parseAmount("1.9999999", 6)).toBe(1_999_999n)
	})

	it("junk, empty, and bare-dot inputs parse to 0n", () => {
		expect(parseAmount("abc", 6)).toBe(0n)
		expect(parseAmount("", 18)).toBe(0n)
		expect(parseAmount(".", 18)).toBe(0n)
		expect(parseAmount("1.2.3", 6)).toBe(0n)
		expect(parseAmount("-5", 6)).toBe(0n)
	})
})
