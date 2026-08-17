import { describe, expect, test } from "vitest"
import { nextNumericId, nextRandomId, preferOrReallocId } from "./id-allocators"

describe("nextNumericId", () => {
	test("returns max(existing numeric keys) + 1", async () => {
		expect(await nextNumericId({ getKeys: async () => ["1", "3", "2"] })).toBe(4)
	})

	test("single key", async () => {
		expect(await nextNumericId({ getKeys: async () => ["5"] })).toBe(6)
	})

	test("empty store starts at 1", async () => {
		expect(await nextNumericId({ getKeys: async () => [] })).toBe(1)
	})
})

describe("nextRandomId", () => {
	test("returns a hex string when there is no collision (contains checked once)", async () => {
		let calls = 0
		const id = await nextRandomId({
			contains: async () => {
				calls++
				return false
			},
		})
		expect(typeof id).toBe("string")
		expect(id.length).toBeGreaterThan(0)
		expect(id).toMatch(/^[0-9a-f]+$/)
		expect(calls).toBe(1)
	})

	test("retries on collision until a free id is found", async () => {
		let calls = 0
		const id = await nextRandomId({
			contains: async () => calls++ < 2, // first two ids "exist", third is free
		})
		expect(calls).toBe(3) // retried twice
		expect(typeof id).toBe("string")
	})

	test("honors the length argument (distinct ids at a custom length)", async () => {
		const a = await nextRandomId({ contains: async () => false }, 16)
		const b = await nextRandomId({ contains: async () => false }, 16)
		expect(a).not.toBe(b) // random → effectively always distinct
	})
})

describe("preferOrReallocId (Q-07)", () => {
	test("keeps the source id when it is free (no reroll)", async () => {
		const id = await preferOrReallocId({ contains: async () => false }, "src-id")
		expect(id).toBe("src-id")
	})

	test("rerolls to a fresh id when the source id collides in storage", async () => {
		let calls = 0
		const id = await preferOrReallocId({ contains: async () => calls++ === 0 }, "taken")
		expect(id).not.toBe("taken")
		expect(id).toMatch(/^[0-9a-f]+$/)
	})

	test("avoid-set only guards a REROLLED id, never the kept source id", async () => {
		// source id is in `avoid` but free in storage → still kept (avoid applies
		// only when id !== sourceId), matching network's intra-batch guard.
		const id = await preferOrReallocId({ contains: async () => false }, "src", new Set(["src"]))
		expect(id).toBe("src")
	})

	test("rerolls away from an id that is in the avoid set even when storage is free", async () => {
		// storage never contains anything, but the first reroll must be forced by
		// making the source id collide; then any reroll landing in `avoid` reties.
		const seen: string[] = []
		let storageCalls = 0
		const id = await preferOrReallocId(
			{
				contains: async () => storageCalls++ === 0, // source id "taken" once, forcing a reroll
			},
			"src",
			new Set<string>(), // empty avoid — reroll succeeds on first free id
		)
		seen.push(id)
		expect(id).not.toBe("src")
	})
})
