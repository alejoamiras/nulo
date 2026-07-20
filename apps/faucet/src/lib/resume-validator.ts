import type { DepositJournalRecord } from "@nulo/bridge-core"
import { assetKindOf } from "@nulo/bridge-core"

/**
 * The RESUME eligibility + hostile-field gate (journal-ux plan J2; ledger L5–L8, L14–L17).
 *
 * The journal is attacker-influenceable localStorage and a resume feeds its fields into an
 * on-chain spend, so EVERY resume passes this validator first. What each layer buys:
 *  - the eligibility matrix keeps un-resumable shapes out (anything with a hash routes to the
 *    engine's recovery; an attempt-latched or unknown-outcome record is permanently review-only;
 *    legacy records without persisted failure facts get no resume affordance at all);
 *  - the secret recompute binds the journaled SECRET to the record id (the id IS the secretHash)
 *    — it does NOT authenticate recipient/amount (public secrets are random), which is why
 *  - the connected-recipient equality (public AND private) plus the caller's explicit
 *    review-consent step carry the intent authentication, and
 *  - private records must carry their sealed envelope (the authoritative copy) — a sealing-death
 *    BEFORE an envelope exists is redo-only, because re-sealing would authenticate whatever the
 *    journal says by then.
 *
 * Hashers are injected so this module stays pure and its fuzz table runs bb-free; production
 * wires the real aztec.js crypto.
 */

export type ResumeVariant = "direct-fuel-public" | "direct-fuel-private" | "plain-token" | "fueled-public" | "fueled-private"

export type ResumeVerdict =
	| { ok: true; variant: ResumeVariant }
	| {
			ok: false
			/** What the card may offer instead: "redo" ONLY when no-funds-moved is proven; "review-only"
			 *  when the outcome is (or has become) unknowable; "none" for shapes that already have a
			 *  different path (recovery, claim) or nothing at all (legacy). */
			affordance: "redo" | "review-only" | "none"
			reason: string
	  }

export interface ResumeContext {
	/** The CURRENTLY connected Aztec account (lowercased compare), or null when disconnected. */
	connectedAztec: string | null
	/** The CURRENT deployment binding expected for this record's asset kind. */
	deployment: { chainId: number; portal: string; bridge: string }
	/** Which variants have a landed resume runner (J4 wires direct fuel + plain token; J5 adds fueled-public). */
	enabledVariants: ReadonlySet<ResumeVariant>
}

export interface ResumeHashers {
	/** computeSecretHash over a journaled secret hex → secret-hash hex (public / plain-token). */
	computeSecretHashHex(secretHex: string): Promise<string>
	/** privateFuelSecretHash(salt, claimer) → secret-hash hex — the PRIVATE direct-fuel id derivation
	 *  (NOT computeSecretHash(deriveBridgeSecret): the private path uses a distinct hash). */
	privateFuelSecretHashHex(saltHex: string, claimerAddressHex: string): Promise<string>
}

const HEX = /^0x[0-9a-fA-F]+$/
const MAX_AMOUNT = 2n ** 120n // generous ceiling; a journal claiming more is tampered or corrupt.

function reject(affordance: "redo" | "review-only" | "none", reason: string): ResumeVerdict {
	return { ok: false, affordance, reason }
}

/**
 * Cheap SYNC predicate for the card: does this record have the pre-deposit, proven-safe,
 * not-yet-attempted shape a RESUME button should show for? It is the eligibility half of
 * `validateResume` without the async secret recompute — the click still runs the full
 * authoritative `validateResume` (via the resume runner), so this only decides button VISIBILITY,
 * never authorizes a spend.
 */
export function resumeEligibleShape(rec: DepositJournalRecord): boolean {
	return (
		rec.direction === "deposit" &&
		!rec.completedAt &&
		!rec.depositTxHash &&
		!rec.leafIndex &&
		!rec.claimTxHash &&
		rec.resumeAttemptAt === undefined &&
		rec.failedOutcome === "no-funds-moved" &&
		rec.failedLeg !== undefined
	)
}

export function resumeVariantOf(rec: DepositJournalRecord): ResumeVariant {
	if (assetKindOf(rec) === "fee-juice") return rec.isPrivate ? "direct-fuel-private" : "direct-fuel-public"
	if (rec.fuel) return rec.isPrivate ? "fueled-private" : "fueled-public"
	return "plain-token"
}

