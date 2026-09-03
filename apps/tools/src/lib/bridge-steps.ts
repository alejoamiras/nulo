import {
	type BridgeJournalRecord,
	type DepositJournalRecord,
	type SendDepositRecord,
	type WithdrawJournalRecord,
	assetKindOf,
	deriveSendDepositStage,
	isSendRecord,
} from "@nulo/bridge-core"
import type { RecordRuntime } from "@/composables/useBridgeJournal"

/**
 * The ONE narration view-model (plan S3/S10): maps a record + its runtime onto the phase rail
 * BOTH surfaces render (stepper full, journal card compact). Phase STATES anchor on persisted
 * FACTS (the monotonic latch - a transiently cleared runtime step between engine rounds can
 * never regress a phase); the runtime only refines WHICH phase inside the fact-bounded zone is
 * active, its live detail, and its determinate progress.
 */

export type PhaseState = "pending" | "active" | "done" | "failed"

export interface BridgePhase {
	key: "seal" | "approve" | "sign" | "deposit" | "sync" | "register" | "claim" | "confirm" | "exit" | "prove" | "finish"
	label: string
	state: PhaseState
	/** Live narration when active/failed (runtime detail or the phase's signing prompt). */
	detail?: string
	/** Determinate within-phase progress - ONLY where a real target exists (SYNC blocks, PROVE
	 *  blocks). Never fabricated: an honest ticking counter beats a fake bar. */
	progress?: { current: number; target: number; fraction: number }
	/** Deliberately OVERESTIMATED duration hint (queue psychology: beat the estimate, never miss it). */
	eta?: string
	/** Deposit CONFIRM quiet flip: the claim was seen in a PROPOSED block. The rail renders the
	 *  active dot in the done-family color - display-only evidence, never a completion signal. */
	landed?: boolean
}

/** L2 blocks between the deposit-time snapshot and presumed message arrival (raven-style pacing). */
export const SYNC_TARGET_MARGIN_BLOCKS = 3

// Every attention fails the active phase: the rail is where the note + the fix-instruction live
// (mismatch/stale states used to render a calm "active" prompt with no note at all).
/** Attentions no retry can clear: the underlying fact is immutable (a foreign deployment binding, an
 *  L1 receipt that cannot supply the record's data), so EVERY surface must stop offering CLAIM/RETRY
 *  and stop narrating one. The journal-level Restore stays the recovery path. */
const TERMINAL_ATTENTIONS = new Set(["stale-deployment", "receipt-mismatch", "malformed-record"])

export function isTerminalAttention(attention?: string): boolean {
	return attention !== undefined && TERMINAL_ATTENTIONS.has(attention)
}

const FAILED_ATTENTIONS = new Set([
	"error",
	"unknown-outcome",
	"mismatch",
	"tampered",
	"unseal-failed",
	"stale",
	"stale-deployment",
	"receipt-mismatch",
	"malformed-record",
])

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/** Every deposit shape the rail renders. A send's EXIT rail is the withdraw rail unchanged. */
type DepositRailRecord = DepositJournalRecord | SendDepositRecord

export function stepperPhases(record: BridgeJournalRecord, runtime: RecordRuntime = {}): BridgePhase[] {
	return record.direction === "deposit" ? depositPhases(record, runtime) : withdrawPhases(record as WithdrawJournalRecord, runtime)
}

const phaseIf = (on: boolean, key: BridgePhase["key"]): BridgePhase["key"][] => (on ? [key] : [])

/** SYNC progress against the deposit-time snapshot + margin; empty without both anchors. */
function syncProgress(depositL2Block?: number, syncBlock?: number): Partial<Record<string, BridgePhase["progress"]>> {
	if (depositL2Block === undefined || syncBlock === undefined) return {}
	const target = depositL2Block + SYNC_TARGET_MARGIN_BLOCKS
	const span = target - depositL2Block
	return { sync: { current: syncBlock, target, fraction: span > 0 ? clamp01((syncBlock - depositL2Block) / span) : 1 } }
}

/** Which phase a deposit is at: the persisted stage first, live narration only to pick within a
 *  stage the facts leave ambiguous. */
function depositActiveKey(rec: DepositRailRecord, rt: RecordRuntime, registers: boolean): BridgePhase["key"] {
	const stage = deriveSendDepositStage(rec, { claimable: rt.claimable })
	if (stage === "done" || stage === "claiming") return "confirm"
	if (stage === "registering") return registers ? "register" : "claim"
	if (stage === "claimable") return "claim"
	if (stage === "syncing") return rt.step === "unsealing" || rt.step === "sending" ? "claim" : "sync"
	return preDepositKey(rec, rt)
}

