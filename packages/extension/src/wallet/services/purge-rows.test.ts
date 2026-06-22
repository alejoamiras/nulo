import { describe, expect, test } from "vitest"
import { purgeRows } from "./purge-rows"

describe("purgeRows", () => {
	test("deletes each row THEN emits, in row order (the load-bearing delete-before-emit order)", async () => {
		const events: string[] = []
		await purgeRows(
			[{ id: "a" }, { id: "b" }],
			async (r) => {
				events.push(`del:${r.id}`)
			},
			(r) => events.push(`emit:${r.id}`),
		)
		expect(events).toEqual(["del:a", "emit:a", "del:b", "emit:b"])
	})

	test("stops on first rejected remove — never emits the failed row nor reaches later rows", async () => {
		// Pins the stop-on-first-rejection semantic the originals rely on: a
		// caller's post-loop step (cache drop / secondary delete) must NOT run
		// when a delete fails partway. The helper must not swallow or continue.
		const events: string[] = []
		await expect(
			purgeRows(
				[{ id: "a" }, { id: "b" }, { id: "c" }],
				async (r) => {
					if (r.id === "b") throw new Error("boom")
					events.push(`del:${r.id}`)
				},
				(r) => events.push(`emit:${r.id}`),
			),
		).rejects.toThrow("boom")
		expect(events).toEqual(["del:a", "emit:a"])
	})

	test("empty rows → no-op (no remove, no emit)", async () => {
		const events: string[] = []
		await purgeRows<{ id: string }>(
			[],
			async () => {
				events.push("del")
			},
			() => events.push("emit"),
		)
		expect(events).toEqual([])
	})
})
