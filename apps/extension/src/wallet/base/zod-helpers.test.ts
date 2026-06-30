import { describe, expect, test } from "vitest"
import { z } from "zod"
import { ValidationError } from "@nulo/extension-messaging/errors"
import { validateParams, validateResult } from "@nulo/extension-messaging/zod"

describe("validateParams", () => {
	const schema = z.tuple([z.string().min(1), z.number().int().nonnegative()])

	test("returns the parsed tuple on success", () => {
		const out = validateParams(schema, ["hello", 42], "testMethod")
		expect(out).toEqual(["hello", 42])
	})

	test("throws ValidationError on malformed input", () => {
		expect(() => validateParams(schema, ["", 42], "testMethod")).toThrow(ValidationError)
	})

	test("ValidationError message includes the method name", () => {
		try {
			validateParams(schema, ["", 42], "addNetwork")
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError)
			expect((err as Error).message).toContain("addNetwork")
		}
	})

	test("ValidationError details carries the method + issue list", () => {
		try {
			validateParams(schema, [""], "addNetwork")
		} catch (err) {
			const details = (err as ValidationError).details as { method: string; issues: unknown[] }
			expect(details.method).toBe("addNetwork")
			expect(Array.isArray(details.issues)).toBe(true)
			expect(details.issues.length).toBeGreaterThan(0)
		}
	})

	test("multiple issues surface in the message", () => {
		try {
			validateParams(schema, ["", -1], "x")
		} catch (err) {
			const msg = (err as Error).message
			// Two issues expected: path "0" and path "1".
			expect(msg).toContain("0")
			expect(msg).toContain("1")
		}
	})

	test("empty tuple schema + empty input passes", () => {
		const emptySchema = z.tuple([])
		expect(() => validateParams(emptySchema, [], "noArgs")).not.toThrow()
	})
})

describe("validateResult", () => {
	const schema = z.object({ id: z.string(), count: z.number().int() })

	test("returns the parsed value on success", () => {
		const out = validateResult(schema, { id: "a", count: 1 }, "m")
		expect(out).toEqual({ id: "a", count: 1 })
	})

	test("throws ValidationError when the response shape is wrong", () => {
		expect(() => validateResult(schema, { id: "a", count: "nope" }, "m")).toThrow(ValidationError)
	})

	test("message cites the method for cross-commit debuggability", () => {
		try {
			validateResult(schema, null, "getNetwork")
		} catch (err) {
			expect((err as Error).message).toContain("getNetwork")
		}
	})

	test("ValidationError is both an Error and a WalletError subclass", async () => {
		// Import asynchronously so we don't couple this file to the error hierarchy.
		const { WalletError } = await import("@nulo/extension-messaging/errors")
		try {
			validateResult(schema, "not an object", "m")
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError)
			expect(err).toBeInstanceOf(WalletError)
			expect(err).toBeInstanceOf(Error)
		}
	})
})
