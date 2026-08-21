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

	/**
	 * Resilience: a single malformed row used to throw from `JSON.parse` inside
	 * `get`/`getAll`/`getValues`, poisoning every reader of the namespace. The
	 * primitive now logs the bad payload, RETAINS the row (B-23 — the read path
	 * never deletes), and skips it.
	 */
	describe("malformed row resilience", () => {
		let errorSpy: ReturnType<typeof vi.spyOn>

		beforeEach(() => {
			errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		})

		afterEach(() => {
			errorSpy.mockRestore()
		})

		test("(B-23) get of a malformed row returns undefined and RETAINS it (no read-path delete)", async () => {
			await api.storage.local.set({ "users@bad": "{not valid json" })
			const removeSpy = vi.spyOn(api.storage.local, "remove")
			expect(await storage.get("bad")).toBeUndefined()
			expect(errorSpy).toHaveBeenCalledTimes(1)
			expect(errorSpy.mock.calls[0]?.[0]).toContain("users@bad")
			await Promise.resolve()
			// The read path must NEVER delete-by-id — it would race a concurrent valid
			// write. The malformed row is retained for a serialized repair path.
			expect(removeSpy).not.toHaveBeenCalled()
			expect(await storage.contains("bad")).toBe(true)
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

		test("(B-23) multiple malformed rows are RETAINED (not deleted); valid rows untouched", async () => {
			await storage.set("alice", { name: "Alice", age: 30 })
			await api.storage.local.set({ "users@bad1": "{", "users@bad2": "]" })
			const removeSpy = vi.spyOn(api.storage.local, "remove")

			const values = await storage.getValues()
			expect(values).toEqual([{ name: "Alice", age: 30 }])
			expect(errorSpy).toHaveBeenCalledTimes(2)
			await Promise.resolve()
			expect(removeSpy).not.toHaveBeenCalled()
			expect(await storage.contains("bad1")).toBe(true)
			expect(await storage.contains("bad2")).toBe(true)
			removeSpy.mockRestore()
		})

		test("(B-23) a valid write to a key survives a prior malformed read of it", async () => {
			// The old read-path delete could destroy a concurrent valid replacement;
			// with a non-destructive read, a valid write after a malformed read stays.
			await api.storage.local.set({ "users@a": "{malformed" })
			expect(await storage.get("a")).toBeUndefined() // hidden, NOT deleted
			await storage.set("a", { name: "Anna", age: 1 })
			expect(await storage.get("a")).toEqual({ name: "Anna", age: 1 })
		})
	})

	/**
	 * Injected boundary codec. Both JSON-SYNTAX failure and CODEC-VALIDATION
	 * failure KEEP the row (return undefined, never delete-by-id on the read path
	 * — B-23: a fire-and-forget read-path delete raced a concurrent valid write).
	 * Guards the mega-deep trap where a stricter codec turns a valid-but-drifted
	 * row into permanent loss.
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

		test("(B-23) JSON-SYNTAX failure KEEPS the row too (no read-path delete), like validation failure", async () => {
			const removeSpy = vi.spyOn(api.storage.local, "remove")
			const s = new EntityStorage<User>("users", api.storage.local, userParse)
			await api.storage.local.set({ "users@corrupt": "{not json" })
			expect(await s.get("corrupt")).toBeUndefined()
			await Promise.resolve()
			expect(removeSpy).not.toHaveBeenCalled()
			expect(await s.contains("corrupt")).toBe(true)
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

	/** The id/key consistency guard (opt-in) — the embedded-id transplant bypass closure. */
	describe("requireKeyIdentityMatch (opt-in)", () => {
		interface Identified {
			id?: string | number
			name: string
		}
		test('strict mode ("string"): mismatched, missing, or non-string ids read as undefined', async () => {
			const guarded = new EntityStorage<Identified>("profiles", api.storage.local, undefined, {
				requireKeyIdentityMatch: true,
			})
			await api.storage.local.set({
				"profiles@A": JSON.stringify({ id: "B", name: "Bob" }),
				"profiles@C": JSON.stringify({ id: "C", name: "Carol" }),
				"profiles@D": JSON.stringify({ name: "NoId" }),
				"profiles@E": JSON.stringify({ id: 5, name: "NumericIdUnderStringRoot" }),
				"profiles@6": JSON.stringify({ id: 6, name: "NumericIdMatchingButNonString" }),
			})
			expect(await guarded.get("A")).toBeUndefined()
			expect(await guarded.get("D")).toBeUndefined()
			expect(await guarded.get("E")).toBeUndefined()
			expect(await guarded.get("6")).toBeUndefined()
			expect(await guarded.get("C")).toEqual({ id: "C", name: "Carol" })
			const all = Object.fromEntries(await guarded.getAll())
			expect(Object.keys(all)).toEqual(["C"])
			// The row is hidden, never deleted — repair paths can still see it.
			expect(await api.storage.local.get("profiles@A")).toHaveProperty("profiles@A")
		})

		test("numeric mode: canonical decimal form of a number/string id must equal the suffix", async () => {
			const guarded = new EntityStorage<Identified>("journal", api.storage.local, undefined, {
				requireKeyIdentityMatch: true,
				keyIdentityMode: "numeric",
			})
			await api.storage.local.set({
				"journal@1": JSON.stringify({ id: 1, name: "one" }),
				"journal@2": JSON.stringify({ id: "2", name: "two-as-string" }),
				"journal@9": JSON.stringify({ id: 5, name: "aliased" }),
				"journal@3": JSON.stringify({ name: "no-id" }),
			})
			expect(await guarded.get("1")).toEqual({ id: 1, name: "one" })
			expect(await guarded.get("2")).toEqual({ id: "2", name: "two-as-string" })
			expect(await guarded.get("9")).toBeUndefined()
			expect(await guarded.get("3")).toBeUndefined()
		})

		test("without the flag, mismatched embedded ids keep reading (other roots rely on this)", async () => {
			const unguarded = new EntityStorage<Identified>("contexts", api.storage.local)
			await api.storage.local.set({ "contexts@full": JSON.stringify({ id: "s1", name: "x" }) })
			expect(await unguarded.get("full")).toEqual({ id: "s1", name: "x" })
		})
	})

	/** The compare-and-delete surface for the F-B23 purge second pass. */
	describe("raw string accessors", () => {
		test("rawStringEntries returns the EXACT stored strings, including syntax-broken and validation-failed rows", async () => {
			await storage.set("alice", { name: "Alice", age: 30 })
			await api.storage.local.set({ "users@broken": "{not json", "users@drifted": JSON.stringify({ name: "NoAge" }) })
			const entries = Object.fromEntries(await storage.rawStringEntries())
			expect(entries).toEqual({
				alice: JSON.stringify({ name: "Alice", age: 30 }),
				broken: "{not json",
				drifted: JSON.stringify({ name: "NoAge" }),
			})
		})

		test("rawValue returns the stored string for one id; undefined when absent", async () => {
			await api.storage.local.set({ "users@broken": "{not json" })
			expect(await storage.rawValue("broken")).toBe("{not json")
			expect(await storage.rawValue("nobody")).toBeUndefined()
		})
	})
})
