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
	| "own-gas" // fuel is gone (consumed by our included attempt, or user chose to skip it).
	| "own-gas-plus-standalone-fj" // fee spike: the token claim pays from the wallet's own gas AND the FJ is claimed standalone.
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

	// The user's explicit, non-destructive escape: the token claim pays from the wallet's own gas; the FJ message (if
	// unconsumed) stays claimable later - fuel is never marked abandoned.
	if (e.userOverride) return { action: "own-gas", offerManual: false }

	// Trigger 1 - our own receipt is ground truth: an INCLUDED fjwc attempt consumed the FJ
	// message regardless of app-phase outcome. Never re-embed a consumed claim.
	if (e.attempt && e.txHashKnown) {
		// A conclusive `dropped` overrides even a (prematurely) persisted consumed flag: a dropped
		// tx consumed nothing, so retry fjwc.
		if (e.receiptStatus === "dropped") return { action: "fjwc", offerManual }
		if (e.receiptStatus === "included" || e.consumed) return { action: "own-gas", offerManual: false }
		// Pending or unprobed (incl. an unreachable node): the tx may still land - wait, never guess.
		return { action: "wait", offerManual }
	}

	// Attempt latched but the wallet never returned a hash (crash mid-prompt): the tx MAY have
	// been sent. A durable consumed flag still settles it; otherwise unknowable ⇒ wait (the manual
	// escape resolves it safely - own gas works whether or not the unknown tx consumed the fuel).
	if (e.attempt) return e.consumed ? { action: "own-gas", offerManual: false } : { action: "wait", offerManual }

	// Trigger 2 - fee insufficiency from two record-local quantities: the claimed fuel cannot
	// cover its own claim tx. Claim the token from the wallet's own gas AND land the FJ as balance standalone.
	if (e.fuelReceived !== undefined && e.currentMinFee !== undefined && e.fuelReceived < e.currentMinFee * FUEL_FEE_MARGIN) {
		return { action: "own-gas-plus-standalone-fj", offerManual: false }
	}

	return { action: "fjwc", offerManual }
}

/**
 * The PRIVATE fuel-claim ladder (plan L11, codex 019ec69a "Option A"): a fully SEPARATE decider from
 * the public one above. Its action type makes the privacy invariant structural — it can NEVER return
 * `own-gas` / `own-gas-plus-standalone-fj` (those would link the user). The private claim's fee is
 * always the Wonderland PrivateFPC method; recovery retries that method only, never public.
 *
 * Positive-evidence-only, same as the public ladder:
 *  - an INCLUDED attempt (or a durable `consumed`) burned the FJ at the FPC (the `mint_and_pay_fee`
 *    setup is non-revertible) ⇒ `consumed`: do NOT re-mint (a second claim double-spends the message);
 *  - a conclusively `dropped` attempt landed nothing ⇒ retry the private claim;
 *  - the ONE retryable no-hash case is a pre-inclusion `mint_and_pay_fee` setup-insufficiency (the
 *    "Amount too low to cover gas cost" assert makes the bundled tx invalid, so the FJ stays unconsumed);
 *  - everything else ambiguous WAITS. Never public on any branch.
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
	/** The last attempt latch is older than PRIVATE_ATTEMPT_STALE_MS (or has no timestamp — every
	 *  pre-fix record). Unstales the "wait" limbo: a vanished tx whose receipt reads "pending"
	 *  forever (node never reports "dropped") would otherwise deadlock the claim with no escape.
	 *  Safe because the retry is SIMULATE-gated: a claim whose FJ message was actually consumed
	 *  fails the engine's simulate authority and is never re-sent — aging out can only re-attempt
	 *  provably-unconsumed messages (or surface the consumed state via the simulate error). */
	attemptAgedOut: boolean
}

/** How long a private claim attempt may sit in receipt limbo before the retry path re-opens. */
export const PRIVATE_ATTEMPT_STALE_MS = 15 * 60_000

export function decidePrivateFuelClaim(e: PrivateFuelClaimEvidence): { action: PrivateFuelClaimAction } {
	if (e.attempt && e.txHashKnown) return decideHashedAttempt(e)
	if (e.attempt) return decideHashlessAttempt(e)
	return { action: "private-fpc" } // fresh record ⇒ first private claim attempt
}

