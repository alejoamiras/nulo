import type { DepositFailedLeg, DepositFailedOutcome, DepositJournalRecord } from "@nulo/bridge-core"
import { describe, expect, it } from "vitest"
import { describeDepositFailure } from "./describe-failure"

function rec(failedLeg?: DepositFailedLeg, failedOutcome?: DepositFailedOutcome): DepositJournalRecord {
	return { direction: "deposit", failedLeg, failedOutcome } as DepositJournalRecord
}

describe("describeDepositFailure — the (leg × outcome) copy table", () => {
	it("returns null when no failure is persisted", () => {
		expect(describeDepositFailure(rec())).toBeNull()
		expect(describeDepositFailure(rec("approving", undefined))).toBeNull()
	})

	it("every no-funds-moved leg says so plainly, tone safe", () => {
		for (const leg of ["sealing", "signing", "approving", "depositing"] as DepositFailedLeg[]) {
			const c = describeDepositFailure(rec(leg, "no-funds-moved"))
			expect(c?.tone).toBe("safe")
			expect(c?.consequence).toMatch(/no funds moved/i)
		}
	})

	it("the approve case tells the user the allowance is set (skips next time)", () => {
		expect(describeDepositFailure(rec("approving", "no-funds-moved"))?.consequence).toMatch(/allowance is set/i)
	})

	it("unknown-outcome hedges, tells the user to check wallet activity, and warns against re-sending", () => {
		const c = describeDepositFailure(rec("depositing", "unknown-outcome"))
		expect(c?.tone).toBe("unknown")
		expect(c?.consequence).toMatch(/check your ethereum wallet activity/i)
		expect(c?.consequence).toMatch(/do not re-send|do NOT re-send/i)
		expect(c?.headline).toMatch(/may have been sent/i)
	})

	it("recoverable points at CLAIM, tone recoverable", () => {
		const c = describeDepositFailure(rec("depositing", "recoverable"))
		expect(c?.tone).toBe("recoverable")
		expect(c?.consequence).toMatch(/press claim/i)
	})
})
