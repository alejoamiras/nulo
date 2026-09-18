import { expect, test } from "vitest"
import { hasPlaceholders, parseDocumentHeader, parseVersionHistory } from "./document"

const doc = (effective: string) =>
	`# T\n\n**Version 1.2 — effective ${effective}**\n\nBody.\n\n## Version history\n\n| Version | Effective | Change |\n|---|---|---|\n| 1.2 | x | b |\n| 1.0 | y | a |\n`

test("reads the version and a real effective date", () => {
	expect(parseDocumentHeader(doc("3 June 2027"))).toEqual({ version: "1.2", effective: "3 June 2027" })
})

test("a placeholder effective date is null", () => {
	expect(parseDocumentHeader(doc("«FILL: effective date»")).effective).toBeNull()
	expect(hasPlaceholders(doc("«FILL: effective date»"))).toBe(true)
	expect(hasPlaceholders(doc("3 June 2027"))).toBe(false)
})

test("a document without the version line is an error, not a default", () => {
	expect(() => parseDocumentHeader("# T\n\nBody.")).toThrow(/Version X/)
})

test("reads the history table in order and ignores its header rows", () => {
	expect(parseVersionHistory(doc("x"))).toEqual(["1.2", "1.0"])
	expect(parseVersionHistory("# no table")).toEqual([])
})
