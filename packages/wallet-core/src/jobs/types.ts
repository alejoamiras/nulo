/**
 * Phase 2 job types.
 *
 * Stages, progress payloads, and error envelopes used by the durable-job
 * subsystem. Pure types only — no chrome.*, no zod, no PXE imports.
 *
 * The 7-stage FSM is shared across kinds (transfer, dapp_execute, future
 * imports). Each stage's `JobProgress` variant can carry stage-specific
 * extras without bumping the schema (Carry #4 — extensible progress).
 *
 * `JobError` preserves the raw error category from the underlying boundary
 * (PXE / network / user-reject) so Phase 2+ retry policy can classify
 * retryable vs terminal without revisiting the schema (Carry #5).
 */

/**
 * Stages a job can be in. Three are terminal (see {@link TERMINAL_STAGES}).
 *
 * `queued` is a pre-execution holding stage for records created at message
 * arrival before the handler claims them. Used by the wallet-sdk session
 * FIFO surface so concurrent dApp sendTx requests are visible in the
 * activity feed BEFORE their handler runs. Handlers transition queued →
 * pending the moment they claim ownership; the journal-layer mutex on
 * `transitionOperation` ensures a concurrent `cancelJob` can't race with
 * the claim.
 */
export type JobStage = "queued" | "pending" | "simulating" | "proving" | "submitting" | "succeeded" | "failed" | "cancelled"

/**
 * Terminal stages. Records in these stages never transition further; the
 * journal keeps them with `terminalAt` set (Carry #2) so resume sweeps,
 * idempotency dedup, and tombstones in Phase 2+ have a stable record.
 */
export const TERMINAL_STAGES: ReadonlySet<JobStage> = new Set<JobStage>(["succeeded", "failed", "cancelled"])

/** True if `stage` is terminal — i.e. no further transitions are legal. */
export function isTerminal(stage: JobStage): boolean {
	return TERMINAL_STAGES.has(stage)
}

/**
 * Progress payload, discriminated by stage. Adding fields per stage variant
 * does NOT require a schema migration — consumers ignore unknown keys.
 *
 * `proving.enteredProveAt` is the single timestamp used by the resume
 * policy to detect stuck proves (audit found periodic heartbeats from
 * inside BB.wasm prove are not feasible — the prover blocks the JS turn).
 */
export type JobProgress =
	| { stage: "queued" }
	| { stage: "pending" }
	| { stage: "simulating" }
	| { stage: "proving"; enteredProveAt: number }
	| { stage: "submitting"; txHash?: string }
	/**
	 * `txHash` is present for on-chain ops (`transfer`, `dapp_execute`) and
	 * absent for non-tx ops (`token_import`, future imports). The journal
	 * service enforces the kind ↔ txHash mapping in `transitionOperation`
	 * so the structural optionality here can't be misused by a caller.
	 */
	| { stage: "succeeded"; txHash?: string }
	| { stage: "failed" }
	| { stage: "cancelled" }

/**
 * Error envelope. Preserves the raw error category from the underlying
 * boundary so Phase 2+ retry policy can classify retryable vs terminal.
 *
 * `normalizedRaw` is best-effort `JSON.stringify` of the original error,
 * capped at {@link NORMALIZED_RAW_MAX_CHARS}. If serialization itself
 * throws (Proxy traps, getters that throw), the field is `null`.
 */
export interface JobError {
	/**
	 * Category, used by resume + retry policy. Phase 2 emits:
	 * `user_rejected | popup_bound | sw_restart_post_prove |
	 *  stale_on_resume | stuck_proving | network | simulation |
	 *  prover | unknown`.
	 *
	 * Phase 2+ may add categories; consumers MUST tolerate unknown values.
	 */
	kind: string
	/** User-facing message — already humanized; safe to render verbatim. */
	message: string
	/** Best-effort serialized raw error (capped); `null` if unserializable. */
	normalizedRaw: string | null
}

/**
 * Hard cap for {@link JobError.normalizedRaw} in UTF-16 code units
 * (i.e. JavaScript `string.length` — NOT UTF-8 byte length).
 *
 * Multi-byte content (emoji, non-Latin scripts) will land somewhere between
 * 1x and 4x this value when measured as UTF-8 bytes in `chrome.storage`.
 * For the quota-safety goal (avoid runaway error strings blowing the
 * ~10MB session quota), a 4096-char ceiling is conservative enough.
 */
export const NORMALIZED_RAW_MAX_CHARS = 4096
