/**
 * Phase 2 job FSM — pure transition rules.
 *
 * No state ownership here. The journal service in `@nulo/extension` owns
 * records and persistence; this module just answers "is X → Y legal?".
 * That separation keeps the rule table testable without chrome.*, zod,
 * or service-collection wiring.
 *
 * Legal-transitions graph (active → terminal):
 *
 *   pending → simulating → proving → submitting → succeeded
 *      │          │ │         │           │
 *      │          │ └─── (no-prove shortcut: token_import etc.)
 *      └──────────┴───────────┴───────────┴── failed
 *      └──────────┴───────────┘
 *           (cancel only before submit)
 *
 * The `simulating → succeeded` shortcut is for ops that have no on-chain
 * effect (Phase 2.5 token imports, future no-prove imports). The journal
 * service enforces the kind ↔ txHash invariant: only `kind === "token_import"`
 * records may take this edge; `transfer`/`dapp_execute` must go through the
 * full prove + submit path.
 *
 * Terminal stages have no outgoing edges (Carry #2 — kept, not deleted).
 *
 * Submit is the point-of-no-return: once we hand the tx to `sendTxTask` it
 * has been (or will be) broadcast to the mempool. A cancel that lands during
 * `submitting` can no longer prevent the on-chain effect, so admitting
 * `submitting → cancelled` would create a contradictory state in the journal
 * ("cancelled") vs. on-chain reality ("succeeded"). The transition is illegal;
 * `ExecutionService.cancelJob` treats the rejected transition as "too late"
 * and drops the cancel signal silently — the flow then proceeds to its
 * natural `succeeded` / `failed` terminal.
 */

import { type JobStage, isTerminal } from "./types"

const LEGAL_TRANSITIONS: Readonly<Record<JobStage, ReadonlySet<JobStage>>> = {
	pending: new Set<JobStage>(["simulating", "failed", "cancelled"]),
	simulating: new Set<JobStage>(["proving", "succeeded", "failed", "cancelled"]),
	proving: new Set<JobStage>(["submitting", "failed", "cancelled"]),
	submitting: new Set<JobStage>(["succeeded", "failed"]),
	succeeded: new Set<JobStage>(),
	failed: new Set<JobStage>(),
	cancelled: new Set<JobStage>(),
}

/** True if a transition from `from` to `to` is legal under the FSM. */
export function canTransition(from: JobStage, to: JobStage): boolean {
	return LEGAL_TRANSITIONS[from].has(to)
}

/** Thrown by callers that attempt an illegal transition. */
export class IllegalTransitionError extends Error {
	public readonly from: JobStage
	public readonly to: JobStage

	constructor(from: JobStage, to: JobStage) {
		const reason = isTerminal(from) ? `${from} is terminal` : `${from} → ${to} is not in the legal-transitions table`
		super(`Illegal job stage transition: ${from} → ${to} (${reason})`)
		this.name = "IllegalTransitionError"
		this.from = from
		this.to = to
	}
}

/**
 * Asserts the transition is legal, throwing {@link IllegalTransitionError}
 * otherwise. Use this at the journal service boundary before mutating a
 * record so persisted records always reflect a legal path.
 */
export function assertCanTransition(from: JobStage, to: JobStage): void {
	if (!canTransition(from, to)) throw new IllegalTransitionError(from, to)
}

/**
 * Internal control-flow sentinel thrown by an in-flight prove pipeline
 * when the user cancels the job.
 *
 * NEVER CROSSES THE RPC BOUNDARY. Internal-only — execution-service
 * catches it and converts to `JobCancelledError` (from
 * `@nulo/extension-messaging/errors`) at the boundary, which is the
 * structured `WalletError` subclass that round-trips via the existing
 * `toPayload` / `walletErrorFromPayload` plumbing.
 *
 * Phase 2 lossy-cancel semantics: the journal is transitioned to
 * `cancelled` synchronously by `cancelJob()`; the SW-side prove pipeline
 * keeps running until its next AbortSignal checkpoint, at which point it
 * throws this sentinel and unwinds. The catch block recognises the
 * sentinel type and skips the normal failure-marking path (the journal
 * is already in a terminal state).
 */
export class JobCancelledSentinel extends Error {
	public readonly jobId: string

	constructor(jobId: string) {
		super(`Job cancelled: ${jobId}`)
		this.name = "JobCancelledSentinel"
		this.jobId = jobId
	}
}
