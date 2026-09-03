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
	key: "permit" | "seal" | "approve" | "sign" | "deposit" | "sync" | "register" | "claim" | "confirm" | "exit" | "prove" | "finish"
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
	// A registration of its own is complete the moment its hash exists; the claim is what runs then.
	if (stage === "registering") return "claim"
	// On a first-time private token the next signature registers it; the claim follows on its own.
	const next = registers ? "register" : "claim"
	if (stage === "claimable") return next
	if (stage === "syncing") return rt.step === "unsealing" || rt.step === "sending" ? next : "sync"
	return preDepositKey(rec, rt)
}

/** Nothing has crossed yet: the run is at its FIRST prompt, never at a DEPOSIT that never happened. */
function preDepositKey(rec: DepositRailRecord, rt: RecordRuntime): BridgePhase["key"] {
	if (rec.depositTxHash) return "deposit"
	if (rt.step === "granting") return "permit"
	if (rt.step === "sealing") return "seal"
	if (rt.step === "signing") return "sign"
	if (rt.step === "approving") return "approve"
	if (rt.step === "depositing") return "deposit"
	return rec.isPrivate ? "seal" : "sign"
}

/** What the claim's confirmation does, by what rides in that one transaction. */
const UNSEAL_PROMPT = "Sign in your Ethereum wallet to unseal the recovery secret, then confirm in your Aztec wallet."

function claimPromptOf(fueled: boolean, registersInClaim: boolean): string {
	if (registersInClaim) {
		return fueled
			? "Confirm in your Aztec wallet - one transaction registers the token, then claims your tokens and your gas."
			: "Confirm in your Aztec wallet - one transaction registers the token and claims it."
	}
	return fueled
		? "Confirm in your Aztec wallet - one transaction claims your tokens and your gas."
		: "Confirm the claim in your Aztec wallet."
}

function depositCopy(rec: DepositRailRecord, rt: RecordRuntime, shape: { gasOnly: boolean; fueled: boolean; registersInClaim: boolean }) {
	const { gasOnly, fueled, registersInClaim } = shape
	const symbol = isSendRecord(rec) && rec.token ? rec.token.displaySymbol : "this token"
	const labels: Record<string, string> = {
		permit: "PERMISSION",
		seal: "SEAL",
		approve: "APPROVE",
		sign: "AUTHORIZE",
		deposit: fueled ? "DEPOSIT + FUEL" : "DEPOSIT",
		sync: "CROSSING",
		register: "REGISTER",
		claim: gasOnly ? "CLAIM GAS" : registersInClaim ? "REGISTER + CLAIM" : "CLAIM",
		confirm: "CONFIRM",
	}
	const claimPrompt = claimPromptOf(fueled, registersInClaim)
	const prompts: Record<string, string> = {
		permit: `Allow reading ${symbol} state in your Nulo wallet.`,
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
		register:
			rt.step === "unsealing"
				? UNSEAL_PROMPT
				: "Confirm in your Aztec wallet - this first bridge registers the token; the claim follows on its own.",
		claim: rt.step === "unsealing" ? UNSEAL_PROMPT : claimPrompt,
		confirm: "Confirming on Aztec - no signature needed.",
	}
	const etas: Partial<Record<string, string>> = {
		permit: "your confirmation in Nulo",
		sign: "your signature - instant",
		deposit: "usually under 1 min",
		sync: "usually 1-4 min",
		register: "your signature + a few sec",
		claim:
			rec.isPrivate && isSendRecord(rec) && rec.registerTxHash
				? "a short wait for your wallet to sync, then your signature"
				: "your signature + a few sec",
		confirm: "usually 1-2 min",
	}
	return { labels, prompts, etas }
}

/**
 * The deposit rail, one shape for every deposit record. A send that registers the token says so on
 * its record: a PRIVATE one registers in a transaction of its own, so REGISTER is a phase ahead of
 * CLAIM; a public one registers inside the claim, so CLAIM is relabeled REGISTER + CLAIM. PERMISSION
 * renders only when the wallet's token grant is part of THIS run (being asked now, or granted
 * earlier in the run), and APPROVE only when an approval is: the flows check both silently, so a
 * run that needs neither never sees a step it does not need, and after a reload the ephemeral
 * outcome is gone and the step is simply not shown — honest, because a retry re-checks
 * idempotently.
 */
function depositPhases(rec: DepositRailRecord, rt: RecordRuntime): BridgePhase[] {
	// A gas-only bridge carries Fee Juice, not a token; a fueled one swaps INSIDE the deposit
	// transaction, so there is no separate FUEL phase to flip — DEPOSIT is relabeled instead.
	const gasOnly = assetKindOf(rec) === "fee-juice"
	// A gas slice is DECLARED by a send's intent and EVIDENCED by an older record's fuel block.
	const fueled = !gasOnly && (rec.fuel !== undefined || (isSendRecord(rec) && rec.intent === "token+gas"))
	const registering = isSendRecord(rec) && (rec.registers === true || rec.registerTxHash !== undefined)
	const registers = rec.isPrivate && registering
	const keys: BridgePhase["key"][] = [
		...phaseIf(rt.step === "granting" || rt.grantOutcome === "done", "permit"),
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
	const { labels, prompts, etas } = depositCopy(rec, rt, { gasOnly, fueled, registersInClaim: registering && !rec.isPrivate })
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
