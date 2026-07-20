import { describe, expect, test, vi } from "vitest"
import { restoreRows } from "./restore-rows"

type Row = { id: number; name: string }

describe("restoreRows", () => {
	test("returns the row writeOne PERSISTED (not the input) on success", async () => {
		const rows: Row[] = [
			{ id: 1, name: "a" },
			{ id: 2, name: "b" },
		]
		const out = await restoreRows(rows, async (r) => r)
		expect(out).toEqual(rows)
		expect(out.every((r) => r.restoreError === undefined)).toBe(true)
	})

	test("reflects an id reassignment writeOne made (the reason it returns TOut, not void)", async () => {
		// Every restore that reallocates an id (collision avoidance / numeric cursor)
		// must return the WRITTEN id, not the input's. writeOne returns the persisted row.
		const out = await restoreRows([{ id: 1, name: "x" }], async (r) => ({ ...r, id: 99 }))
		expect(out[0].id).toBe(99)
		expect(out[0].restoreError).toBeUndefined()
	})

	test("a throwing writeOne records the error MESSAGE string on the INPUT row and CONTINUES", async () => {
		const rows: Row[] = [
			{ id: 1, name: "ok" },
			{ id: 2, name: "boom" },
			{ id: 3, name: "ok2" },
		]
		const out = await restoreRows(rows, async (r) => {
			if (r.name === "boom") throw new Error("disk full")
			return r
		})
		expect(out).toHaveLength(3)
		expect(out[0].restoreError).toBeUndefined()
		expect(out[1]).toEqual({ id: 2, name: "boom", restoreError: "disk full" }) // input row + error string
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
		const out = await restoreRows(rows, async (r) => r)
		expect(out.map((r) => r.id)).toEqual([1, 2, 3, 4])
	})

	test("empty input → empty output, writeOne never called", async () => {
		const writeOne = vi.fn(async (r: Row) => r)
		expect(await restoreRows([], writeOne)).toEqual([])
		expect(writeOne).not.toHaveBeenCalled()
	})
})
