import { describe, expect, test } from "vitest"
import { coerceAmount } from "./coerce-amount"

describe("execution/coerceAmount — SW boundary defense", () => {
	test("accepts a clean bigint", () => {
		expect(coerceAmount(123n)).toBe(123n)
	})

	test("accepts 0n", () => {
		expect(coerceAmount(0n)).toBe(0n)
	})

	test("rejects negative bigint", () => {
		expect(() => coerceAmount(-1n)).toThrow(/non-negative/)
	})

	test("accepts integer string (the JSON-transport happy path — bigint becomes string)", () => {
		expect(coerceAmount("123")).toBe(123n)
	})

	test("accepts '0' string", () => {
		expect(coerceAmount("0")).toBe(0n)
	})

	test("rejects fractional string (the bug from the QA report)", () => {
		expect(() => coerceAmount("14023437.5")).toThrow(/non-integer string/)
	})

	test("rejects negative string", () => {
		expect(() => coerceAmount("-1")).toThrow(/non-integer string/)
	})

	test("rejects scientific notation string", () => {
		expect(() => coerceAmount("1e5")).toThrow(/non-integer string/)
	})

	test("rejects hex string", () => {
		expect(() => coerceAmount("0x1")).toThrow(/non-integer string/)
	})

	test("rejects empty string", () => {
		expect(() => coerceAmount("")).toThrow(/non-integer string/)
	})

	test("accepts integer number", () => {
		expect(coerceAmount(123)).toBe(123n)
	})

	test("accepts 0 number", () => {
		expect(coerceAmount(0)).toBe(0n)
	})

	test("rejects fractional number", () => {
		expect(() => coerceAmount(14023437.5)).toThrow(/fractional/)
	})

	test("rejects negative number", () => {
		expect(() => coerceAmount(-1)).toThrow(/fractional/)
	})

	test("rejects NaN", () => {
		expect(() => coerceAmount(Number.NaN)).toThrow(/fractional/)
	})

	test("rejects Infinity", () => {
		expect(() => coerceAmount(Number.POSITIVE_INFINITY)).toThrow(/fractional/)
	})

	test("rejects null", () => {
		expect(() => coerceAmount(null)).toThrow(/unrecognized type/)
	})

	test("rejects undefined", () => {
		expect(() => coerceAmount(undefined)).toThrow(/unrecognized type/)
	})

	test("rejects object", () => {
		expect(() => coerceAmount({})).toThrow(/unrecognized type/)
	})

	test("rejects boolean", () => {
		expect(() => coerceAmount(true)).toThrow(/unrecognized type/)
	})
})
