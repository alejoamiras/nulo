import { describe, expect, test } from "vitest"

import { toRestoreError } from "./restore-error"

describe("toRestoreError", () => {
	test("an Error contributes its message", () => {
		expect(toRestoreError(new Error("boom"))).toBe("boom")
	})

	test("an Error subclass also contributes its message", () => {
		class MyError extends Error {}
		expect(toRestoreError(new MyError("subclass boom"))).toBe("subclass boom")
	})

	test("a string passes through unchanged", () => {
		expect(toRestoreError("plain string")).toBe("plain string")
	})

	test("non-Error values are stringified", () => {
		expect(toRestoreError(42)).toBe("42")
		expect(toRestoreError(null)).toBe("null")
		expect(toRestoreError(undefined)).toBe("undefined")
		expect(toRestoreError({ code: 1 })).toBe("[object Object]")
	})

	test("always returns a string (never the raw value)", () => {
		expect(typeof toRestoreError({ a: 1 })).toBe("string")
		expect(typeof toRestoreError(new Error("x"))).toBe("string")
	})
})
