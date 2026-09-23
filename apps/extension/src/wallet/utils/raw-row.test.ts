import { describe, expect, test } from "vitest"
import { z } from "zod"
import { decodeRow } from "./raw-row"

const schema = z.object({ id: z.string() })

describe("decodeRow", () => {
	test("absent, valid, corrupt", () => {
		expect(decodeRow(schema, undefined)).toEqual({ kind: "absent" })
		expect(decodeRow(schema, JSON.stringify({ id: "a" }))).toEqual({ kind: "valid", value: { id: "a" } })
		expect(decodeRow(schema, "{not json")).toEqual({ kind: "corrupt" })
		expect(decodeRow(schema, JSON.stringify({ id: 1 }))).toEqual({ kind: "corrupt" })
		expect(decodeRow(schema, 42)).toEqual({ kind: "corrupt" })
	})
})
