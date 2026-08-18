/**
 * Unit pins for `purgeMalformedRows` (F-B23): the raw second pass a lifecycle
 * purge runs after its codec-visible pass, deleting validation-failed rows the
 * codec keeps-but-hides. Branch coverage lives here; each service's purge pins
 * the end-to-end wiring separately.
 */

import { describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EntityStorage } from "@nulo/wallet-core/storage"
import { z } from "zod"
import { purgeMalformedRows } from "./purge-rows"

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
