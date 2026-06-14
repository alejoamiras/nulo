/**
 * A controllable hold-point for `proveTx`.
 *
 * Production injects nothing — the default {@link NOOP_PROOF_GATE} resolves
 * immediately, so proving runs unimpeded. The e2e build injects a gate
 * (backed by `chrome.storage.session` in the extension shell) so a test can
 * deterministically hold a transaction inside its proving stage, observe
 * ordering / cancel behavior, then release it.
 *
 * INVARIANT — the gate replaces the *duration* of proving, not its
 * *interruptibility*. It is awaited at the same boundary the real prover
 * blocks (inside the per-chain write lock, after the execution coordinator
 * has journaled `proving`), so the coordinator's existing post-prove cancel
 * checkpoint still decides cancellation. No new cancel checkpoint is
 * introduced — that is what keeps `cancel-mid-prove`'s contract intact.
 *
 * Kept in `@nulo/aztec-runtime` (chrome-free): the interface is a bare
 * `Promise`-returning method. The `chrome.storage` implementation lives in
 * the extension shell and is threaded in via `PxeOffscreenDeps.proofGate`.
 */
export interface ProofGate {
	/** Resolves when proving may proceed. The default resolves immediately. */
	wait(): Promise<void>
}

/** The production default: never holds. */
export const NOOP_PROOF_GATE: ProofGate = {
	wait: () => Promise.resolve(),
}
