import { describe, expect, test, vi } from "vitest"
import { pendingHashesChanged, SingleShotTtlCache } from "./estimate-reuse-shared"

const TTL = 1000
type E = { builtAt: number; v: string }

describe("SingleShotTtlCache (Q-10)", () => {
	test("consume returns the entry once, then undefined (single-shot)", () => {
		const c = new SingleShotTtlCache<E>(TTL)
		const e = { builtAt: Date.now(), v: "x" }
		c.stash("id", e)
		expect(c.consume("id")).toBe(e)
		expect(c.consume("id")).toBeUndefined()
	})

	test("consume of an unknown id is undefined", () => {
		expect(new SingleShotTtlCache<E>(TTL).consume("nope")).toBeUndefined()
	})

	test("evict drops a stashed entry", () => {
		const c = new SingleShotTtlCache<E>(TTL)
		c.stash("id", { builtAt: Date.now(), v: "x" })
		c.evict("id")
		expect(c.consume("id")).toBeUndefined()
	})

	test("stash opportunistically sweeps entries older than the TTL (by builtAt)", () => {
		vi.useFakeTimers()
		try {
			const c = new SingleShotTtlCache<E>(TTL)
			c.stash("stale", { builtAt: Date.now() - TTL - 1, v: "stale" })
			c.stash("fresh", { builtAt: Date.now(), v: "fresh" }) // triggers evictStale
			expect(c.consume("stale")).toBeUndefined()
			expect(c.consume("fresh")?.v).toBe("fresh")
		} finally {
			vi.useRealTimers()
		}
	})

	test("the per-entry timer physically drops the entry at the TTL", () => {
		vi.useFakeTimers()
		try {
			const c = new SingleShotTtlCache<E>(TTL)
			c.stash("id", { builtAt: Date.now(), v: "x" })
			vi.advanceTimersByTime(TTL + 2)
			expect(c.consume("id")).toBeUndefined()
		} finally {
			vi.useRealTimers()
		}
	})
})

describe("pendingHashesChanged (Q-10)", () => {
	test("false for the same set regardless of order", () => {
		expect(pendingHashesChanged(["a", "b", "c"], ["c", "a", "b"])).toBe(false)
	})
	test("false for two empty sets", () => {
		expect(pendingHashesChanged([], [])).toBe(false)
	})
	test("true when the length differs", () => {
		expect(pendingHashesChanged(["a", "b"], ["a"])).toBe(true)
	})
	test("true when a member differs", () => {
		expect(pendingHashesChanged(["a", "b"], ["a", "c"])).toBe(true)
	})
})
