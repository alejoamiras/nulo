/**
 * Pins for the shared purge helpers: `purgeRows` (typed pass — delete-then-emit
 * order, stop-on-first-rejection) and `purgeMalformedRows` (F-B23 raw second
 * pass — branch coverage incl. the compare-and-delete guard). End-to-end
 * adoption wiring is pinned per service where the arc demands it (contact,
 * account, token), not for every site.
 */

import { EntityStorage } from "@nulo/wallet-core/storage"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { describe, expect, test } from "vitest"
import { z } from "zod"
import { purgeMalformedRows, purgeRows } from "./purge-rows"

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

const RowSchema = z.object({ id: z.string(), profileId: z.string(), name: z.string() })
type Row = z.infer<typeof RowSchema>

const makeStore = () => {
	const api = new FakeBrowserApi()
	api.reset()
	const storage = new EntityStorage<Row>("t:rows", api.storage.local, (raw) => RowSchema.parse(raw))
	return { api, storage }
}

describe("purgeMalformedRows (F-B23)", () => {
	test("deletes a validation-failed row matching the predicate; counts it", async () => {
		const { api, storage } = makeStore()
		await api.storage.local.set({ "t:rows@bad": JSON.stringify({ profileId: "p1", junk: 1 }) })
		const purged = await purgeMalformedRows(storage, (raw) => raw.profileId === "p1")
		expect(purged).toBe(1)
		expect((await api.storage.local.get("t:rows@bad"))["t:rows@bad"]).toBeUndefined()
	})

	test("leaves a malformed row whose predicate does NOT match (another profile)", async () => {
		const { api, storage } = makeStore()
		await api.storage.local.set({ "t:rows@bad": JSON.stringify({ profileId: "p2", junk: 1 }) })
		expect(await purgeMalformedRows(storage, (raw) => raw.profileId === "p1")).toBe(0)
		expect((await api.storage.local.get("t:rows@bad"))["t:rows@bad"]).toBeDefined()
	})

	test("leaves a JSON-syntax-broken row (unattributable — fail-closed)", async () => {
		const { api, storage } = makeStore()
		await api.storage.local.set({ "t:rows@syntax": "{not json" })
		expect(await purgeMalformedRows(storage, () => true)).toBe(0)
		expect((await api.storage.local.get("t:rows@syntax"))["t:rows@syntax"]).toBe("{not json")
	})

	test("leaves non-object raw values (no predicate surface)", async () => {
		const { api, storage } = makeStore()
		await api.storage.local.set({ "t:rows@num": JSON.stringify(42) })
		expect(await purgeMalformedRows(storage, () => true)).toBe(0)
		expect((await api.storage.local.get("t:rows@num"))["t:rows@num"]).toBeDefined()
	})

	test("CAS: a concurrent legitimate write landing between snapshot and delete is NEVER destroyed", async () => {
		// The aliased-key hazard (codex audit): profile A's malformed bytes sit
		// under a key a concurrent restore for profile B legitimately reuses. The
		// purge decided on the OLD bytes; by delete time the key holds B's fresh
		// valid row. The compare-and-delete must refuse.
		const { api, storage } = makeStore()
		await api.storage.local.set({ "t:rows@aliased": JSON.stringify({ profileId: "p1", junk: 1 }) })
		const staleSnapshot = await storage.rawStringEntries()
		await storage.set("aliased", { id: "aliased", profileId: "p2", name: "fresh" })
		const purged = await purgeMalformedRows(
			{
				rawStringEntries: async () => staleSnapshot,
				rawValue: (id) => storage.rawValue(id),
				delete: (id) => storage.delete(id),
			},
			(raw) => raw.profileId === "p1",
		)
		expect(purged).toBe(0)
		expect(await storage.get("aliased")).toEqual({ id: "aliased", profileId: "p2", name: "fresh" })
	})

	test("run AFTER a typed purge, it removes exactly the codec-invisible leftovers (valid rows already gone)", async () => {
		const { api, storage } = makeStore()
		await storage.set("good", { id: "good", profileId: "p1", name: "A" })
		await api.storage.local.set({ "t:rows@bad": JSON.stringify({ profileId: "p1" }) })
		// typed pass
		for (const row of (await storage.getValues()).filter((r) => r.profileId === "p1")) {
			await storage.delete(row.id)
		}
		// raw pass
		const seen: string[] = []
		expect(
			await purgeMalformedRows(
				storage,
				(raw) => raw.profileId === "p1",
				(id) => seen.push(id),
			),
		).toBe(1)
		expect(seen).toEqual(["bad"])
		expect(Object.keys(await api.storage.local.get(null)).filter((k) => k.startsWith("t:rows@"))).toEqual([])
	})
})
