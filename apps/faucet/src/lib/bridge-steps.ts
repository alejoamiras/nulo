import { type BridgeJournalRecord, type DepositJournalRecord, type WithdrawJournalRecord, assetKindOf } from "@nulo/bridge-core"
import type { RecordRuntime } from "@/composables/useBridgeJournal"

/**
 * The ONE narration view-model (plan S3/S10): maps a record + its runtime onto the phase rail
 * BOTH surfaces render (stepper full, journal card compact). Phase STATES anchor on persisted
 * FACTS (the monotonic latch - a transiently cleared runtime step between engine rounds can
 * never regress a phase); the runtime only refines WHICH phase inside the fact-bounded zone is
 * active, its live detail, and its determinate progress.
 */

export type PhaseState = "pending" | "active" | "done" | "skipped" | "failed"

export interface BridgePhase {
	key: "seal" | "approve" | "sign" | "deposit" | "sync" | "claim" | "confirm" | "exit" | "prove" | "finish"
	label: string
	state: PhaseState
	/** Live narration when active/failed (runtime detail or the phase's signing prompt). */
	detail?: string
	/** Determinate within-phase progress - ONLY where a real target exists (SYNC blocks, PROVE
	 *  blocks). Never fabricated: an honest ticking counter beats a fake bar. */
	progress?: { current: number; target: number; fraction: number }
	/** Deliberately OVERESTIMATED duration hint (queue psychology: beat the estimate, never miss it). */
	eta?: string
}

/** L2 blocks between the deposit-time snapshot and presumed message arrival (raven-style pacing). */
export const SYNC_TARGET_MARGIN_BLOCKS = 3

// Every attention fails the active phase: the rail is where the note + the fix-instruction live
// (mismatch/stale states used to render a calm "active" prompt with no note at all).
const FAILED_ATTENTIONS = new Set(["error", "unknown-outcome", "mismatch", "tampered", "unseal-failed", "stale", "stale-deployment"])

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

export function stepperPhases(record: BridgeJournalRecord, runtime: RecordRuntime = {}): BridgePhase[] {
	return record.direction === "deposit"
		? depositPhases(record as DepositJournalRecord, runtime)
		: withdrawPhases(record as WithdrawJournalRecord, runtime)
}

function depositPhases(rec: DepositJournalRecord, rt: RecordRuntime): BridgePhase[] {
	// Fueled deposits SIGN a Permit2 witness instead of APPROVING (the live token pre-approves
	// Permit2). The fuel swap executes INSIDE the deposit transaction, so it is not independently
	// observable (fuel.received lands together with leafIndex) - there is no separate FUEL phase to
	// flip on its own; DEPOSIT is relabeled "DEPOSIT + FUEL" to name the one atomic step.
	// A direct Fuel record (assetKind "fee-juice") carries a `fuel` block but is NOT swap-fueled: it
	// APPROVES the FeeJuicePortal (no Permit2 SIGN) and its claim is gas-only — so it uses the plain
	// approve-based phases with fuel-specific labels, never the "DEPOSIT + FUEL" / SIGN swap shape.
	const isFuel = assetKindOf(rec) === "fee-juice"
	const fueled = rec.fuel !== undefined && !isFuel
	// Every deposit now SIGNS a Permit2 witness and calls the router's bridge()/bridgeWithFuel (the
	// single path). The AZLO token pre-approves canonical Permit2 for every holder, so bridge-only +
	// swap-fueled need no approve. Fuel-only is the exception: the canonical fee asset does NOT
	// pre-approve Permit2, so its FIRST deposit shows a one-time APPROVE (skipped thereafter).
	const keys: BridgePhase["key"][] = [
		...(rec.isPrivate ? (["seal"] as BridgePhase["key"][]) : []),
		...(isFuel ? (["approve"] as BridgePhase["key"][]) : []),
		"sign",
		"deposit",
		"sync",
		"claim",
		"confirm",
	]

	// The fact-bounded zone (the latch): runtime can only refine WITHIN it.
	let activeKey: BridgePhase["key"]
	if (rec.claimTxHash) activeKey = "confirm"
	else if (rec.leafIndex) {
		// Once the gate passed (claimable) the bridge is AT the claim - structurally cleared steps
		// or a post-gate failure must not point back at a visibly-complete crossing.
		activeKey = rt.step === "unsealing" || rt.step === "sending" || rt.claimable === true ? "claim" : "sync"
	} else if (rec.depositTxHash) activeKey = "deposit"
	else if (rt.step === "sealing") activeKey = "seal"
	else if (rt.step === "signing") activeKey = "sign"
	else if (rt.step === "approving") activeKey = "approve"
	else activeKey = "deposit"

	const labels: Record<string, string> = {
		seal: "SEAL",
		approve: "APPROVE",
		sign: "AUTHORIZE",
		deposit: fueled ? "DEPOSIT + FUEL" : "DEPOSIT",
		sync: "CROSSING",
		claim: isFuel ? "CLAIM GAS" : "CLAIM",
		confirm: "CONFIRM",
	}
	const prompts: Record<string, string> = {
		seal: "Sign in your Ethereum wallet - encrypts this bridge's recovery secret. No funds move.",
		approve: "First time only: approve Permit2 for the fee asset in your Ethereum wallet. No funds move yet.",
		deposit: rec.depositTxHash
			? "Waiting for the Ethereum confirmation…"
			: fueled
				? "Confirm the deposit in your Ethereum wallet - the fuel swap rides along in the same transaction."
				: "Confirm the deposit in your Ethereum wallet.",
		sync: "The message is crossing to Aztec - no signature needed.",
		sign: fueled
			? "Sign the bridge intent in your Ethereum wallet - one signature covers the swap and the deposit."
			: "Sign the bridge intent in your Ethereum wallet - one signature authorizes the deposit.",
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
		claim: "your signature + a few sec",
		confirm: "usually 1-5 min",
	}

	// SYNC progress: real blocks against the deposit-time snapshot + margin (the countdown).
	let progress: Partial<Record<string, BridgePhase["progress"]>> = {}
	if (activeKey === "sync" && rec.depositL2Block !== undefined && rt.syncBlock !== undefined) {
		const target = rec.depositL2Block + SYNC_TARGET_MARGIN_BLOCKS
		const span = target - rec.depositL2Block
		progress = {
			sync: {
				current: rt.syncBlock,
				target,
				fraction: span > 0 ? clamp01((rt.syncBlock - rec.depositL2Block) / span) : 1,
			},
		}
	}

	return buildPhases(keys, labels, prompts, etas, progress, activeKey, rec.completedAt !== undefined, rt)
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
): BridgePhase[] {
	const activeIndex = keys.indexOf(activeKey)
	const failed = !!rt.attention && FAILED_ATTENTIONS.has(rt.attention)
	return keys.map((key, i) => {
		if (completed) return { key, label: labels[key], state: "done" as const }
		if (i < activeIndex) {
			// APPROVE's skipped-vs-done is underivable from facts (plan S15) - the ephemeral
			// approveOutcome carries it; absent (post-reload) degrades to a plain done.
			if (key === "approve" && rt.approveOutcome === "skipped") return { key, label: labels[key], state: "skipped" as const }
			return { key, label: labels[key], state: "done" as const }
		}
		if (i === activeIndex) {
			return {
				key,
				label: labels[key],
				state: failed ? ("failed" as const) : ("active" as const),
				detail: failed ? rt.note : (rt.stepDetail ?? prompts[key]),
				progress: progress[key],
				eta: failed ? undefined : etas[key],
			}
		}
		return { key, label: labels[key], state: "pending" as const }
	})
}
