import { describe, expect, it } from "vitest"
import type { DepositJournalRecord } from "./index"
import {
	CLEAR_FAILURE_FACTS,
	classifyDepositFailure,
	type DepositFailedLeg,
	type KV,
	patchRecord,
	upsertRecord,
	loadJournal,
} from "./index"

function memKV(): KV {
	const m = new Map<string, string>()
	return {
		getItem: (k) => m.get(k) ?? null,
		setItem: (k, v) => void m.set(k, v),
		removeItem: (k) => void m.delete(k),
	}
}

describe("classifyDepositFailure — the (leg × evidence) → consequence table", () => {
	const PRE_SEND_LEGS: DepositFailedLeg[] = ["sealing", "signing", "approving"]

	it("every pre-send leg is PROVEN no-funds-moved (prompt state is irrelevant)", () => {
		for (const leg of PRE_SEND_LEGS) {
			for (const depositPromptIssued of [false, true]) {
				expect(classifyDepositFailure({ leg, depositPromptIssued, hasDepositTxHash: false })).toEqual({
					failedLeg: leg,
					failedOutcome: "no-funds-moved",
				})
			}
		}
	})

	it("depositing WITHOUT a dispatched prompt is still no-funds-moved (died in setup)", () => {
		expect(classifyDepositFailure({ leg: "depositing", depositPromptIssued: false, hasDepositTxHash: false })).toEqual({
			failedLeg: "depositing",
			failedOutcome: "no-funds-moved",
		})
	})

	it("depositing with a dispatched prompt and NO hash is unknown-outcome — never fund-safe", () => {
		expect(classifyDepositFailure({ leg: "depositing", depositPromptIssued: true, hasDepositTxHash: false })).toEqual({
			failedLeg: "depositing",
			failedOutcome: "unknown-outcome",
		})
	})

	it("a persisted hash dominates every leg and prompt state: recoverable", () => {
		for (const leg of [...PRE_SEND_LEGS, "depositing"] as DepositFailedLeg[]) {
			for (const depositPromptIssued of [false, true]) {
				expect(classifyDepositFailure({ leg, depositPromptIssued, hasDepositTxHash: true })).toEqual({
					failedLeg: "depositing",
					failedOutcome: "recoverable",
				})
			}
		}
	})
})

describe("CLEAR_FAILURE_FACTS", () => {
	it("genuinely removes the persisted fields through patchRecord (undefined keys drop in the JSON write)", () => {
		const kv = memKV()
		upsertRecord(kv, {
			schema: 1,
			id: "0xrec",
			direction: "deposit",
			isPrivate: false,
			amount: "1",
			createdAt: 1,
			updatedAt: 1,
			chainId: 1,
			portal: "0xp",
			bridge: "0xb",
			recipient: "0xr",
			secretHashHex: "0xrec",
			failedLeg: "approving",
			failedOutcome: "no-funds-moved",
			failedAt: 123,
		} as DepositJournalRecord)
		patchRecord(kv, "0xrec", CLEAR_FAILURE_FACTS)
		const rec = loadJournal(kv).find((r) => r.id === "0xrec") as DepositJournalRecord
		expect("failedLeg" in rec).toBe(false)
		expect("failedOutcome" in rec).toBe(false)
		expect("failedAt" in rec).toBe(false)
	})
})
