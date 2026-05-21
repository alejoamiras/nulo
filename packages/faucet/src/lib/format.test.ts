import { describe, expect, it } from "vitest"
import { formatBigInt, trimAddress } from "./format"

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
		expect(trimAddress("")).toBe("—")
	})

	it("returns the original when shorter than head+tail+2", () => {
		expect(trimAddress("0x123")).toBe("0x123")
	})
})
