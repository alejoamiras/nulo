import type { BridgeJournalRecord, DepositJournalRecord, WithdrawJournalRecord } from "@nulo/bridge-core"
import type { RecordRuntime } from "@/composables/useBridgeJournal"

/**
 * The ONE narration view-model (plan S3/S10): maps a record + its runtime onto the stepper's
 * phase rail. Phase STATES anchor on persisted FACTS (the monotonic latch — a transiently
 * cleared runtime step between engine rounds can never regress a phase); the runtime only
 * refines WHICH phase inside the fact-bounded zone is active and what its live detail says.
 */

export type PhaseState = "pending" | "active" | "done" | "skipped" | "failed"

export interface BridgePhase {
	key: "seal" | "approve" | "deposit" | "sync" | "claim" | "confirm" | "exit" | "prove" | "finish"
	label: string
	state: PhaseState
	/** Live narration when active/failed (runtime detail or the phase's signing prompt). */
	detail?: string
}

const FAILED_ATTENTIONS = new Set(["error", "unknown-outcome"])

export function stepperPhases(record: BridgeJournalRecord, runtime: RecordRuntime = {}): BridgePhase[] {
	return record.direction === "deposit"
		? depositPhases(record as DepositJournalRecord, runtime)
		: withdrawPhases(record as WithdrawJournalRecord, runtime)
}

function depositPhases(rec: DepositJournalRecord, rt: RecordRuntime): BridgePhase[] {
	const keys: BridgePhase["key"][] = rec.isPrivate
		? ["seal", "approve", "deposit", "sync", "claim", "confirm"]
		: ["approve", "deposit", "sync", "claim", "confirm"]

	// The fact-bounded zone (the latch): runtime can only refine WITHIN it.
	let activeKey: BridgePhase["key"]
	if (rec.claimTxHash) activeKey = "confirm"
	else if (rec.leafIndex) activeKey = rt.step === "unsealing" || rt.step === "sending" ? "claim" : "sync"
	else if (rec.depositTxHash) activeKey = "deposit"
	else if (rt.step === "sealing") activeKey = "seal"
	else if (rt.step === "approving") activeKey = "approve"
	else activeKey = "deposit"

	const labels: Record<string, string> = {
		seal: "SEAL",
		approve: "APPROVE",
		deposit: "DEPOSIT",
		sync: "SYNC",
		claim: "CLAIM",
		confirm: "CONFIRM",
	}
	const prompts: Record<string, string> = {
		seal: "Sign in your Ethereum wallet — encrypts this bridge's recovery secret. No funds move.",
		approve: "Confirm the allowance for the bridge portal in your Ethereum wallet. No funds move yet.",
		deposit: rec.depositTxHash ? "Waiting for the Ethereum confirmation…" : "Confirm the deposit in your Ethereum wallet.",
		sync: "Waiting for Aztec to sync the message — no signature needed.",
		claim:
			rt.step === "unsealing"
				? "Sign in your Ethereum wallet to unseal the recovery secret, then confirm in your Aztec wallet."
				: "Confirm the claim in your Aztec wallet.",
		confirm: "Confirming on Aztec — no signature needed.",
	}

	return buildPhases(keys, labels, prompts, activeKey, rec.completedAt !== undefined, rt)
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
			? `Proven block ${rt.provenBlock} of ${rt.targetBlock} — lands in epoch batches.`
			: "Waiting for Aztec to prove the exit — lands in epoch batches."
	const prompts: Record<string, string> = {
		exit: rec.isPrivate
			? "Confirm the exit in your Aztec wallet (one signature)."
			: "Confirm in your Aztec wallet — two signatures: the authorization, then the exit.",
		prove: proveDetail,
		finish: "Confirm in your Ethereum wallet to release the funds.",
		confirm: "Waiting for the Ethereum confirmation…",
	}

	return buildPhases(keys, labels, prompts, activeKey, rec.completedAt !== undefined, rt)
}

function buildPhases(
	keys: BridgePhase["key"][],
	labels: Record<string, string>,
	prompts: Record<string, string>,
	activeKey: BridgePhase["key"],
	completed: boolean,
	rt: RecordRuntime,
): BridgePhase[] {
	const activeIndex = keys.indexOf(activeKey)
	const failed = !!rt.attention && FAILED_ATTENTIONS.has(rt.attention)
	return keys.map((key, i) => {
		if (completed) return { key, label: labels[key], state: "done" as const }
		if (i < activeIndex) {
			// APPROVE's skipped-vs-done is underivable from facts (plan S15) — the ephemeral
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
			}
		}
		return { key, label: labels[key], state: "pending" as const }
	})
}