/** Nothing has crossed yet: the run is at its FIRST prompt, never at a DEPOSIT that never happened. */
function preDepositKey(rec: DepositRailRecord, rt: RecordRuntime): BridgePhase["key"] {
	if (rec.depositTxHash) return "deposit"
	if (rt.step === "sealing") return "seal"
	if (rt.step === "signing") return "sign"
	if (rt.step === "approving") return "approve"
	if (rt.step === "depositing") return "deposit"
	return rec.isPrivate ? "seal" : "sign"
}

function depositCopy(rec: DepositRailRecord, rt: RecordRuntime, shape: { gasOnly: boolean; fueled: boolean }) {
	const { gasOnly, fueled } = shape
	const labels: Record<string, string> = {
		seal: "SEAL",
		approve: "APPROVE",
		sign: "AUTHORIZE",
		deposit: fueled ? "DEPOSIT + FUEL" : "DEPOSIT",
		sync: "CROSSING",
		register: "REGISTER",
		claim: gasOnly ? "CLAIM GAS" : "CLAIM",
		confirm: "CONFIRM",
	}
	const prompts: Record<string, string> = {
		seal: "Sign in your Ethereum wallet - encrypts this bridge's recovery secret. No funds move.",
		approve: "First time only: approve Permit2 for this token in your Ethereum wallet. No funds move yet.",
		sign: fueled
			? "Sign the bridge intent in your Ethereum wallet - one signature covers the swap and the deposit."
			: "Sign the bridge intent in your Ethereum wallet - one signature authorizes the deposit.",
		deposit: rec.depositTxHash
			? "Waiting for the Ethereum confirmation…"
			: fueled
				? "Confirm the deposit in your Ethereum wallet - the fuel swap rides along in the same transaction."
				: "Confirm the deposit in your Ethereum wallet.",
		sync: "The message is crossing to Aztec - no signature needed.",
		register: "Confirm in your Aztec wallet - this first bridge registers the token, then claims it.",
		claim:
			rt.step === "unsealing"
				? "Sign in your Ethereum wallet to unseal the recovery secret, then confirm in your Aztec wallet."
				: fueled
					? "Confirm in your Aztec wallet - one transaction claims your tokens and your gas."
					: "Confirm the claim in your Aztec wallet.",
		confirm: "Confirming on Aztec - no signature needed.",
	}
	const etas: Partial<Record<string, string>> = {
		sign: "your signature - instant",
		deposit: "usually under 1 min",
		sync: "usually 1-4 min",
		register: "your signature + a few sec",
		claim: "your signature + a few sec",
		confirm: "usually 1-2 min",
	}
	return { labels, prompts, etas }
}

/**
 * The deposit rail, one shape for every deposit record. REGISTER renders only once this bridge has
 * actually registered the token on Aztec in a transaction of its own — a public first claim
 * registers inside the claim itself, so it never earns a step. APPROVE renders only when an
 * approval is part of THIS run (approving now, or done earlier in the session): the flow checks the
 * allowance silently, so an already-approved account never sees a step it does not need, and after
 * a reload the ephemeral outcome is gone and the step is simply not shown — honest, because a retry
 * re-checks the allowance idempotently.
 */
function depositPhases(rec: DepositRailRecord, rt: RecordRuntime): BridgePhase[] {
	// A gas-only bridge carries Fee Juice, not a token; a fueled one swaps INSIDE the deposit
	// transaction, so there is no separate FUEL phase to flip — DEPOSIT is relabeled instead.
	const gasOnly = assetKindOf(rec) === "fee-juice"
	// A gas slice is DECLARED by a send's intent and EVIDENCED by an older record's fuel block.
	const fueled = !gasOnly && (rec.fuel !== undefined || (isSendRecord(rec) && rec.intent === "token+gas"))
	const registers = rec.isPrivate && isSendRecord(rec) && rec.registerTxHash !== undefined
	const keys: BridgePhase["key"][] = [
		...phaseIf(rec.isPrivate, "seal"),
		...phaseIf(rt.step === "approving" || rt.approveOutcome === "done", "approve"),
		"sign",
		"deposit",
		"sync",
		...phaseIf(registers, "register"),
		"claim",
		"confirm",
	]
	const activeKey = depositActiveKey(rec, rt, registers)
	const { labels, prompts, etas } = depositCopy(rec, rt, { gasOnly, fueled })
	const progress = activeKey === "sync" ? syncProgress(rec.depositL2Block, rt.syncBlock) : {}
	// Hash-scoped: light only for the record's CURRENT claim tx, so a dropped/replaced claim can
	// never inherit a previous attempt's mint dot (any tab).
	const landedConfirm = rt.confirmLandedTxHash !== undefined && rt.confirmLandedTxHash === rec.claimTxHash
	return buildPhases(keys, labels, prompts, etas, progress, activeKey, rec.completedAt !== undefined, rt, landedConfirm)
}

