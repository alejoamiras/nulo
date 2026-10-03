import { describe, expect, test } from "vitest"
import { isObjectLike, isRecord } from "./guards"

class Box {
	value = 1
}

describe("isRecord and isObjectLike", () => {
	test.each<[string, unknown, boolean, boolean]>([
		["a plain object", { a: 1 }, true, true],
		["an empty object", {}, true, true],
		["a null-prototype object", Object.create(null), true, true],
		["a class instance", new Box(), true, true],
		["a boxed number", Object(1), true, true],
		["a boxed string", new String(""), true, true],
		["a date", new Date(0), true, true],
		["an empty array", [], false, true],
		["an array carrying fields", Object.assign([], { type: "accounts" }), false, true],
		["null", null, false, false],
		["undefined", undefined, false, false],
		["a function", () => ({}), false, false],
		["a number", 1, false, false],
		["a string", "{}", false, false],
		["a boolean", true, false, false],
		["a bigint", 1n, false, false],
		["a symbol", Symbol("x"), false, false],
	])("%s: isRecord %s, isObjectLike %s", (_label, value, record, objectLike) => {
		expect(isRecord(value)).toBe(record)
		expect(isObjectLike(value)).toBe(objectLike)
	})
})
