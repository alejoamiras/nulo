/**
 * The activity dock's reading of a record: which group it sits in, the one action it may offer,
 * and the words a two-line row shows. Follows the card's gates exactly (via `RecordState`) so the
 * dock never offers a button the card would not, and in the card's precedence: a completed record
 * is done even while a stale runtime still says busy.
 */
import { type BridgeJournalRecord, type DepositJournalRecord, assetKindOf } from "@nulo/bridge-core"
import type { RecordRuntime } from "@/composables/useBridgeJournal"
import { assetDecimals, assetSymbol, recordTokenBlock } from "@/lib/asset-label"
import { stepperPhases } from "@/lib/bridge-steps"
import { formatBigInt } from "@/lib/format"
import type { RecordState } from "@/lib/record-policy"
import { safeDisplay } from "@/lib/token-display"

export type ActivityGroup = "needs-you" | "running" | "done"
export type ActivityAction = "claim" | "finish" | "retry" | "claim-gas" | "switch" | null

export interface Classified {
	group: ActivityGroup
	action: ActivityAction
}

/** Done records offer only fuel recovery, and only as the card offers it: a switch when the gas
 *  belongs to another granted account, else the standalone claim. */
function doneAction(s: RecordState): ActivityAction {
	if (!s.fuelRecoverable) return null
	return s.ownedByOther ? "switch" : "claim-gas"
}

function openAction(s: RecordState): ActivityAction {
	if (s.showClaim) return s.ownedByOther ? "switch" : s.retry ? "retry" : "claim"
	if (s.showFinish) return s.retry ? "retry" : "finish"
	// Blocked, terminal, or stuck before anything was sent: a decision is owed, but only the card's
	// DISCARD can make it.
	return null
}

export function classify(rec: BridgeJournalRecord, s: RecordState): Classified {
	if (rec.completedAt !== undefined || s.stage === "done") return { group: "done", action: doneAction(s) }
	if (s.busy) return { group: "running", action: null }
	return { group: "needs-you", action: openAction(s) }
}

export interface GroupedRows<T extends { group: ActivityGroup; createdAt: number }> {
	needsYou: T[]
	running: T[]
	done: T[]
}

/** Newest first inside each group. */
export function groupRecords<T extends { group: ActivityGroup; createdAt: number }>(rows: readonly T[]): GroupedRows<T> {
	const by = (g: ActivityGroup) => rows.filter((r) => r.group === g).sort((a, b) => b.createdAt - a.createdAt)
	return { needsYou: by("needs-you"), running: by("running"), done: by("done") }
}

/** Every needs-you row counts, blocked ones included: a decision is owed either way. */
export function needsYouCount(rows: ReadonlyArray<{ group: ActivityGroup }>): number {
	return rows.reduce((n, r) => (r.group === "needs-you" ? n + 1 : n), 0)
}

/** The phase the record is in, as one lower-case word for a row's side slot. */
export function phaseWord(rec: BridgeJournalRecord, rt: RecordRuntime): string {
	const phases = stepperPhases(rec, rt)
	const live = phases.find((p) => p.state === "active" || p.state === "failed") ?? phases.findLast((p) => p.state === "done")
	return (live?.label ?? "").toLowerCase()
}

export function routeWords(rec: BridgeJournalRecord): string {
	return rec.direction === "deposit" ? "ETH → Aztec" : "Aztec → ETH"
}

function buysGas(rec: BridgeJournalRecord): boolean {
	if (rec.direction !== "deposit" || assetKindOf(rec) === "fee-juice") return false
	if ("intent" in rec) return rec.intent === "token+gas"
	return (rec as DepositJournalRecord).fuel !== undefined
}

/** "private + gas" / "public": the visibility and whether a gas leg rides along, as words. */
export function visibilityWords(rec: BridgeJournalRecord): string {
	return `${rec.isPrivate ? "private" : "public"}${buysGas(rec) ? " + gas" : ""}`
}

/** Amount and symbol for a row. The symbol is persisted text a restore file can carry, so it goes
 *  through the same strip-and-cap the token list uses. */
export function rowStrings(rec: BridgeJournalRecord): { amount: string; symbol: string } {
	const kind = assetKindOf(rec)
	const token = recordTokenBlock(rec)
	return {
		amount: formatBigInt(BigInt(rec.amount), assetDecimals(kind, token)),
		symbol: safeDisplay(assetSymbol(kind, rec.isPrivate, token)),
	}
}

export function ageWords(createdAt: number, now: number): string {
	const mins = Math.max(0, Math.round((now - createdAt) / 60_000))
	if (mins < 1) return "just now"
	if (mins < 60) return `${mins}m ago`
	const hours = Math.round(mins / 60)
	return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}
