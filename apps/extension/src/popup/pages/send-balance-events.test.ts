import { describe, expect, test } from "vitest"
import { applyBalanceAdd, applyBalanceUpdate, type TokenBalanceEvent } from "./send-balance-events"

const bal = (id: number, account: string): TokenBalanceEvent => ({ id, account })

describe("applyBalanceAdd (B-25)", () => {
	// The pre-fix handler called `.push` on the singular `tokenBalance` COMPUTED
	// (a ComputedRef, no `.push`) and threw on every live add. The append target
	// is the tokenBalances ARRAY.
	test("appends a balance for the active account", () => {
		const list = [bal(1, "0xacc")]
		applyBalanceAdd(list, "0xacc", bal(2, "0xacc"))
		expect(list.map((b) => b.id)).toEqual([1, 2])
	})

	test("ignores a balance for a different account", () => {
		const list = [bal(1, "0xacc")]
		applyBalanceAdd(list, "0xacc", bal(2, "0xother"))
		expect(list.map((b) => b.id)).toEqual([1])
	})
})

describe("applyBalanceUpdate", () => {
	test("replaces an existing balance in place, matched by id", () => {
		const list = [bal(1, "0xacc"), bal(2, "0xacc")]
		const replacement = { ...bal(2, "0xacc"), extra: 1 } as TokenBalanceEvent
		applyBalanceUpdate(list, replacement)
		expect(list[1]).toBe(replacement)
		expect(list.length).toBe(2)
	})

	test("ignores an unknown id (adds arrive via applyBalanceAdd)", () => {
		const list = [bal(1, "0xacc")]
		applyBalanceUpdate(list, bal(9, "0xacc"))
		expect(list.map((b) => b.id)).toEqual([1])
	})
})
