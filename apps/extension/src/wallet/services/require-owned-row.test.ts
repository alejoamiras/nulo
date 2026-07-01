import { describe, expect, test } from "vitest"
import { requireOwnedRow } from "./require-owned-row"

type Row = { profileId: string; value: string }

describe("requireOwnedRow", () => {
	test("returns the row when it belongs to the given profile", () => {
		const row: Row = { profileId: "p1", value: "x" }
		expect(requireOwnedRow(row, "p1")).toBe(row)
	})

	test("throws when the row is undefined (missing id)", () => {
		expect(() => requireOwnedRow(undefined, "p1")).toThrow("Invalid id")
	})

	test("throws when the row belongs to a DIFFERENT profile (fail-closed)", () => {
		expect(() => requireOwnedRow({ profileId: "p2", value: "x" }, "p1")).toThrow("Invalid id")
	})

	test("uses a custom message", () => {
		expect(() => requireOwnedRow(undefined, "p1", "unknown token id")).toThrow("unknown token id")
	})

	test("does not fall through: a mismatch NEVER returns the unowned row", () => {
		let result: Row | undefined
		try {
			result = requireOwnedRow({ profileId: "p2", value: "leak" }, "p1")
		} catch {
			result = undefined
		}
		expect(result).toBeUndefined()
	})
})
