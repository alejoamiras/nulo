import { describe, expect, test } from "vitest"
import { nextNumericId, nextRandomId } from "./id-allocators"

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
