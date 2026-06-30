import { describe, expect, expectTypeOf, test } from "vitest"

import { errorMessageFromUnknown, getErrorMessage } from "./errors"

describe("errorMessageFromUnknown (canonical, = former jobs/error.extractMessage)", () => {
	test("parity table — always returns a real string", () => {
		expect(errorMessageFromUnknown(new Error("boom"))).toBe("boom")
		expect(errorMessageFromUnknown(new Error(""))).toBe("")
		expect(errorMessageFromUnknown("s")).toBe("s")
		expect(errorMessageFromUnknown("")).toBe("")
		expect(errorMessageFromUnknown(null)).toBe("null")
		expect(errorMessageFromUnknown(undefined)).toBe("undefined")
		expect(errorMessageFromUnknown(42)).toBe("42")
		expect(errorMessageFromUnknown({})).toBe("[object Object]")
		expect(errorMessageFromUnknown({ message: "x" })).toBe("[object Object]") // NO duck-typing here
	})

	test("return type is string", () => {
		expectTypeOf(errorMessageFromUnknown(undefined as unknown)).toEqualTypeOf<string>()
	})
})

describe("getErrorMessage (lenient wire/popup variant) — REGRESSION PINS", () => {
	// These pins lock the quirks that distinguish getErrorMessage from
	// errorMessageFromUnknown. Collapsing the two would change the dApp-visible
	// wire string (core/error-response.ts) and popup error text — do NOT do it.
	test("nullish → 'Unknown error' (NOT 'null'/'undefined')", () => {
		expect(getErrorMessage(null)).toBe("Unknown error")
		expect(getErrorMessage(undefined)).toBe("Unknown error")
	})

	test("duck-types .message off a non-Error object (JSON-RPC / PXE plain throws)", () => {
		expect(getErrorMessage({ message: "x" })).toBe("x")
		expect(getErrorMessage({ code: 4001, message: "User rejected" })).toBe("User rejected")
	})

	test("object without a usable .message → '[object Object]'", () => {
		expect(getErrorMessage({ nope: 1 })).toBe("[object Object]")
		expect(getErrorMessage({ message: null })).toBe("[object Object]")
	})

	test("Error / string pass through like the core", () => {
		expect(getErrorMessage(new Error("e"))).toBe("e")
		expect(getErrorMessage("s")).toBe("s")
		expect(getErrorMessage(42)).toBe("42")
	})

	test("(BUG-PIN) non-string .message is string-coerced, not leaked", () => {
		// Pre-Q07 `(error as string)` could return a raw non-string (e.g. the
		// number 0 onto a string-typed wire field). The wrapper now coerces, so
		// the value is observably identical at every sink AND genuinely a string.
		expect(getErrorMessage({ message: 0 })).toBe("0")
		expectTypeOf(getErrorMessage({ message: 0 })).toEqualTypeOf<string>()
	})
})
