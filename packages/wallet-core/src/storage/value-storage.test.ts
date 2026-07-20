import { beforeEach, describe, expect, test } from "vitest"
import { FakeBrowserApi } from "../testing/fake-browser-api"
import { ValueStorage } from "./value-storage"

/**
 * Contract tests for `ValueStorage`.
 *
 * The constructor accepts only a concrete `StorageArea` — no legacy enum
 * branch. These tests lock the wire-shape so behavior stays byte-identical
 * across refactors.
 */

describe("ValueStorage", () => {
	let api: FakeBrowserApi

	beforeEach(() => {
		api = new FakeBrowserApi()
		api.reset()
	})

	test("get returns undefined when unset", async () => {
		const vs = new ValueStorage<number>("count", api.storage.local)
		expect(await vs.get()).toBeUndefined()
	})

	test("set/get round-trip for primitives", async () => {
		const vs = new ValueStorage<number>("count", api.storage.local)
		await vs.set(42)
		expect(await vs.get()).toBe(42)
	})

	test("set/get round-trip for objects", async () => {
		const vs = new ValueStorage<{ a: number; b: string }>("config", api.storage.local)
		await vs.set({ a: 1, b: "x" })
		expect(await vs.get()).toEqual({ a: 1, b: "x" })
	})

	test("set/get round-trip for booleans", async () => {
		const vs = new ValueStorage<boolean>("enabled", api.storage.local)
		await vs.set(true)
		expect(await vs.get()).toBe(true)
		await vs.set(false)
		expect(await vs.get()).toBe(false)
	})

	test("delete clears the value; subsequent get is undefined", async () => {
		const vs = new ValueStorage<number>("count", api.storage.local)
		await vs.set(42)
		await vs.delete()
		expect(await vs.get()).toBeUndefined()
	})

	test("overwriting set replaces the value", async () => {
		const vs = new ValueStorage<string>("greeting", api.storage.local)
		await vs.set("hello")
		await vs.set("goodbye")
		expect(await vs.get()).toBe("goodbye")
	})

	test("two ValueStorages with different roots are isolated", async () => {
		const a = new ValueStorage<number>("a", api.storage.local)
		const b = new ValueStorage<number>("b", api.storage.local)
		await a.set(1)
		await b.set(2)
		expect(await a.get()).toBe(1)
		expect(await b.get()).toBe(2)
	})

	test("local and session are separate areas for the same root", async () => {
		const local = new ValueStorage<string>("shared", api.storage.local)
		const session = new ValueStorage<string>("shared", api.storage.session)
		await local.set("persisted")
		await session.set("ephemeral")
		expect(await local.get()).toBe("persisted")
		expect(await session.get()).toBe("ephemeral")
	})

	/**
	 * Error semantics: ValueStorage THROWS on a malformed value and NEVER deletes
	 * (a single-value store has no "drop one bad row" option). This was previously
	 * UNPINNED — locked here before the injected-codec change so the contract can't
	 * drift to a silent default/undefined.
	 */
	describe("error semantics", () => {
		test("get THROWS on malformed JSON (no default, no delete)", async () => {
			const vs = new ValueStorage<number>("count", api.storage.local)
			await api.storage.local.set({ count: "{not json" })
			await expect(vs.get()).rejects.toThrow()
			// The bad value is NOT deleted — still present for a repair path.
			expect(await api.storage.local.get("count")).toEqual({ count: "{not json" })
		})

		test("injected codec: get THROWS on validation failure (no delete)", async () => {
			const isPositive = (raw: unknown): number => {
				if (typeof raw === "number" && raw > 0) return raw
				throw new Error("expected a positive number")
			}
			const vs = new ValueStorage<number>("count", api.storage.local, isPositive)
			await api.storage.local.set({ count: JSON.stringify(-5) }) // valid JSON, fails validation
			await expect(vs.get()).rejects.toThrow("expected a positive number")
			expect(await api.storage.local.get("count")).toEqual({ count: "-5" })
		})

		test("injected codec: a valid value passes through", async () => {
			const isPositive = (raw: unknown): number => {
				if (typeof raw === "number" && raw > 0) return raw
				throw new Error("expected a positive number")
			}
			const vs = new ValueStorage<number>("count", api.storage.local, isPositive)
			await vs.set(7)
			expect(await vs.get()).toBe(7)
		})
	})
})
