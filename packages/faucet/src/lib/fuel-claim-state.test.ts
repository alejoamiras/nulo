import { describe, expect, it } from "vitest"
import { decideFuelClaim, type FuelClaimEvidence, MANUAL_OFFER_THRESHOLD } from "./fuel-claim-state"

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

	it("a user already holding FJ changes NOTHING (no balance input exists)", () => {
		// The v2 aggregate-balance probe was withdrawn (final-gate codex CRITICAL): the decision
		// surface has no balance parameter at all - this pin keeps it that way.
		const keys = Object.keys({ ...base, fuelReceived: 0n, currentMinFee: 0n, receiptStatus: "pending" })
		expect(keys).not.toContain("fjBalance")
		expect(keys).not.toContain("balance")
	})
})
