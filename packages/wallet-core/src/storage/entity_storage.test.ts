import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { FakeBrowserApi } from "../testing/fake-browser-api"
import { EntityStorage } from "./entity_storage"

/**
 * Contract tests for `EntityStorage`.
 *
 * The constructor accepts only a concrete `StorageArea` — no legacy enum
 * branch. These tests lock the wire-shape so behavior stays byte-identical
 * across refactors.
 *
 * Uses `FakeBrowserApi.api.storage.local`, NOT raw `@webext-core/fake-browser`:
 * the adapter normalizes `{ key: undefined }` → `{}` to match real
 * `chrome.storage`. Without that normalization, `contains(id)` returns true
 * for missing keys and breaks "pick-a-free-id" loops.
 */

type User = { name: string; age: number }

describe("EntityStorage", () => {
	let api: FakeBrowserApi
	let storage: EntityStorage<User>

	beforeEach(() => {
		api = new FakeBrowserApi()
		api.reset()
		storage = new EntityStorage<User>("users", api.storage.local)
	})

	test("set/get round-trip preserves the entity", async () => {
		await storage.set("alice", { name: "Alice", age: 30 })
		expect(await storage.get("alice")).toEqual({ name: "Alice", age: 30 })
	})

	test("get of missing id returns undefined (not null, not {})", async () => {
		expect(await storage.get("nobody")).toBeUndefined()
	})

	test("contains: true after set, false for missing, false after delete", async () => {
		await storage.set("a", { name: "A", age: 1 })
		expect(await storage.contains("a")).toBe(true)
		expect(await storage.contains("b")).toBe(false)
		await storage.delete("a")
		expect(await storage.contains("a")).toBe(false)
	})

	test("getAll returns all [id, entity] pairs scoped to root", async () => {
		await storage.set("a", { name: "A", age: 1 })
		await storage.set("b", { name: "B", age: 2 })
		const all = await storage.getAll()
		expect(all.sort()).toEqual([
			["a", { name: "A", age: 1 }],
			["b", { name: "B", age: 2 }],
		])
	})

	test("getKeys strips the `root@` prefix", async () => {
		await storage.set("alice", { name: "Alice", age: 30 })
		await storage.set("bob", { name: "Bob", age: 25 })
		const keys = await storage.getKeys()
		expect(keys.sort()).toEqual(["alice", "bob"])
	})

	test("getValues returns only the entities (no keys)", async () => {
		await storage.set("a", { name: "A", age: 1 })
		await storage.set("b", { name: "B", age: 2 })
		const values = await storage.getValues()
		expect(values.sort((x, y) => x.name.localeCompare(y.name))).toEqual([
			{ name: "A", age: 1 },
			{ name: "B", age: 2 },
		])
	})

	test("different roots do not leak across namespaces", async () => {
		const other = new EntityStorage<{ x: number }>("other", api.storage.local)
		await storage.set("alice", { name: "Alice", age: 30 })
		await other.set("alice", { x: 99 })
		expect(await storage.get("alice")).toEqual({ name: "Alice", age: 30 })
		expect(await other.get("alice")).toEqual({ x: 99 })
		expect((await storage.getAll()).length).toBe(1)
		expect((await other.getAll()).length).toBe(1)
	})

	test("findByPredicate returns matching entities with their keys", async () => {
		await storage.set("a", { name: "A", age: 30 })
		await storage.set("b", { name: "B", age: 25 })
		await storage.set("c", { name: "C", age: 40 })
		const adults = await storage.findByPredicate((u) => u.age >= 30)
		expect(adults.map((r) => r.key).sort()).toEqual(["a", "c"])
		expect(adults.find((r) => r.key === "a")?.entity).toEqual({ name: "A", age: 30 })
	})

	test("getVersion returns 0 when unset; setVersion round-trips", async () => {
		expect(await storage.getVersion()).toBe(0)
		await storage.setVersion(5)
		expect(await storage.getVersion()).toBe(5)
	})

	test("version is isolated from entity keys (same root, different sub-path)", async () => {
		await storage.setVersion(7)
		await storage.set("alice", { name: "Alice", age: 30 })
		// getAll should not return the version as an entity
		const all = await storage.getAll()
		expect(all.length).toBe(1)
		expect(all[0][0]).toBe("alice")
	})

	/**
	 * Resilience: a single malformed row used to throw from `JSON.parse` inside
	 * `get`/`getAll`/`getValues`, poisoning every reader of the namespace. The
	 * primitive now logs the bad payload, deletes the row, and skips it.
	 */
	describe("malformed row resilience", () => {
		let errorSpy: ReturnType<typeof vi.spyOn>

		beforeEach(() => {
			errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		})

		afterEach(() => {
			errorSpy.mockRestore()
		})

		test("get of malformed row returns undefined, schedules row delete, logs an error", async () => {
			await api.storage.local.set({ "users@bad": "{not valid json" })
			expect(await storage.get("bad")).toBeUndefined()
			expect(errorSpy).toHaveBeenCalledTimes(1)
			expect(errorSpy.mock.calls[0]?.[0]).toContain("users@bad")
			// Delete is fire-and-forget; allow the microtask to flush.
			await Promise.resolve()
			expect(await storage.contains("bad")).toBe(false)
		})

		test("getAll skips malformed rows and returns the valid ones", async () => {
			await storage.set("alice", { name: "Alice", age: 30 })
			await api.storage.local.set({ "users@bob": "not json" })
			await storage.set("carol", { name: "Carol", age: 40 })

			const all = await storage.getAll()
			const ids = all.map(([id]) => id).sort()
			expect(ids).toEqual(["alice", "carol"])
			expect(errorSpy).toHaveBeenCalledTimes(1)
		})

		test("getValues skips malformed rows and returns the valid ones", async () => {
			await storage.set("alice", { name: "Alice", age: 30 })
			await api.storage.local.set({ "users@bob": "garbage" })
			await storage.set("carol", { name: "Carol", age: 40 })

			const values = await storage.getValues()
			const names = values.map((u) => u.name).sort()
			expect(names).toEqual(["Alice", "Carol"])
			expect(errorSpy).toHaveBeenCalledTimes(1)
		})

		test("multiple malformed rows are all deleted; valid rows untouched", async () => {
			await storage.set("alice", { name: "Alice", age: 30 })
			await api.storage.local.set({ "users@bad1": "{", "users@bad2": "]" })

			const values = await storage.getValues()
			expect(values).toEqual([{ name: "Alice", age: 30 }])
			expect(errorSpy).toHaveBeenCalledTimes(2)
			await Promise.resolve()
			expect(await storage.contains("bad1")).toBe(false)
			expect(await storage.contains("bad2")).toBe(false)
		})
	})
})
