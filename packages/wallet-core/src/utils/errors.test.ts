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

describe("getErrorMessage (lenient wire/popup variant) — PRESERVED VERBATIM", () => {
	// getErrorMessage is the dApp-wire / log projection. Its EXACT pre-Q07 output —
	// including the raw non-string passthrough type-lie — is observable at
	// NON-coercing sinks (the wire JSON in core/error-response.ts; LoggerStore).
	// These pins lock that behavior so a future refactor can't silently change
	// wire/log bytes (routing it through errorMessageFromUnknown WOULD).
	test("Error / string / nullish (realistic inputs)", () => {
		expect(getErrorMessage(new Error("e"))).toBe("e")
		expect(getErrorMessage(new Error(""))).toBe("")
		expect(getErrorMessage("s")).toBe("s")
		expect(getErrorMessage(null)).toBe("Unknown error")
		expect(getErrorMessage(undefined)).toBe("Unknown error")
	})

	test("duck-types a string .message off a non-Error object (JSON-RPC / PXE throws)", () => {
		expect(getErrorMessage({ message: "x" })).toBe("x")
		expect(getErrorMessage({ code: 4001, message: "User rejected" })).toBe("User rejected")
	})

	test("(BUG-PIN) raw non-string value passes through UN-coerced — the preserved type-lie", () => {
		// `(error as Error)?.message ?? (error as string) ?? "Unknown error"` returns
		// the RAW value (number/object), not a string, for these. The wire JSON +
		// LoggerStore see that raw value; coercing it would change observable bytes.
		// Tracked for Q-01 (boundary decode); `as unknown` reflects the type-lie.
		expect(getErrorMessage(42) as unknown).toBe(42)
		expect(getErrorMessage({ message: 0 }) as unknown).toBe(0)
		expect(getErrorMessage({ nope: 1 }) as unknown).toEqual({ nope: 1 })
		expect(getErrorMessage({ message: null }) as unknown).toEqual({ message: null })
	})
})
