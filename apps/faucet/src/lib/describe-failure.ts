import type { DepositFailedLeg, DepositFailedOutcome, DepositJournalRecord } from "@nulo/bridge-core"

/**
 * Honest, consequence-first copy for a deposit's persisted failure (journal-ux plan C/J3).
 *
 * The card used to derive a stage from outputs alone, so an approve-stage death rendered as "the
 * deposit never confirmed" — false, and it hid that no funds had moved. This maps the persisted
 * (leg × outcome) facts to a headline + a plain-language consequence, so the card can tell the
 * truth after a reload. `tone` drives the visual: `safe` = provably nothing moved, `unknown` =
 * a deposit may have broadcast (hedge, never claim safety), `recoverable` = a tx exists and the
 * engine can finish it.
 */

export type FailureTone = "safe" | "unknown" | "recoverable"

export interface FailureCopy {
	headline: string
	consequence: string
	tone: FailureTone
}

const LEG_NAME: Record<DepositFailedLeg, string> = {
	sealing: "encrypting the recovery secret",
	signing: "signing the bridge authorization",
	approving: "approving the token allowance",
	depositing: "sending the deposit",
}

export function describeDepositFailure(rec: DepositJournalRecord): FailureCopy | null {
	const leg = rec.failedLeg
	const outcome: DepositFailedOutcome | undefined = rec.failedOutcome
	if (!leg || !outcome) return null

	if (outcome === "recoverable") {
		return {
			headline: "Deposit sent — not yet claimed",
			consequence: "Your deposit is on Ethereum; the claim on Aztec was interrupted. Press CLAIM to finish it.",
			tone: "recoverable",
		}
	}
	if (outcome === "unknown-outcome") {
		return {
			headline: "Deposit may have been sent",
			consequence:
				"The wallet was asked to send the deposit but no transaction was recorded here. Check your Ethereum wallet activity — " +
				"if the deposit appears there, paste its transaction id below and this bridge will finish. Do NOT re-send blindly.",
			tone: "unknown",
		}
	}
	// no-funds-moved
	return {
		headline: `Stopped while ${LEG_NAME[leg]}`,
		consequence:
			leg === "approving"
				? "No funds moved — an approval only grants permission. Your allowance is set, so continuing skips this step."
				: leg === "signing"
					? "No funds moved — a signature only authorizes; nothing was sent."
					: leg === "sealing"
						? "No funds moved — this only encrypted the recovery secret before anything was sent."
						: "No funds moved — the deposit was never broadcast.",
		tone: "safe",
	}
}
