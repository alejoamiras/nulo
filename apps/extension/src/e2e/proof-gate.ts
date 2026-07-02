/**
 * A controllable hold-point for `proveTx`, injected into the SW-side
 * {@link ExecutionCoordinator}.
 *
 * Production injects nothing — the default {@link NOOP_PROOF_GATE} resolves
 * immediately, so proving runs unimpeded. The e2e build injects a gate
 * (backed by `chrome.storage.session`, see `ChromeStorageProofGate`) so a
 * test can deterministically hold a transaction inside its proving stage,
 * observe ordering / cancel behavior, then release it.
 *
 * INVARIANT — the gate replaces the *duration* of proving, not its
 * *interruptibility*. It is awaited inside `ExecutionCoordinator.proveTxTask`,
 * immediately before `pxe.proveTx`, AFTER the coordinator journaled `proving`
 * and BETWEEN the existing pre-/post-prove `checkCancelled` checkpoints. A
 * cancel arriving during the hold is therefore still observed only at the
 * existing post-prove checkpoint — no new cancel checkpoint is introduced,
 * which is what keeps `cancel-mid-prove`'s contract intact.
 *
 * Lives in the SERVICE WORKER (the coordinator), NOT the offscreen document
 * (offscreen documents have a restricted API surface with no `chrome.storage`
 * — that's why `PxeService` reaches the SW via service-client RPC). The SW
 * has full `chrome.storage` access, so the `chrome.storage`-backed
 * implementation works here.
 */
export interface ProofGate {
	/** Resolves when proving may proceed. The default resolves immediately. */
	wait(): Promise<void>
}

/** The production default: never holds. */
export const NOOP_PROOF_GATE: ProofGate = {
	wait: () => Promise.resolve(),
}
