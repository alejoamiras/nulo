import { describe, expect, test } from "vitest"
import { getInitials } from "./string"

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