export async function validateResume(rec: DepositJournalRecord, ctx: ResumeContext, hashers: ResumeHashers): Promise<ResumeVerdict> {
	// ── Eligibility matrix (shape before content) ────────────────────────────
	if (rec.direction !== "deposit") return reject("none", "not a deposit record")
	if (rec.completedAt) return reject("none", "already completed")
	if (rec.depositTxHash) return reject("none", "deposit already sent - the recovery path owns this record")
	if (rec.leafIndex || rec.claimTxHash) return reject("none", "deposit leg already finished - the claim path owns this record")
	if (rec.resumeAttemptAt !== undefined) {
		return reject("review-only", "a resume was already attempted - the outcome is unknowable without chain proof")
	}
	if (rec.failedOutcome === "unknown-outcome") {
		return reject("review-only", "a deposit prompt was issued and no transaction was recorded - the outcome is unknowable")
	}
	if (rec.failedOutcome !== "no-funds-moved" || !rec.failedLeg) {
		// Legacy / factless records: nothing proves the death was fund-safe. No resume, no redo
		// button - manual discard + a fresh submission remains their path.
		return reject("none", "no persisted proof that this record's failure moved no funds")
	}

	// ── Variant gating ────────────────────────────────────────────────────────
	const variant = resumeVariantOf(rec)
	if (variant === "fueled-private") {
		// Its seal doesn't authenticate the fuel fields - deferred (plan L10). Proven-safe death ⇒ redo.
		return reject("redo", "private fueled bridges can't resume yet - redo with a fresh submission")
	}
	if (!ctx.enabledVariants.has(variant)) {
		return reject("redo", `resume for ${variant} isn't available yet - redo with a fresh submission`)
	}

	// ── Deployment pins ───────────────────────────────────────────────────────
	if (rec.chainId !== ctx.deployment.chainId) return reject("redo", "recorded on a different chain than the current deployment")
	if (
		rec.portal.toLowerCase() !== ctx.deployment.portal.toLowerCase() ||
		rec.bridge.toLowerCase() !== ctx.deployment.bridge.toLowerCase()
	) {
		return reject("redo", "recorded against a different deployment - stale portal/bridge binding")
	}

	// ── Hostile-field content gate ────────────────────────────────────────────
	let amount: bigint
	try {
		amount = BigInt(rec.amount)
	} catch {
		return reject("none", "amount is not a valid integer")
	}
	if (amount <= 0n || amount > MAX_AMOUNT) return reject("none", "amount out of bounds")
	if (!HEX.test(rec.recipient) || rec.recipient.length !== 66) return reject("none", "recipient is not a valid Aztec address")
	if (!HEX.test(rec.id) || !HEX.test(rec.secretHashHex) || rec.secretHashHex !== rec.id) {
		return reject("none", "record id / secret hash mismatch")
	}

	// ── Intent guards ─────────────────────────────────────────────────────────
	if (!ctx.connectedAztec || ctx.connectedAztec.toLowerCase() !== rec.recipient.toLowerCase()) {
		return reject("none", "connect the Aztec account this deposit was meant for")
	}
	if (rec.isPrivate && !rec.sealedEnvelope) {
		return reject("redo", "no sealed envelope exists for this private record - redo with a fresh submission")
	}

	// ── Secret binding (the id IS the secretHash) ─────────────────────────────
	if (variant === "direct-fuel-private") {
		const salt = rec.fuel?.bridgeSecretSalt
		if (!salt || !HEX.test(salt)) return reject("none", "private fuel record is missing its bridge-secret salt")
		const recomputed = await hashers.privateFuelSecretHashHex(salt, rec.recipient)
		if (recomputed.toLowerCase() !== rec.id.toLowerCase())
			return reject("none", "the journaled salt does not produce this record's secret hash")
	} else {
		const secret = variant === "direct-fuel-public" ? (rec.fuel?.secret ?? rec.secret) : rec.secret
		if (!secret || !HEX.test(secret)) return reject("none", "record is missing its claim secret")
		const recomputed = await hashers.computeSecretHashHex(secret)
		if (recomputed.toLowerCase() !== rec.id.toLowerCase())
			return reject("none", "the journaled secret does not produce this record's secret hash")
	}

	return { ok: true, variant }
}
