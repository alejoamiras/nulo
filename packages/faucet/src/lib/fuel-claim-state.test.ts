import { describe, expect, it } from "vitest"
import {
	decideFuelClaim,
	decideNoFuelFeeSource,
	decidePrivateFuelClaim,
	type FuelClaimEvidence,
	isPrivateFuelInsufficiency,
	MANUAL_OFFER_THRESHOLD,
	PRIVATE_FUEL_INSUFFICIENCY_MSG,
	type PrivateFuelClaimEvidence,
} from "./fuel-claim-state"

const base: FuelClaimEvidence = {
	attempt: false,
	txHashKnown: false,
	persistentFailureCount: 0,
	userOverride: false,
}

describe("decideFuelClaim (L14 v3 truth table)", () => {
	it("default path: no attempt, healthy fuel ⇒ fjwc", () => {
		expect(decideFuelClaim({ ...base, fuelReceived: 500n, currentMinFee: 100n })).toEqual({
			action: "fjwc",
			offerManual: false,
		})
	})

	it("crash window: included attempt ⇒ sponsored (the FJ message is consumed, even app-reverted)", () => {
		expect(decideFuelClaim({ ...base, attempt: true, txHashKnown: true, receiptStatus: "included" })).toEqual({
			action: "sponsored",
			offerManual: false,
		})
	})

	it("a dropped attempt retries fjwc (nothing was consumed)", () => {
		expect(decideFuelClaim({ ...base, attempt: true, txHashKnown: true, receiptStatus: "dropped" }).action).toBe("fjwc")
	})

	it("a pending attempt WAITS - never re-embed while the tx may land", () => {
		expect(decideFuelClaim({ ...base, attempt: true, txHashKnown: true, receiptStatus: "pending" }).action).toBe("wait")
	})

	it("attempt latched but no hash (crash mid-prompt) WAITS - unknowable, never guess", () => {
		expect(decideFuelClaim({ ...base, attempt: true }).action).toBe("wait")
	})

	it("fee spike: fuel below margin × min fee ⇒ sponsored + standalone FJ claim", () => {
		expect(decideFuelClaim({ ...base, fuelReceived: 150n, currentMinFee: 100n })).toEqual({
			action: "sponsored-plus-standalone-fj",
			offerManual: false,
		})
	})

	it("fuel exactly at the margin self-pays (boundary)", () => {
		expect(decideFuelClaim({ ...base, fuelReceived: 200n, currentMinFee: 100n }).action).toBe("fjwc")
	})

	it("unknown min fee never triggers the fee-spike path", () => {
		expect(decideFuelClaim({ ...base, fuelReceived: 1n }).action).toBe("fjwc")
	})

	it("user override ⇒ sponsored, regardless of other evidence", () => {
		expect(decideFuelClaim({ ...base, userOverride: true, attempt: true, txHashKnown: true, receiptStatus: "pending" })).toEqual({
			action: "sponsored",
			offerManual: false,
		})
	})

	it("the manual escape is OFFERED after the threshold, only on ambiguous waits", () => {
		const waiting = decideFuelClaim({
			...base,
			attempt: true,
			persistentFailureCount: MANUAL_OFFER_THRESHOLD,
		})
		expect(waiting).toEqual({ action: "wait", offerManual: true })
		// Below the threshold: wait without the offer.
		expect(decideFuelClaim({ ...base, attempt: true, persistentFailureCount: 1 })).toEqual({
			action: "wait",
			offerManual: false,
		})
	})

	it("durable consumed=true settles to sponsored when the node is UNREACHABLE (receipt pending)", () => {
		// The unreachable-node stranding the live-only probe introduced: consumed is the fallback.
		expect(decideFuelClaim({ ...base, attempt: true, txHashKnown: true, receiptStatus: "pending", consumed: true }).action).toBe(
			"sponsored",
		)
		// And even with no hash (crash mid-prompt) a durable consumed flag settles it.
		expect(decideFuelClaim({ ...base, attempt: true, consumed: true }).action).toBe("sponsored")
	})

	it("a conclusive dropped receipt OVERRIDES a stale consumed flag (dropped consumed nothing)", () => {
		expect(decideFuelClaim({ ...base, attempt: true, txHashKnown: true, receiptStatus: "dropped", consumed: true }).action).toBe("fjwc")
	})

	it("a user already holding FJ changes NOTHING (no balance input exists)", () => {
		// The v2 aggregate-balance probe was withdrawn (final-gate codex CRITICAL): the decision
		// surface has no balance parameter at all - this pin keeps it that way.
		const keys = Object.keys({ ...base, fuelReceived: 0n, currentMinFee: 0n, receiptStatus: "pending" })
		expect(keys).not.toContain("fjBalance")
		expect(keys).not.toContain("balance")
	})
})

const privBase: PrivateFuelClaimEvidence = { attempt: false, txHashKnown: false, setupInsufficiency: false }

