/**
 * Tests for the strict contacts-export parser.
 *
 * The parser is the boundary between the on-disk JSON and the popup's
 * import flow. Strictness here keeps malformed/future files from
 * silently dropping data downstream.
 */

import { describe, expect, test } from "vitest"
import { parseContactsExport } from "./contacts-export-format"

describe("parseContactsExport", () => {
	test("flat array is accepted as v1", () => {
		const raw = JSON.stringify([
			{ name: "Alice", address: "0x1" },
			{ name: "Bob", address: "0x2" },
		])
		const result = parseContactsExport(raw)
		expect(result.version).toBe(1)
		expect(result.contacts).toHaveLength(2)
		expect(result.contacts[0].name).toBe("Alice")
	})

	test("v2 envelope is accepted", () => {
		const raw = JSON.stringify({
			version: 2,
			contacts: [{ name: "Alice", address: "0x1", isSender: true }],
		})
		const result = parseContactsExport(raw)
		expect(result.version).toBe(2)
		expect(result.contacts).toHaveLength(1)
		expect(result.contacts[0].isSender).toBe(true)
	})

	test("v2 envelope with empty contacts array is accepted", () => {
		const result = parseContactsExport(JSON.stringify({ version: 2, contacts: [] }))
		expect(result.version).toBe(2)
		expect(result.contacts).toEqual([])
	})

	test("rejects unknown version number", () => {
		const raw = JSON.stringify({ version: 99, contacts: [] })
		expect(() => parseContactsExport(raw)).toThrow()
	})

	test("rejects string version", () => {
		const raw = JSON.stringify({ version: "abc", contacts: [] })
		expect(() => parseContactsExport(raw)).toThrow()
	})

	test("rejects v2 with non-array contacts", () => {
		const raw = JSON.stringify({ version: 2, contacts: null })
		expect(() => parseContactsExport(raw)).toThrow()
	})

	test("rejects v2 with missing contacts field", () => {
		const raw = JSON.stringify({ version: 2 })
		expect(() => parseContactsExport(raw)).toThrow()
	})

	test("rejects empty object", () => {
		expect(() => parseContactsExport("{}")).toThrow()
	})

	test("rejects null", () => {
		expect(() => parseContactsExport("null")).toThrow()
	})

	test("rejects primitive string", () => {
		expect(() => parseContactsExport(JSON.stringify("hello"))).toThrow()
	})

	test("rejects primitive number", () => {
		expect(() => parseContactsExport(JSON.stringify(42))).toThrow()
	})

	test("propagates JSON.parse SyntaxError on invalid JSON", () => {
		expect(() => parseContactsExport("not json")).toThrow(SyntaxError)
	})

	test("v2 contacts entries are passed through without sanitization", () => {
		// Caller sanitizes after parse; the parser preserves whitespace.
		const raw = JSON.stringify({
			version: 2,
			contacts: [{ name: "  Alice  ", address: "0xMaybeBad" }],
		})
		const result = parseContactsExport(raw)
		expect(result.contacts[0].name).toBe("  Alice  ")
		expect(result.contacts[0].address).toBe("0xMaybeBad")
	})
})
