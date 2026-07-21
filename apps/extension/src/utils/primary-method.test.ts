import { describe, expect, test } from "vitest"
import { FEE_METHODS, pickPrimaryMethod } from "./primary-method"

describe("FEE_METHODS — wallet-injected fee/entrypoint set", () => {
	test("contains the documented seven entries", () => {
		expect(FEE_METHODS.has("sponsor_unconditionally")).toBe(true)
		expect(FEE_METHODS.has("fee_entrypoint_private")).toBe(true)
		expect(FEE_METHODS.has("fee_entrypoint_public")).toBe(true)
		expect(FEE_METHODS.has("pay_fee")).toBe(true)
		expect(FEE_METHODS.has("set_authorized")).toBe(true)
		// The self-pay fee payloads: FeeJuicePaymentMethodWithClaim's setup call + the embedded
		// private-FPC payment's setup call. Fee mechanics, never the user's intent.
		expect(FEE_METHODS.has("claim_and_end_setup")).toBe(true)
		expect(FEE_METHODS.has("mint_and_pay_fee")).toBe(true)
	})
	test("does NOT contain common user method names", () => {
		expect(FEE_METHODS.has("transfer")).toBe(false)
		expect(FEE_METHODS.has("transfer_in_private")).toBe(false)
		expect(FEE_METHODS.has("mint_to_private")).toBe(false)
		expect(FEE_METHODS.has("drip_to_private")).toBe(false)
		// Plain fee-juice `claim` stays a USER method: it is the honest primary of a fuel claim tx, and
		// third-party contracts legitimately name user-facing methods `claim` (airdrops etc.).
		expect(FEE_METHODS.has("claim")).toBe(false)
	})
})

describe("pickPrimaryMethod — self-pay fee payloads are infra, not intent", () => {
	// The private fuel claim bundles [FeeJuice.claim, PrivateFPC.mint_and_pay_fee] with NO app call.
	// Pre-fix, the mint heuristic saw userMethods[1] = mint_and_pay_fee and titled the tx
	// "Mint And Pay Fee"; the honest primary is the FeeJuice claim.
	test("private fuel claim: [claim, mint_and_pay_fee] → claim (mint heuristic no longer hijacked)", () => {
		expect(pickPrimaryMethod([{ method: "claim" }, { method: "mint_and_pay_fee" }])).toBe("claim")
	})
	// The fueled private bridge claim bundles the fee's claim_and_end_setup with the token claim; the
	// token claim is the intent.
	test("fueled bridge claim: [claim_and_end_setup, claim_private] → claim_private", () => {
		expect(pickPrimaryMethod([{ method: "claim_and_end_setup" }, { method: "claim_private" }])).toBe("claim_private")
	})
	// The public fuel-only self-pay claim is carrier-less: the fee payload is the ONLY call, so the
	// all-fee fallback surfaces it (humanize maps it to "Claim Fee Juice").
	test("public fuel claim: [claim_and_end_setup] alone → claim_and_end_setup (all-fee fallback)", () => {
		expect(pickPrimaryMethod([{ method: "claim_and_end_setup" }])).toBe("claim_and_end_setup")
	})
	// The PRIVATE fueled bridge claim: the embedded private-FPC payment prepends [claim, mint_and_pay_fee]
	// before the token claim. The paired claim is fee infra - the token claim is the intent.
	test("private fueled bridge claim: [claim, mint_and_pay_fee, claim_private] → claim_private", () => {
		expect(pickPrimaryMethod([{ method: "claim" }, { method: "mint_and_pay_fee" }, { method: "claim_private" }])).toBe("claim_private")
	})
	// A LONE claim (no mint_and_pay_fee alongside) stays user-facing - airdrop-style claims are intent.
	test("lone claim next to a sponsor stays the primary (no blanket claim filtering)", () => {
		expect(pickPrimaryMethod([{ method: "sponsor_unconditionally" }, { method: "claim" }])).toBe("claim")
	})
	// Only the ADJACENT [claim, mint_and_pay_fee] pair is fee infra - a user-facing claim elsewhere in
	// the SAME tx (an app call riding a private-FPC-paid tx) must survive the filter (codex verify Med).
	test("app claim riding a private-FPC-paid tx survives: [claim, mint_and_pay_fee, claim] → the app claim", () => {
		expect(pickPrimaryMethod([{ method: "claim" }, { method: "mint_and_pay_fee" }, { method: "claim" }])).toBe("claim")
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
