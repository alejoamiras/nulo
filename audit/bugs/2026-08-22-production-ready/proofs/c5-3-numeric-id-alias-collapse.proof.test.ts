/**
 * BUG PROOF — C5-3: `nextNumericId` consumes non-canonical numeric key
 * suffixes, so one poisoned key pins the allocation cursor forever.
 *
 * `nextNumericId = array_max(getKeys().map(+)) + 1`. A key whose suffix is a
 * huge numeric literal ("999999999999999999999" → 1e21) makes `+1` a no-op in
 * float64 (ulp(1e21) ≈ 2^17): every subsequent allocation returns the SAME
 * number, so every new row writes `${root}@1e+21` and clobbers the previous.
 * The purge path already hardens against alias suffixes via
 * canonicalNumericStorageId; the allocator does not.
 *
 * RED today: allocation collapses onto one id. GREEN after fix: junk/alias
 * suffixes are excluded from the max and fresh ids keep incrementing.
 */
import { nextNumericId } from "@/wallet/services/id-allocators"
import { describe, expect, test } from "vitest"

class KeyStore {
	keys: string[]
	constructor(keys: string[]) {
		this.keys = keys
	}
	async getKeys(): Promise<string[]> {
		return this.keys
	}
}

describe("C5-3: id allocation must ignore non-canonical / out-of-range numeric key aliases", () => {
	test("a huge-numeric junk key must not pin the cursor onto one collapsing id", async () => {
		const store = new KeyStore(["0", "1", "999999999999999999999"])

		const first = await nextNumericId(store)
		const second = await nextNumericId(store)

		// CORRECT behavior: consecutive allocations are DISTINCT fresh ids even
		// with a hostile suffix present. RED today: both equal 1e21 (+1 rounds
		// back), so rows written with them share one storage key.
		expect(second).not.toBe(first)
	})
})
