import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
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
	 * Resilience: a malformed value used to throw from `JSON.parse` inside the
	 * read path and poison wallet startup/restore. Mirrors `EntityStorage`'s
	 * `parseOrDelete` — quarantine + drop, never throw.
	 */
	describe("malformed value resilience", () => {
		let errorSpy: ReturnType<typeof vi.spyOn>

		beforeEach(() => {
			errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		})

		afterEach(() => {
			errorSpy.mockRestore()
		})

		test("get of a malformed value returns undefined, schedules delete, logs an error", async () => {
			await api.storage.local.set({ config: "{not valid json" })
			const vs = new ValueStorage<{ a: number }>("config", api.storage.local)
			expect(await vs.get()).toBeUndefined()
			expect(errorSpy).toHaveBeenCalledTimes(1)
			expect(errorSpy.mock.calls[0]?.[0]).toContain("config")
			// Delete is fire-and-forget; allow the microtask to flush.
			await Promise.resolve()
			expect(await vs.get()).toBeUndefined()
		})

		test("logged payload preview is length-bounded", async () => {
			const garbage = `{${"x".repeat(5000)}`
			await api.storage.local.set({ blob: garbage })
			const vs = new ValueStorage<unknown>("blob", api.storage.local)
			expect(await vs.get()).toBeUndefined()
			const logged = String(errorSpy.mock.calls[0]?.[0] ?? "")
			expect(logged).not.toContain("x".repeat(5000))
			expect(logged.length).toBeLessThan(600)
		})
	})
})