function withdrawPhases(rec: WithdrawJournalRecord, rt: RecordRuntime): BridgePhase[] {
	const keys: BridgePhase["key"][] = ["exit", "prove", "finish", "confirm"]

	const proven = rt.proven === true || (rt.provenBlock !== undefined && rt.targetBlock !== undefined && rt.provenBlock >= rt.targetBlock)
	let activeKey: BridgePhase["key"]
	if (rec.consumeTxHash) activeKey = "confirm"
	else if (rec.exitTxHash) activeKey = proven ? "finish" : "prove"
	else activeKey = "exit"

	const labels: Record<string, string> = { exit: "EXIT", prove: "PROVE", finish: "FINISH", confirm: "CONFIRM" }
	const proveDetail =
		rt.provenBlock !== undefined && rt.targetBlock !== undefined
			? `Proven block ${rt.provenBlock} of ${rt.targetBlock} - lands in epoch batches.`
			: "Waiting for Aztec to prove the exit - lands in epoch batches."
	const prompts: Record<string, string> = {
		exit: rec.isPrivate
			? "Confirm the exit in your Aztec wallet (one signature)."
			: "Confirm in your Aztec wallet - two signatures: the authorization, then the exit.",
		prove: proveDetail,
		finish: "Confirm in your Ethereum wallet to release the funds.",
		confirm: "Waiting for the Ethereum confirmation…",
	}
	const etas: Partial<Record<string, string>> = {
		exit: "your signatures + a few sec",
		prove: "tens of minutes - epoch batches",
		finish: "your signature + ~1 min",
		confirm: "usually under 2 min",
	}

	// PROVE progress: real proven-block counts streamed by the engine.
	let progress: Partial<Record<string, BridgePhase["progress"]>> = {}
	if (activeKey === "prove" && rt.provenBlock !== undefined && rt.targetBlock !== undefined && rt.targetBlock > 0) {
		progress = {
			prove: { current: rt.provenBlock, target: rt.targetBlock, fraction: clamp01(rt.provenBlock / rt.targetBlock) },
		}
	}

	return buildPhases(keys, labels, prompts, etas, progress, activeKey, rec.completedAt !== undefined, rt)
}

function buildPhases(
	keys: BridgePhase["key"][],
	labels: Record<string, string>,
	prompts: Record<string, string>,
	etas: Partial<Record<string, string>>,
	progress: Partial<Record<string, BridgePhase["progress"]>>,
	activeKey: BridgePhase["key"],
	completed: boolean,
	rt: RecordRuntime,
	/** Deposit-only: the withdraw CONFIRM is an L1 wait and never lights the quiet flip. */
	landedConfirm?: boolean,
): BridgePhase[] {
	const activeIndex = keys.indexOf(activeKey)
	const failed = !!rt.attention && FAILED_ATTENTIONS.has(rt.attention)
	return keys.map((key, i) => {
		if (completed) return { key, label: labels[key], state: "done" as const }
		if (i < activeIndex) return { key, label: labels[key], state: "done" as const }
		if (i === activeIndex) return activePhase(key, { labels, prompts, etas, progress, rt, failed, landedConfirm })
		return { key, label: labels[key], state: "pending" as const }
	})
}

function activePhase(
	key: BridgePhase["key"],
	ctx: {
		labels: Record<string, string>
		prompts: Record<string, string>
		etas: Partial<Record<string, string>>
		progress: Partial<Record<string, BridgePhase["progress"]>>
		rt: RecordRuntime
		failed: boolean
		landedConfirm?: boolean
	},
): BridgePhase {
	const { labels, prompts, etas, progress, rt, failed, landedConfirm } = ctx
	return {
		key,
		label: labels[key],
		state: failed ? ("failed" as const) : ("active" as const),
		detail: failed ? rt.note : (rt.stepDetail ?? prompts[key]),
		progress: progress[key],
		eta: failed ? undefined : etas[key],
		...(key === "confirm" && landedConfirm && !failed ? { landed: true } : {}),
	}
}
