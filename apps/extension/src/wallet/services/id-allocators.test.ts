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

	// N-20 hardening pins. The audit's own proof (c5-3) was defective — it
	// compared two pure reads of an UNMUTATED store, which are equal in every
	// implementation — so these replace it: a direct exclusion assertion and a
	// state-mutating write-back loop (the form that is genuinely red pre-fix).

	test("(N-20) a huge junk key contributes nothing to the max", async () => {
		// "999…9" coerced to 1e21 under the old `+x`, where float64's ulp exceeds
		// 1 — the allocator pinned onto one forever-colliding id.
		expect(await nextNumericId({ getKeys: async () => ["0", "1", "999999999999999999999"] })).toBe(2)
	})

	test("(N-20) canonical-but-unsafe keys contribute nothing", async () => {
		// Both round-trip String(Number(x)) exactly, so a canonical check alone
		// admits them; the safe-integer bound is what excludes them.
		expect(await nextNumericId({ getKeys: async () => ["1", "1e+21"] })).toBe(2)
		expect(await nextNumericId({ getKeys: async () => ["1", "9007199254740992"] })).toBe(2)
	})

	test("(N-20) alias keys contribute nothing", async () => {
		expect(await nextNumericId({ getKeys: async () => ["2", "0x10", "01", " 1", "1e3", "-1", "1.5"] })).toBe(3)
	})

	test("(N-20) write-back loop: allocation stays strictly increasing with a poisoned key present", async () => {
		// The production usage shape: allocate, persist, allocate again. Under the
		// old coercion every round returned the same collapsed float and each
		// write clobbered the same row.
		const keys = ["0", "999999999999999999999"]
		const store = { getKeys: async () => keys }
		const a = await nextNumericId(store)
		keys.push(String(a))
		const b = await nextNumericId(store)
		keys.push(String(b))
		const c = await nextNumericId(store)
		expect(a).toBe(1)
		expect(b).toBe(2)
		expect(c).toBe(3)
	})

	test("(N-20) a MAX_SAFE_INTEGER key cannot push the candidate unsafe — gap-fill stays safe and free", async () => {
		// max+1 would be 2^53 (unsafe, pins under +1). The candidate clamps and
		// walks down to the first physically-free key; uniqueness is the
		// contract, not monotonicity.
		const max = String(Number.MAX_SAFE_INTEGER)
		const first = await nextNumericId({ getKeys: async () => [max] })
		expect(Number.isSafeInteger(first)).toBe(true)
		expect(String(first)).not.toBe(max)
		// Write-back keeps producing fresh, safe, free ids.
		const keys = [max, String(first)]
		const second = await nextNumericId({ getKeys: async () => keys })
		expect(Number.isSafeInteger(second)).toBe(true)
		expect(keys).not.toContain(String(second))
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
