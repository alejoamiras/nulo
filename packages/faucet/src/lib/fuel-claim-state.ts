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
	/** Durable "the FJ message was consumed by our attempt" - persisted once seen, so a later
	 *  UNREACHABLE node (receiptStatus probe returns `pending`) cannot strand a known consumption
	 *  in `wait` forever. A conclusive `dropped` receipt still overrides it. */
	consumed?: boolean
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
		// A conclusive `dropped` overrides even a (prematurely) persisted consumed flag: a dropped
		// tx consumed nothing, so retry fjwc.
		if (e.receiptStatus === "dropped") return { action: "fjwc", offerManual }
		if (e.receiptStatus === "included" || e.consumed) return { action: "sponsored", offerManual: false }
		// Pending or unprobed (incl. an unreachable node): the tx may still land - wait, never guess.
		return { action: "wait", offerManual }
	}

	// Attempt latched but the wallet never returned a hash (crash mid-prompt): the tx MAY have
	// been sent. A durable consumed flag still settles it; otherwise unknowable ⇒ wait (the manual
	// escape resolves it safely - sponsored works whether or not the unknown tx consumed the fuel).
	if (e.attempt) return e.consumed ? { action: "sponsored", offerManual: false } : { action: "wait", offerManual }

	// Trigger 2 - fee insufficiency from two record-local quantities: the claimed fuel cannot
	// cover its own claim tx. Claim the token sponsored AND land the FJ as balance standalone.
	if (e.fuelReceived !== undefined && e.currentMinFee !== undefined && e.fuelReceived < e.currentMinFee * FUEL_FEE_MARGIN) {
		return { action: "sponsored-plus-standalone-fj", offerManual: false }
	}

	return { action: "fjwc", offerManual }
}

/**
 * The PRIVATE fuel-claim ladder (plan L11, codex 019ec69a "Option A"): a fully SEPARATE decider from
 * the public one above. Its action type makes the privacy invariant structural — it can NEVER return
 * `sponsored` / `sponsored-plus-standalone-fj` (those would link the user). The private claim's fee is
 * always the Wonderland PrivateFPC method; recovery retries that method only, never public.
 *
 * Positive-evidence-only, same as the public ladder:
 *  - an INCLUDED attempt (or a durable `consumed`) burned the FJ at the FPC (the `mint_and_pay_fee`
 *    setup is non-revertible) ⇒ `consumed`: do NOT re-mint (a second claim double-spends the message);
 *  - a conclusively `dropped` attempt landed nothing ⇒ retry the private claim;
 *  - the ONE retryable no-hash case is a pre-inclusion `mint_and_pay_fee` setup-insufficiency (the
 *    "Amount too low to cover gas cost" assert makes the bundled tx invalid, so the FJ stays unconsumed);
 *  - everything else ambiguous WAITS. Never public/Sponsored on any branch.
 */
export type PrivateFuelClaimAction =
	| "private-fpc" // attempt (or retry) the PrivateFPC mint_and_pay_fee claim.
	| "consumed" // the FJ was burned by an included attempt - do NOT re-mint (recover the credited balance via pay_fee, a follow-up).
	| "wait" // no positive evidence yet - keep waiting; never fall back to public.

export interface PrivateFuelClaimEvidence {
	/** A private mint_and_pay_fee claim was invoked for this record (journal-first latch). */
	attempt: boolean
	/** The attempt's tx hash was persisted (the wallet returned). */
	txHashKnown: boolean
	/** The attempt tx's receipt state, when a hash is known and probed. */
	receiptStatus?: FuelReceiptStatus
	/** Durable "the FJ message was consumed by our included attempt". */
	consumed?: boolean
	/** The last send threw the exact `mint_and_pay_fee` insufficiency assert (pre-inclusion, no hash).
	 *  This is the ONLY retryable no-hash signal - the narrow allow-list (string-matched, no typed selector). */
	setupInsufficiency: boolean
}

export function decidePrivateFuelClaim(e: PrivateFuelClaimEvidence): { action: PrivateFuelClaimAction } {
	if (e.attempt && e.txHashKnown) {
		if (e.receiptStatus === "included" || e.consumed) return { action: "consumed" }
		if (e.receiptStatus === "dropped") return { action: "private-fpc" } // not included ⇒ FJ unconsumed ⇒ retry
		return { action: "wait" } // pending / unprobed / unreachable node - never guess
	}
	if (e.attempt) {
		// Attempt latched but NO tx hash. Durable consumption still settles it; the setup-insufficiency
		// assert is the one retryable case; anything else is unknowable ⇒ wait. NEVER public/Sponsored.
		if (e.consumed) return { action: "consumed" }
		if (e.setupInsufficiency) return { action: "private-fpc" }
		return { action: "wait" }
	}
	return { action: "private-fpc" } // fresh record ⇒ first private claim attempt
}

/** The exact PrivateFPC `mint_and_pay_fee` insufficiency assert (verified in the installed 215fd08
 *  artifact). The narrow retry allow-list string-matches this — there is no typed selector. */
export const PRIVATE_FUEL_INSUFFICIENCY_MSG = "Amount too low to cover gas cost"

/** Classify a private-claim send error as the retryable setup-insufficiency (fail-closed: anything that
 *  doesn't match is NOT retryable). */
export function isPrivateFuelInsufficiency(message: string): boolean {
	return message.includes(PRIVATE_FUEL_INSUFFICIENCY_MSG)
}
