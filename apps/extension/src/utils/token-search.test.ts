import { describe, expect, test } from "vitest"
import { matchesQuery } from "./token-search"

const t = { symbol: "A+B", name: "Alpha Plus", contract: "0xAbCdEf0123" }

describe("matchesQuery", () => {
	test("empty or whitespace query matches everything", () => {
		expect(matchesQuery(t, "")).toBe(true)
		expect(matchesQuery(t, "   ")).toBe(true)
	})

	test("substring on symbol and name, case-insensitive, punctuation kept literal", () => {
		expect(matchesQuery(t, "a+b")).toBe(true)
		expect(matchesQuery(t, "PLUS")).toBe(true)
		expect(matchesQuery(t, "ha p")).toBe(true)
		expect(matchesQuery(t, "a.b")).toBe(false)
	})

	test("an address-shaped query matches the contract by prefix only", () => {
		expect(matchesQuery(t, "0xabcd")).toBe(true)
		expect(matchesQuery(t, "0XABCDEF01")).toBe(true)
		expect(matchesQuery(t, "abcd")).toBe(false)
		expect(matchesQuery(t, "0x0123")).toBe(false)
	})

	test("regex metacharacters are not interpreted", () => {
		expect(matchesQuery(t, ".*")).toBe(false)
		expect(matchesQuery(t, "[a")).toBe(false)
	})
})
