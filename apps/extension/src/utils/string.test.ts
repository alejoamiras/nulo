import { describe, expect, test } from "vitest"
import { getInitials, trimAddress } from "./string"

describe("trimAddress", () => {
	const ADDR = "0x1234567890abcdef1234567890abcdef12345678"

	test("default policy: 8 head chars, 4 tail chars, '..' separator", () => {
		expect(trimAddress(ADDR)).toBe("0x123456..5678")
	})

	test("site policy 6/4 with '...' (the popup sites' dominant style)", () => {
		expect(trimAddress(ADDR, 6, 4, "...")).toBe("0x1234...5678")
	})

	test("site policy 6/4 with unicode ellipsis (journal/verify style)", () => {
		expect(trimAddress(ADDR, 6, 4, "…")).toBe("0x1234…5678")
	})

	test("short input is returned unchanged (no separator injected)", () => {
		expect(trimAddress("0xabc", 6, 4, "...")).toBe("0xabc")
		expect(trimAddress("", 6, 4)).toBe("")
	})

	test("boundary: length exactly start+end stays untouched", () => {
		expect(trimAddress("0123456789", 6, 4)).toBe("0123456789")
	})
})

describe("getInitials", () => {
	test("two words → first letter of each, uppercased", () => {
		expect(getInitials("Alejo Savings")).toBe("AS")
	})

	test("single word → first two chars, uppercased", () => {
		expect(getInitials("vault")).toBe("VA")
	})

	test("single short word → the one char it has", () => {
		expect(getInitials("x")).toBe("X")
	})

	test("three+ words → only the first two", () => {
		expect(getInitials("my cold wallet")).toBe("MC")
	})

	test("collapses extra whitespace between words", () => {
		expect(getInitials("John   Doe")).toBe("JD")
	})

	test("trims leading/trailing whitespace", () => {
		expect(getInitials("  solo  ")).toBe("SO")
	})

	test("empty string → empty (matches the legacy abbr contract for empty names)", () => {
		expect(getInitials("")).toBe("")
	})

	test("whitespace-only → empty", () => {
		expect(getInitials("   ")).toBe("")
	})
})
