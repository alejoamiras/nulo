import { describe, expect, test } from "vitest"
import { FEE_METHODS, pickPrimaryMethod } from "./primary-method"

describe("FEE_METHODS — wallet-injected fee/entrypoint set", () => {
	test("contains the documented five entries", () => {
		expect(FEE_METHODS.has("sponsor_unconditionally")).toBe(true)
		expect(FEE_METHODS.has("fee_entrypoint_private")).toBe(true)
		expect(FEE_METHODS.has("fee_entrypoint_public")).toBe(true)
		expect(FEE_METHODS.has("pay_fee")).toBe(true)
		expect(FEE_METHODS.has("set_authorized")).toBe(true)
	})
	test("does NOT contain common user method names", () => {
		expect(FEE_METHODS.has("transfer")).toBe(false)
		expect(FEE_METHODS.has("transfer_in_private")).toBe(false)
		expect(FEE_METHODS.has("mint_to_private")).toBe(false)
		expect(FEE_METHODS.has("drip_to_private")).toBe(false)
	})
})

describe("pickPrimaryMethod — empty / degenerate inputs", () => {
	test("undefined → undefined", () => {
		expect(pickPrimaryMethod(undefined)).toBeUndefined()
	})
	test("empty array → undefined", () => {
		expect(pickPrimaryMethod([])).toBeUndefined()
	})
	test("items without method or name → undefined", () => {
		expect(pickPrimaryMethod([{}, {}])).toBeUndefined()
	})
	test("ignores empty-string method/name", () => {
		expect(pickPrimaryMethod([{ method: "" }, { name: "" }])).toBeUndefined()
	})
})

describe("pickPrimaryMethod — drip regression (the bug this PR fixes)", () => {
	// Faucet drip shape: wallet-injected sponsor call sits at index 0, the
	// user's actual call sits at index 1. Pre-fix, the journal title was
	// derived via .find(c => c.method ?? c.name) which returned the first
	// item → the user saw "Sponsored unconditionally" while proving, then
	// the settled card flipped to the real call name.
	test("name-shape: [sponsor, drip] → drip_to_private", () => {
		expect(pickPrimaryMethod([{ name: "sponsor_unconditionally" }, { name: "drip_to_private" }])).toBe("drip_to_private")
	})
	test("method-shape: [sponsor, drip] → drip_to_private", () => {
		expect(pickPrimaryMethod([{ method: "sponsor_unconditionally" }, { method: "drip_to_private" }])).toBe("drip_to_private")
	})
	test("mixed name/method shapes are both honored", () => {
		expect(pickPrimaryMethod([{ name: "sponsor_unconditionally" }, { method: "transfer_in_private" }])).toBe("transfer_in_private")
	})
})

describe("pickPrimaryMethod — single user call", () => {
	test("[drip] alone → drip", () => {
		expect(pickPrimaryMethod([{ method: "drip_to_private" }])).toBe("drip_to_private")
	})
	test("[fee, real] with 1 user call → the user call", () => {
		expect(pickPrimaryMethod([{ method: "pay_fee" }, { method: "transfer" }])).toBe("transfer")
	})
})

describe("pickPrimaryMethod — mint heuristic (preserved from getPrimaryCall)", () => {
	test("2 user calls, 2nd is mint_to_private → returns mint", () => {
		expect(pickPrimaryMethod([{ method: "transfer_in_public" }, { method: "mint_to_private" }])).toBe("mint_to_private")
	})
	test('2 user calls, 2nd starts with literal "mint" → returns mint', () => {
		expect(pickPrimaryMethod([{ method: "transfer" }, { method: "mint" }])).toBe("mint")
	})
	test("2 user calls, 2nd is NOT a mint → returns 1st", () => {
		expect(pickPrimaryMethod([{ method: "transfer_in_private" }, { method: "shield" }])).toBe("transfer_in_private")
	})
	test("3 user calls, 2nd is mint, 3rd is anything → still returns mint (heuristic only looks at index 1)", () => {
		expect(pickPrimaryMethod([{ method: "transfer" }, { method: "mint_to_public" }, { method: "shield" }])).toBe("mint_to_public")
	})
})

describe("pickPrimaryMethod — fee-only edge case (BUG PIN)", () => {
	// Pre-existing behavior of getPrimaryCall: when every call is a FEE_METHOD,
	// it returned the first one. Preserving verbatim during the extraction —
	// changing this is a separate behavior-change PR, not part of the shared-
	// helper unification. Pinning so a future "fix" is a deliberate decision.
	test("(BUG PIN) [sponsor, pay_fee] → sponsor_unconditionally", () => {
		expect(pickPrimaryMethod([{ method: "sponsor_unconditionally" }, { method: "pay_fee" }])).toBe("sponsor_unconditionally")
	})
	test("(BUG PIN) [pay_fee] alone → pay_fee", () => {
		expect(pickPrimaryMethod([{ method: "pay_fee" }])).toBe("pay_fee")
	})
})

describe("pickPrimaryMethod — order invariant", () => {
	test("user calls before fee calls → first user call wins", () => {
		expect(pickPrimaryMethod([{ method: "transfer" }, { method: "sponsor_unconditionally" }])).toBe("transfer")
	})
	test("fee call sandwiched between user calls → first user call wins", () => {
		expect(pickPrimaryMethod([{ method: "transfer" }, { method: "sponsor_unconditionally" }, { method: "shield" }])).toBe("transfer")
	})
})