describe("decidePrivateFuelClaim (Option A — never public/Sponsored)", () => {
	it("fresh record (no attempt) ⇒ private-fpc", () => {
		expect(decidePrivateFuelClaim(privBase).action).toBe("private-fpc")
	})
	it("included attempt ⇒ consumed (no re-mint)", () => {
		expect(decidePrivateFuelClaim({ ...privBase, attempt: true, txHashKnown: true, receiptStatus: "included" }).action).toBe("consumed")
	})
	it("durable consumed flag ⇒ consumed", () => {
		expect(decidePrivateFuelClaim({ ...privBase, attempt: true, txHashKnown: true, consumed: true }).action).toBe("consumed")
	})
	it("dropped attempt (not included ⇒ FJ unconsumed) ⇒ private-fpc retry", () => {
		expect(decidePrivateFuelClaim({ ...privBase, attempt: true, txHashKnown: true, receiptStatus: "dropped" }).action).toBe(
			"private-fpc",
		)
	})
	it("pending receipt ⇒ wait (never guess)", () => {
		expect(decidePrivateFuelClaim({ ...privBase, attempt: true, txHashKnown: true, receiptStatus: "pending" }).action).toBe("wait")
	})
	it("attempt, no hash, setup-insufficiency ⇒ private-fpc (the narrow retry allow-list)", () => {
		expect(decidePrivateFuelClaim({ ...privBase, attempt: true, txHashKnown: false, setupInsufficiency: true }).action).toBe(
			"private-fpc",
		)
	})
	it("attempt, no hash, NOT insufficiency, not consumed ⇒ wait (fail-closed)", () => {
		expect(decidePrivateFuelClaim({ ...privBase, attempt: true, txHashKnown: false, setupInsufficiency: false }).action).toBe("wait")
	})
	it("attempt, no hash, consumed ⇒ consumed", () => {
		expect(decidePrivateFuelClaim({ ...privBase, attempt: true, txHashKnown: false, consumed: true }).action).toBe("consumed")
	})
	it("INVARIANT (L11): no evidence EVER yields a public/Sponsored action", () => {
		const cases: PrivateFuelClaimEvidence[] = [
			privBase,
			{ ...privBase, attempt: true, txHashKnown: true, receiptStatus: "included" },
			{ ...privBase, attempt: true, txHashKnown: true, receiptStatus: "dropped" },
			{ ...privBase, attempt: true, txHashKnown: true, receiptStatus: "pending" },
			{ ...privBase, attempt: true, setupInsufficiency: true },
			{ ...privBase, attempt: true, consumed: true },
		]
		for (const c of cases) expect(["private-fpc", "consumed", "wait"]).toContain(decidePrivateFuelClaim(c).action)
	})
	it("the insufficiency classifier matches the installed assert + fails closed otherwise", () => {
		expect(isPrivateFuelInsufficiency(`Tx invalid: ${PRIVATE_FUEL_INSUFFICIENCY_MSG}`)).toBe(true)
		expect(isPrivateFuelInsufficiency("some other revert")).toBe(false)
	})
})

describe("decideNoFuelFeeSource (private-first, fail-closed)", () => {
	const COST = 100n

	it("private balance that covers wins (private-first), even when public also covers", () => {
		expect(decideNoFuelFeeSource({ privateFeeJuice: 100n, publicFeeJuice: 999n, maxGasCost: COST })).toEqual({ source: "private" })
	})

	it("private-only covers → private", () => {
		expect(decideNoFuelFeeSource({ privateFeeJuice: 150n, publicFeeJuice: 0n, maxGasCost: COST })).toEqual({ source: "private" })
	})

	it("private insufficient, public covers → public (defer to wallet picker)", () => {
		expect(decideNoFuelFeeSource({ privateFeeJuice: 50n, publicFeeJuice: 200n, maxGasCost: COST })).toEqual({ source: "public" })
	})

	it("exact boundary (balance === maxGasCost) covers — pay_fee asserts >=", () => {
		expect(decideNoFuelFeeSource({ privateFeeJuice: 100n, publicFeeJuice: null, maxGasCost: COST })).toEqual({ source: "private" })
		expect(decideNoFuelFeeSource({ privateFeeJuice: 0n, publicFeeJuice: 100n, maxGasCost: COST })).toEqual({ source: "public" })
	})

	it("both known, neither covers → none with shortfall against the larger balance", () => {
		expect(decideNoFuelFeeSource({ privateFeeJuice: 30n, publicFeeJuice: 70n, maxGasCost: COST })).toEqual({
			source: "none",
			shortfall: 30n,
		})
	})

	it("FAIL-CLOSED: private read failed (null) + public can't cover → unverifiable, NOT a false 'no gas'", () => {
		expect(decideNoFuelFeeSource({ privateFeeJuice: null, publicFeeJuice: 10n, maxGasCost: COST })).toEqual({ source: "unverifiable" })
	})

	it("FAIL-CLOSED: both reads failed → unverifiable", () => {
		expect(decideNoFuelFeeSource({ privateFeeJuice: null, publicFeeJuice: null, maxGasCost: COST })).toEqual({ source: "unverifiable" })
	})

	it("a KNOWN covering balance overrides the other read failing (no false unverifiable)", () => {
		// public read failed, but private definitively covers - decide private, don't fail closed.
		expect(decideNoFuelFeeSource({ privateFeeJuice: 200n, publicFeeJuice: null, maxGasCost: COST })).toEqual({ source: "private" })
	})
})
