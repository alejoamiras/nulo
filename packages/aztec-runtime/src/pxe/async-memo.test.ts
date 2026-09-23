import { describe, expect, test, vi } from "vitest"
import { memoizeAsync, memoizeAsyncBy } from "./async-memo"

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe("memoizeAsync (singleton)", () => {
	test("caches: loader runs once across repeated gets", async () => {
		const loader = vi.fn(async () => 42)
		const memo = memoizeAsync(loader)
		expect(await memo.get()).toBe(42)
		expect(await memo.get()).toBe(42)
		expect(loader).toHaveBeenCalledTimes(1)
	})

	test("rejection clears the slot: next get retries and can succeed", async () => {
		let fail = true
		const loader = vi.fn(async () => {
			if (fail) throw new Error("transient")
			return "ok"
		})
		const memo = memoizeAsync(loader)
		await expect(memo.get()).rejects.toThrow("transient")
		await flush() // let the rejection handler clear the slot
		fail = false
		expect(await memo.get()).toBe("ok")
		expect(loader).toHaveBeenCalledTimes(2)
	})

	test("identity guard: a stale rejection never clobbers a newer promise", async () => {
		let reject!: (e: Error) => void
		let call = 0
		const loader = vi.fn(() => {
			call += 1
			if (call === 1) return new Promise<number>((_, rej) => (reject = rej))
			return Promise.resolve(7)
		})
		const memo = memoizeAsync(loader)
		const first = memo.get()
		memo.reset() // caller-intent clear while the first load is in flight
		const second = memo.get() // newer promise installed
		reject(new Error("stale failure")) // the FIRST promise now rejects late
		await expect(first).rejects.toThrow("stale failure")
		await flush()
		// The stale rejection must not have cleared the newer entry: same promise back.
		expect(memo.get()).toBe(second)
		expect(await second).toBe(7)
	})

	test("reset forces a reload even after success", async () => {
		const loader = vi.fn(async () => Math.random())
		const memo = memoizeAsync(loader)
		await memo.get()
		memo.reset()
		await memo.get()
		expect(loader).toHaveBeenCalledTimes(2)
	})
})

describe("memoizeAsyncBy (keyed)", () => {
	test("per-key isolation with the default Map (string-union keys)", async () => {
		const loader = vi.fn(async (key: "a" | "b") => `v:${key}`)
		const memo = memoizeAsyncBy(loader)
		expect(await memo.get("a")).toBe("v:a")
		expect(await memo.get("b")).toBe("v:b")
		expect(await memo.get("a")).toBe("v:a")
		expect(loader).toHaveBeenCalledTimes(2)
	})

	test("rejection clears only the failed key", async () => {
		const fails = new Set(["bad"])
		const loader = vi.fn(async (key: string) => {
			if (fails.has(key)) throw new Error(`boom:${key}`)
			return key.toUpperCase()
		})
		const memo = memoizeAsyncBy(loader)
		expect(await memo.get("good")).toBe("GOOD")
		await expect(memo.get("bad")).rejects.toThrow("boom:bad")
		await flush()
		fails.clear()
		expect(await memo.get("bad")).toBe("BAD") // retried
		expect(await memo.get("good")).toBe("GOOD") // still cached
		expect(loader).toHaveBeenCalledTimes(3)
	})

	test("identity guard per key: stale rejection does not clobber a newer entry", async () => {
		let reject!: (e: Error) => void
		let call = 0
		const loader = vi.fn((_key: string) => {
			call += 1
			if (call === 1) return new Promise<number>((_, rej) => (reject = rej))
			return Promise.resolve(1)
		})
		const memo = memoizeAsyncBy(loader)
		const first = memo.get("k")
		memo.reset("k")
		const second = memo.get("k")
		reject(new Error("stale"))
		await expect(first).rejects.toThrow("stale")
		await flush()
		expect(memo.get("k")).toBe(second)
	})

	test("wholesale clear of an injected Map store forces reload (catalog-wide test-reset pattern)", async () => {
		// The helper's reset is per-key by design; consumers that need an
		// all-keys reset (artifact-catalog's test hook) hold the store and
		// clear it directly — this pins that pattern working end to end.
		const store = new Map<string, Promise<number>>()
		let calls = 0
		const memo = memoizeAsyncBy<string, number>(async () => ++calls, store)
		await memo.get("a")
		await memo.get("b")
		expect(calls).toBe(2)
		store.clear()
		await memo.get("a")
		expect(calls).toBe(3) // reloaded after the wholesale clear
	})

	test("accepts an injected WeakMap for object keys", async () => {
		const store = new WeakMap<object, Promise<string>>()
		const loader = vi.fn(async (key: { id: number }) => `obj:${key.id}`)
		const memo = memoizeAsyncBy(loader, store)
		const k1 = { id: 1 }
		expect(await memo.get(k1)).toBe("obj:1")
		expect(await memo.get(k1)).toBe("obj:1")
		expect(loader).toHaveBeenCalledTimes(1)
		expect(store.get(k1)).toBeDefined() // genuinely backed by the injected store
		memo.reset(k1)
		expect(store.get(k1)).toBeUndefined()
	})
})
