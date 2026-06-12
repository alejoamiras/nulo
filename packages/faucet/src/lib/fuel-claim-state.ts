/**
 * The fueled-claim recovery ladder (plan ledger L14 v3) as a pure decision function.
 *
 * Triggers are RECORD-SPECIFIC ground truth only — never aggregate balances, never
 * inference from simulate-failure (the claim classifier cannot distinguish "message
 * consumed" from "PXE not synced"):
 *  - our own attempt's receipt reading INCLUDED consumes the FJ message (setup phase
 *    is non-revertible, so even an app-reverted claim burned the fuel as fees);
 *  - fee-insufficiency compares two record-local quantities (event-sourced
 *    `fuelReceived` vs the network's current min fee with margin);
 *  - everything ambiguous WAITS, and a persistent-failure threshold only ever
 *    OFFERS a manual, non-destructive "claim without fuel" action to the user.
 */

export type FuelClaimAction =
	| "fjwc" // token claim pays for itself by claiming the fuel in-tx (the default).
	| "sponsored" // fuel is gone (consumed by our included attempt, or user chose to skip it).
	| "sponsored-plus-standalone-fj" // fee spike: claim token sponsored AND claim the FJ standalone.
	| "wait" // no positive evidence yet - keep waiting; never fall back on ambiguity.

export type FuelReceiptStatus = "included" | "dropped" | "pending"

export interface FuelClaimEvidence {
	/** The journal-first latch: an fjwc-embedded wallet call was invoked for this record. */
	attempt: boolean
	/** Whether the attempt's tx hash was persisted (the wallet returned). */
	txHashKnown: boolean
	/** The attempt tx's receipt state, when a hash is known and probed. */
	receiptStatus?: FuelReceiptStatus
	/** Event-sourced fuelReceived (base units). Undefined while the L1 leg hasn't landed. */
	fuelReceived?: bigint
	/** The network's current minimum claim fee (base units), when known. */
	currentMinFee?: bigint
	/** Consecutive fjwc gate/simulate failures observed for this record. */
	persistentFailureCount: number
	/** The user explicitly chose "Claim without fuel". */
	userOverride: boolean
}

export interface FuelClaimDecision {
	action: FuelClaimAction
	/** True when the UI should surface the manual "Claim without fuel" action. */
	offerManual: boolean
}

/** Fee-spike margin: the claimed fuel must cover at least margin × current min fee to self-pay. */
export const FUEL_FEE_MARGIN = 2n

/** Ambiguous-wait threshold before the manual escape is OFFERED (never auto-fired). */
export const MANUAL_OFFER_THRESHOLD = 3

export function decideFuelClaim(e: FuelClaimEvidence): FuelClaimDecision {
	const offerManual = e.persistentFailureCount >= MANUAL_OFFER_THRESHOLD

	// The user's explicit, non-destructive escape: token claims sponsored; the FJ message (if
	// unconsumed) stays claimable later - fuel is never marked abandoned.
	if (e.userOverride) return { action: "sponsored", offerManual: false }

	// Trigger 1 - our own receipt is ground truth: an INCLUDED fjwc attempt consumed the FJ
	// message regardless of app-phase outcome. Never re-embed a consumed claim.
	if (e.attempt && e.txHashKnown) {
		if (e.receiptStatus === "included") return { action: "sponsored", offerManual: false }
		if (e.receiptStatus === "dropped") return { action: "fjwc", offerManual }
		// Pending or unprobed: the tx may still land - wait, never guess.
		return { action: "wait", offerManual }
	}

	// Attempt latched but the wallet never returned a hash (crash mid-prompt): the tx MAY have
	// been sent. Unknowable record-locally ⇒ wait; the manual escape resolves it safely either
	// way (sponsored token claim works whether or not the unknown tx consumed the fuel).
	if (e.attempt) return { action: "wait", offerManual }

	// Trigger 2 - fee insufficiency from two record-local quantities: the claimed fuel cannot
	// cover its own claim tx. Claim the token sponsored AND land the FJ as balance standalone.
	if (e.fuelReceived !== undefined && e.currentMinFee !== undefined && e.fuelReceived < e.currentMinFee * FUEL_FEE_MARGIN) {
		return { action: "sponsored-plus-standalone-fj", offerManual: false }
	}

	return { action: "fjwc", offerManual }
}
