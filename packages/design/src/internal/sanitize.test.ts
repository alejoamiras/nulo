import { describe, expect, test } from "vitest"
import { sanitizeString } from "./sanitize"

// Byte-identity pin for the internal copy. The allowed set is `\p{L}` (letters of any script) + digits
// + space + `-` `.` `_`. If this drifts from the extension's `utils/string.ts`, Input's `sanitize`
// behavior diverges across the two apps — keep it verbatim.
describe("sanitizeString (internal)", () => {
	test("falsy input → empty string", () => {
		expect(sanitizeString("")).toBe("")
	})

	test("keeps letters of any script + digits + space + - . _", () => {
		expect(sanitizeString("Hello World-1.2_3")).toBe("Hello World-1.2_3")
		expect(sanitizeString("Ünïcödé café Ωμέγα 日本語")).toBe("Ünïcödé café Ωμέγα 日本語")
	})

	test("strips HTML-significant + symbol chars (allowed set excludes them)", () => {
		expect(sanitizeString("<script>alert(1)</script>")).toBe("scriptalert1script")
		expect(sanitizeString("a\"b'c&d/e")).toBe("abcde")
	})

	test("strips emoji + zero-width / RTL-override marks", () => {
		expect(sanitizeString("hi😀​there‮")).toBe("hithere")
	})

	test("length cap slices when exceeded; default (0) does not cap", () => {
		expect(sanitizeString("abcdef", 3)).toBe("abc")
		expect(sanitizeString("abcdef")).toBe("abcdef")
		expect(sanitizeString("abcdef", 0)).toBe("abcdef")
	})

	test("the cap applies AFTER stripping", () => {
		expect(sanitizeString("a<b>", 3)).toBe("ab")
	})
})
