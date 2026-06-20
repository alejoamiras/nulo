import { describe, expect, test } from "vitest"

import { baseErrorJson } from "./error-json"

describe("baseErrorJson", () => {
	test("projects name + message + stack from a plain Error", () => {
		const err = new Error("boom")
		const out = baseErrorJson(err)
		expect(out.name).toBe("Error")
		expect(out.message).toBe("boom")
		expect(typeof out.stack).toBe("string")
	})

	test("preserves a subclass name", () => {
		class MyError extends Error {
			override name = "MyError"
		}
		expect(baseErrorJson(new MyError("x")).name).toBe("MyError")
	})

	test("omits the stack key entirely when stack is undefined", () => {
		const err = new Error("no stack")
		err.stack = undefined
		const out = baseErrorJson(err)
		expect("stack" in out).toBe(false)
		expect(out).toEqual({ name: "Error", message: "no stack" })
	})

	test("does NOT carry code/details or any discriminant — callers layer those on", () => {
		const err = new Error("bare") as Error & { code?: string }
		err.code = "SOME_CODE"
		const out = baseErrorJson(err) as Record<string, unknown>
		expect(out.code).toBeUndefined()
		expect(out.__error).toBeUndefined()
	})

	test("empty message round-trips as an empty string", () => {
		expect(baseErrorJson(new Error("")).message).toBe("")
	})
})
