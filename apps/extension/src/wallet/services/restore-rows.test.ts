import { describe, expect, test, vi } from "vitest"
import { restoreRows } from "./restore-rows"

type Row = { id: number; name: string }

describe("restoreRows", () => {
	test("returns each successfully-written row as-is (no restoreError)", async () => {
		const written: Row[] = []
		const rows: Row[] = [
			{ id: 1, name: "a" },
			{ id: 2, name: "b" },
		]
		const out = await restoreRows(rows, async (r) => {
			written.push(r)
		})
		expect(written).toEqual(rows)
		expect(out).toEqual(rows)
		expect(out.every((r) => r.restoreError === undefined)).toBe(true)
	})

	test("a throwing writeOne records the error MESSAGE string on that row and CONTINUES", async () => {
		const rows: Row[] = [
			{ id: 1, name: "ok" },
			{ id: 2, name: "boom" },
			{ id: 3, name: "ok2" },
		]
		const out = await restoreRows(rows, async (r) => {
			if (r.name === "boom") throw new Error("disk full")
		})
		expect(out).toHaveLength(3)
		expect(out[0].restoreError).toBeUndefined()
		expect(out[1].restoreError).toBe("disk full")
		expect(typeof out[1].restoreError).toBe("string")
		expect(out[2].restoreError).toBeUndefined() // loop did NOT abort on the failure
	})

	test("stringifies a non-Error throw", async () => {
		const out = await restoreRows([{ id: 1, name: "x" }], async () => {
			throw "raw string failure"
		})
		expect(out[0].restoreError).toBe("raw string failure")
	})

	test("preserves order", async () => {
		const rows = [1, 2, 3, 4].map((id) => ({ id, name: `n${id}` }))
		const out = await restoreRows(rows, async () => {})
		expect(out.map((r) => r.id)).toEqual([1, 2, 3, 4])
	})

	test("empty input → empty output, writeOne never called", async () => {
		const writeOne = vi.fn()
		expect(await restoreRows([], writeOne)).toEqual([])
		expect(writeOne).not.toHaveBeenCalled()
	})

	test("reflects an in-place id reassignment made by writeOne (success path returns the row)", async () => {
		const row = { id: 1, name: "x" }
		const out = await restoreRows([row], async (r) => {
			r.id = 99 // writeOne owns id allocation (e.g. collision avoidance)
		})
		expect(out[0].id).toBe(99)
	})
})