/** Attempt latched AND the tx hash is known — receipt evidence drives the call. */
function decideHashedAttempt(e: PrivateFuelClaimEvidence): { action: PrivateFuelClaimAction } {
	if (e.receiptStatus === "included" || e.consumed) return { action: "consumed" }
	if (e.receiptStatus === "dropped") return { action: "private-fpc" } // not included ⇒ FJ unconsumed ⇒ retry
	// Pending / unprobed / unreachable node: a FRESH attempt may still land - wait, never guess.
	// An AGED-OUT attempt re-opens the retry (the engine's simulate gate is the double-spend
	// authority; see attemptAgedOut).
	return e.attemptAgedOut ? { action: "private-fpc" } : { action: "wait" }
}

/** Attempt latched but NO tx hash. Durable consumption still settles it; the setup-insufficiency
 *  assert is the one retryable case; anything else waits until the latch ages out (the wallet
 *  may still return / the tx may still land within the stale window). NEVER public. */
function decideHashlessAttempt(e: PrivateFuelClaimEvidence): { action: PrivateFuelClaimAction } {
	if (e.consumed) return { action: "consumed" }
	if (e.setupInsufficiency) return { action: "private-fpc" }
	return e.attemptAgedOut ? { action: "private-fpc" } : { action: "wait" }
}

/**
 * Whether to UNBLOCK a NO-fuel bridge claim (the "arrive with gas" toggle OFF), as a pure decision. A
 * no-fuel claim has no fresh L1→L2 Fee-Juice message to consume, so it self-pays from gas the account
 * already holds — public Fee Juice OR the private balance a prior private fuel claim credited at the
 * PrivateFPC. The tools app does NOT pre-select a method: it only decides whether the account has gas to
 * reach the wallet's fee picker, which then selects Public OR Private Fee Juice (or Sponsored). This
 * mirrors the long-standing public path (`fee = undefined` → wallet chooses), now extended so PRIVATE
 * FJ also counts as "has gas" (it's selectable in the picker via `pay_fee`).
 *
 * **Fail-closed reads:** a balance is `bigint | null` where `null` = the read THREW (≠ a real zero). A
 * transient read failure must never fabricate spendable balance NOR a false "no gas": with no KNOWN gas
 * in either balance, `null` in either input yields `unverifiable` (surface "couldn't check — retry"),
 * not `none`.
 */
export type NoFuelClaimGate =
	| "allow" // the account holds gas in at least one balance - unblock; the wallet's picker selects the method.
	| "unverifiable" // a balance read failed and no KNOWN balance holds gas - fail closed ("couldn't check").
	| "none" // both balances known + zero - a truly cold account.

export interface NoFuelClaimGateInputs {
	/** Public Fee Juice balance (base units), or `null` if the `balance_of_public` read FAILED. */
	publicFeeJuice: bigint | null
	/** Private Fee Juice at the PrivateFPC (base units, via `balance_of`), or `null` if that read FAILED. */
	privateFeeJuice: bigint | null
}

export function decideNoFuelClaimGate(i: NoFuelClaimGateInputs): NoFuelClaimGate {
	// Any KNOWN gas (in either balance) unblocks — the wallet's fee picker handles selection + the real
	// sufficiency check, exactly as the public path always has. `> 0` matches the original cold-check.
	if ((i.publicFeeJuice ?? 0n) > 0n || (i.privateFeeJuice ?? 0n) > 0n) return "allow"
	// No KNOWN gas. If either read failed, the unknown balance might hold gas - fail closed, don't block.
	if (i.publicFeeJuice === null || i.privateFeeJuice === null) return "unverifiable"
	return "none" // both known + zero.
}

/** The exact PrivateFPC `mint_and_pay_fee` insufficiency assert (verified in the installed 215fd08
 *  artifact). The narrow retry allow-list string-matches this — there is no typed selector. */
export const PRIVATE_FUEL_INSUFFICIENCY_MSG = "Amount too low to cover gas cost"

/** Classify a private-claim send error as the retryable setup-insufficiency (fail-closed: anything that
 *  doesn't match is NOT retryable). */
export function isPrivateFuelInsufficiency(message: string): boolean {
	return message.includes(PRIVATE_FUEL_INSUFFICIENCY_MSG)
}

/**
 * Which fuel ladder a deposit's claim may use — the L11 privacy fence as a routing decision.
 *
 * The two ladders are NOT interchangeable: the public one claims the bridged Fee Juice with a
 * publicly-visible tx, which deanonymizes a private bridge. So a private record whose
 * private-claim metadata is incomplete — `bridgeSecretSalt` is optional in persisted and backup
 * records, so legacy, partially-restored or tampered ones exist — must FAIL CLOSED instead of
 * falling through to the public ladder, which is what it did before.
 *
 * A private deposit with NO fuel block is unaffected: it never bridged Fee Juice, so there is no
 * FJ claim to protect and its claim pays the wallet's own way exactly as before.
 */
