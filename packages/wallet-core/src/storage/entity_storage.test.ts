import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { FakeBrowserApi } from "../testing/fake-browser-api"
import { EntityStorage } from "./entity_storage"

/** Drain the compare-and-delete's two async hops (re-read then conditional remove). */
const settle = () => new Promise((r) => setTimeout(r, 0))

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

		test("(B-23) an UNCHANGED malformed row is removed via compare-and-delete", async () => {
			await api.storage.local.set({ "users@bad": "{not valid json" })
			const removeSpy = vi.spyOn(api.storage.local, "remove")
			expect(await storage.get("bad")).toBeUndefined()
			expect(errorSpy).toHaveBeenCalledTimes(1)
			expect(errorSpy.mock.calls[0]?.[0]).toContain("users@bad")
			await settle()
			// Re-read saw the same unreadable bytes → delete-by-id (keeps the
			// incidental cleanup profile purges rely on).
			expect(removeSpy).toHaveBeenCalledWith("users@bad")
			expect(await storage.contains("bad")).toBe(false)
			removeSpy.mockRestore()
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

		test("(B-23) multiple UNCHANGED malformed rows are removed; valid rows untouched", async () => {
			await storage.set("alice", { name: "Alice", age: 30 })
			await api.storage.local.set({ "users@bad1": "{", "users@bad2": "]" })

			const values = await storage.getValues()
			expect(values).toEqual([{ name: "Alice", age: 30 }])
			expect(errorSpy).toHaveBeenCalledTimes(2)
			await settle()
			expect(await storage.contains("bad1")).toBe(false)
			expect(await storage.contains("bad2")).toBe(false)
			expect(await storage.contains("alice")).toBe(true) // valid row untouched
		})

		test("(B-23) compare-and-delete does NOT remove a row REPLACED with valid JSON before its re-read", async () => {
			await api.storage.local.set({ "users@a": "{malformed" })
			const removeSpy = vi.spyOn(api.storage.local, "remove")
			// The finding's race: a concurrent set() replaces the malformed row with
			// valid JSON between our decode snapshot and the delete. Model it by
			// having the compare-and-delete's RE-READ observe the valid replacement.
			let getCalls = 0
			const validJson = JSON.stringify({ name: "Anna", age: 1 })
			vi.spyOn(api.storage.local, "get").mockImplementation(async () => ({
				"users@a": ++getCalls === 1 ? "{malformed" : validJson,
			}))

			expect(await storage.get("a")).toBeUndefined() // stale malformed decode
			await settle()
			// The re-read saw valid JSON → the replacement is left intact (pre-fix the
			// blind delete destroyed it).
			expect(removeSpy).not.toHaveBeenCalled()
		})
	})

	/**
	 * Injected boundary codec: the deliberate split between JSON-SYNTAX failure
	 * (drop via B-23 compare-and-delete) and CODEC-VALIDATION failure (KEEP the
	 * row — never delete present-but-unreadable data). Guards the mega-deep trap
	 * where a stricter codec turns a valid-but-drifted row into permanent loss.
	 */
	describe("injected codec (validation split)", () => {
		let errorSpy: ReturnType<typeof vi.spyOn>
		const userParse = (raw: unknown): User => {
			if (
				typeof raw === "object" &&
				raw !== null &&
				typeof (raw as User).name === "string" &&
				typeof (raw as User).age === "number"
			) {
				return raw as User
			}
			throw new Error("invalid User shape")
		}

		beforeEach(() => {
			errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		})
		afterEach(() => errorSpy.mockRestore())

		test("a valid row passes the injected parse unchanged", async () => {
			const s = new EntityStorage<User>("users", api.storage.local, userParse)
			await s.set("alice", { name: "Alice", age: 30 })
			expect(await s.get("alice")).toEqual({ name: "Alice", age: 30 })
		})

		test("VALIDATION failure KEEPS the row (never deletes) + returns undefined + logs", async () => {
			const removeSpy = vi.spyOn(api.storage.local, "remove")
			const s = new EntityStorage<User>("users", api.storage.local, userParse)
			// Well-formed JSON, wrong shape (age missing) → validation fails, NOT a syntax error.
			await api.storage.local.set({ "users@drifted": JSON.stringify({ name: "NoAge" }) })
			expect(await s.get("drifted")).toBeUndefined()
			await Promise.resolve()
			// The row is KEPT — the opposite of the syntax-drop path — so a repair
			// path can still recover it. This is the silent-data-loss guard.
			expect(await s.contains("drifted")).toBe(true)
			expect(removeSpy).not.toHaveBeenCalled()
			expect(errorSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("failed validation"))).toBe(true)
			removeSpy.mockRestore()
		})

		test("getAll / getValues skip a validation-failing row WITHOUT deleting it", async () => {
			const removeSpy = vi.spyOn(api.storage.local, "remove")
			const s = new EntityStorage<User>("users", api.storage.local, userParse)
			await s.set("alice", { name: "Alice", age: 30 })
			await api.storage.local.set({ "users@drifted": JSON.stringify({ name: "NoAge" }) })
			expect((await s.getValues()).map((u) => u.name)).toEqual(["Alice"])
			expect((await s.getAll()).map(([id]) => id)).toEqual(["alice"])
			await Promise.resolve()
			expect(await s.contains("drifted")).toBe(true)
			expect(removeSpy).not.toHaveBeenCalled()
			removeSpy.mockRestore()
		})

		test("(B-23) JSON-SYNTAX failure removes an UNCHANGED row (compare-and-delete); validation failure KEEPS", async () => {
			const removeSpy = vi.spyOn(api.storage.local, "remove")
			const s = new EntityStorage<User>("users", api.storage.local, userParse)
			await api.storage.local.set({ "users@corrupt": "{not json" })
			expect(await s.get("corrupt")).toBeUndefined()
			await settle()
			// Syntax failure on an unchanged row IS dropped (unlike a validation failure).
			expect(removeSpy).toHaveBeenCalledWith("users@corrupt")
			expect(await s.contains("corrupt")).toBe(false)
			removeSpy.mockRestore()
		})

		test("write→read round-trip corpus: every shape the app writes survives the codec", async () => {
			const s = new EntityStorage<User>("users", api.storage.local, userParse)
			const corpus: Array<[string, User]> = [
				["min", { name: "", age: 0 }],
				["typical", { name: "Alice", age: 30 }],
				["big", { name: "x".repeat(1000), age: Number.MAX_SAFE_INTEGER }],
			]
			for (const [id, u] of corpus) await s.set(id, u)
			for (const [id, u] of corpus) expect(await s.get(id)).toEqual(u)
		})
	})
})
