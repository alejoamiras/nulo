import type { DepositJournalRecord } from "@nulo/bridge-core"
import type { ResumeVerdict } from "@/lib/resume-validator"

/**
 * The RESUME control flow, extracted pure + dependency-injected so its security-critical ordering
 * is unit-testable without a live wallet (journal-ux plan J4; ledger L8/L15).
 *
 * The ordering is the safety property:
 *  1. validate first (hostile-field + eligibility gate) — refuse before touching anything;
 *  2. everything value-adjacent runs inside the ORIGIN LOCK (cross-tab exclusion);
 *  3. re-read under the lock and abort to the claim/recovery path if a deposit hash appeared;
 *  4. the allowance/approve leg runs BEFORE the latch — an approve is fund-safe and itself
 *     resumable, so a death there must not burn the record's one resume attempt;
 *  5. the WRITE-ONCE latch is taken immediately BEFORE the value-moving deposit prompt — an
 *     ambiguous death after this point leaves the record permanently review-only (a double
 *     deposit has no protocol nullification);
 *  6. the claim is handed off only AFTER the lock releases (runDepositClaim takes the tab-local
 *     record lock; nesting it here would deadlock/no-op).
 */

export interface ResumeRunnerDeps {
	getRecord(id: string): DepositJournalRecord | undefined
	validate(rec: DepositJournalRecord): Promise<ResumeVerdict>
	/** Origin-wide exclusive lock (navigator.locks); fail-closed when unavailable. */
	withLock<T>(name: string, fn: () => Promise<T>): Promise<T>
	/** WRITE-ONCE resume-attempt latch — false if a token already exists (refuse). */
	latch(id: string): boolean
	allowanceSufficient(rec: DepositJournalRecord): Promise<boolean>
	approve(rec: DepositJournalRecord): Promise<void>
	/** The value-moving deposit prompt; returns the tx hash. */
	deposit(rec: DepositJournalRecord): Promise<string>
	/** Persist the deposit hash + clear the failure facts (recovery-eligible from here). */
	onDepositHash(id: string, hash: string): void
	/** Reclassify the record's failure facts after an ambiguous deposit-prompt death. */
	reclassifyUnknownOutcome(rec: DepositJournalRecord): void
	/** Hand off to the claim/recovery engine (called AFTER the lock releases). */
	runClaim(id: string): Promise<void>
	setStep(id: string, step: string | undefined, detail: string | undefined): void
	flagError(id: string, note: string): void
	lockName(id: string): string
}

export type ResumeResult =
	| { status: "ok" }
	| { status: "gone" }
	| { status: "refused"; verdict: Extract<ResumeVerdict, { ok: false }> }
	| { status: "already-attempted" }
	| { status: "error"; message: string }

export async function runResume(id: string, deps: ResumeRunnerDeps): Promise<ResumeResult> {
	const rec0 = deps.getRecord(id)
	if (!rec0) return { status: "gone" }

	const verdict = await deps.validate(rec0)
	if (!verdict.ok) return { status: "refused", verdict }

	let proceed = false
	let refused = false
	try {
		await deps.withLock(deps.lockName(id), async () => {
			const rec = deps.getRecord(id)
			if (!rec) throw new Error("record vanished mid-resume")
			// A concurrent recovery/other-tab already sent the deposit — route to the claim path.
			if (rec.depositTxHash) {
				proceed = true
				return
			}
			deps.setStep(id, "approving", "checking the allowance")
			if (!(await deps.allowanceSufficient(rec))) await deps.approve(rec)

			// Re-read immediately before the value-moving prompt (cross-tab / recovery race).
			const reRead = deps.getRecord(id)
			if (!reRead) throw new Error("record vanished mid-resume")
			if (reRead.depositTxHash) {
				proceed = true
				return
			}
			// WRITE-ONCE latch right before the deposit prompt: ambiguity past here is permanent.
			if (!deps.latch(id)) {
				deps.flagError(id, "A resume was already attempted for this bridge - check your wallet activity.")
				refused = true
				return
			}
			deps.setStep(id, "depositing", "confirm the deposit in your Ethereum wallet")
			let hash: string
			try {
				hash = await deps.deposit(reRead)
			} catch (e) {
				// Latched + no hash ⇒ the tx MAY have broadcast: unknown-outcome, permanent review-only.
				deps.reclassifyUnknownOutcome(reRead)
				throw e
			}
			deps.onDepositHash(id, hash)
			proceed = true
		})
	} catch (e) {
		return { status: "error", message: e instanceof Error ? e.message : String(e) }
	}

	if (refused) return { status: "already-attempted" }
	if (proceed) {
		deps.setStep(id, undefined, undefined)
		await deps.runClaim(id)
		return { status: "ok" }
	}
	return { status: "error", message: "resume did not proceed" }
}