export type FuelLadder =
	| "private" // PrivateFPC mint_and_pay_fee — the only ladder a private FUELED record may use.
	| "public" // the own-gas/fjwc/standalone ladder (or the no-fuel fee path): never a private fueled record.
	| "private-incomplete" // private + fueled but missing claim metadata: refuse BOTH ladders.

export interface FuelLadderInputs {
	isPrivate: boolean
	/** With `intent`, the DURABLE "this deposit bought fuel" marker — see {@link boughtFuel}. */
	schema: 1 | 2 | 3
	/** Schema-3 records carry their intent; only a gas-buying one is expected to hold a fuel block. */
	intent?: "token" | "token+gas" | "gas"
	fuel?: { received?: string; leafIndex?: string; bridgeSecretSalt?: string }
}

/**
 * Whether the deposit bought fuel, read from the record's durable shape rather than the fuel
 * block's presence: a fueled record whose block was lost is corrupted and still has a live FJ
 * message, and classifying it by the block's absence alone would send it down the public ladder.
 * Schema 2 is fueled by definition; schema 3 says so through its intent; schema 1 never is.
 */
export function boughtFuel(i: Pick<FuelLadderInputs, "schema" | "intent">): boolean {
	if (i.schema === 2) return true
	if (i.schema === 3) return i.intent !== undefined && i.intent !== "token"
	return false
}

export function decideFuelLadder(i: FuelLadderInputs): FuelLadder {
	if (!i.isPrivate) return "public"
	// Only a genuine no-fuel private deposit has no FJ to protect.
	if (!i.fuel) return boughtFuel(i) ? "private-incomplete" : "public"
	const f = i.fuel
	return f.received && f.leafIndex && f.bridgeSecretSalt ? "private" : "private-incomplete"
}

/**
 * Whether the PUBLIC standalone gas recovery ("CLAIM YOUR GAS") applies to a record — the single
 * source both the card's affordance and the action's own guard read, so the button and the function
 * can never disagree.
 *
 * A private claim pays for itself with the bridged FJ inside the completing tx, so on a COMPLETED
 * well-formed private record the fuel is spent and an unlatched `consumed` is a stale flag, not
 * stranded gas — silence is correct. The incomplete case is the one that must SAY something: its
 * fuel state is genuinely unknown, and the public recovery still must not be offered.
 */
export type StandaloneFuelRecovery =
	| "offer" // public record, completed, fuel bridged and not yet settled.
	| "none" // nothing to recover: no fuel, a direct-Fuel record, unfinished, or already settled.
	| "private-settled" // private + well-formed: its FJ paid for the completing tx. Say nothing.
	| "private-unknown" // private + metadata gaps: never an offer, and the card has no action to advertise.

export interface StandaloneFuelRecoveryInputs {
	isPrivate: boolean
	/** A direct-Fuel record's completion IS its gas claim — never offer a re-claim for one. */
	isFeeJuiceAsset: boolean
	schema: 1 | 2 | 3
	intent?: FuelLadderInputs["intent"]
	completedAt?: number
	fuel?: {
		received?: string
		leafIndex?: string
		bridgeSecretSalt?: string
		consumed?: boolean
		standaloneClaimed?: boolean
	}
}

export function decideStandaloneFuelRecovery(i: StandaloneFuelRecoveryInputs): StandaloneFuelRecovery {
	const f = i.fuel
	if (i.isFeeJuiceAsset) return "none"
	if (!f?.received && !(i.isPrivate && boughtFuel(i))) return "none"
	if (i.completedAt === undefined) return "none" // an unfinished claim retries via the normal action.
	if (f?.consumed === true || f?.standaloneClaimed === true) return "none"
	if (!i.isPrivate) return f?.received ? "offer" : "none"
	return decideFuelLadder({ isPrivate: true, schema: i.schema, intent: i.intent, fuel: f }) === "private"
		? "private-settled"
		: "private-unknown"
}

/** The terminal record/receipt mismatch: the L1 receipt cannot supply this record's fuel data, so a
 *  retry repeats the same immutable failure forever. Matched by the engine to mark the record
 *  terminally rather than as a retryable error. */
export const RECEIPT_RECORD_MISMATCH_MSG = "receipt doesn't match its record"

export function isReceiptRecordMismatch(message: string): boolean {
	return message.includes(RECEIPT_RECORD_MISMATCH_MSG)
}
