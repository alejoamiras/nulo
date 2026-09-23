/**
 * A controllable hold-point inside the SW-side backup-restore path, so an e2e
 * test can deterministically crash the worker while a restore RPC is
 * genuinely in flight at a KNOWN phase.
 *
 * Production injects nothing — the default {@link NOOP_RESTORE_GATE} resolves
 * immediately. The e2e build injects a `chrome.storage.session`-backed gate
 * (see `ChromeStorageRestoreGate`) at two hold points:
 *
 *  - `"service-restore"` — inside `ContactService.restore`, late in the
 *    import's pre-finalize per-service loop;
 *  - `"account-state"` — inside `AccountStateService.restore`, which only
 *    runs after `finalizeRestore`, so a hold here is post-finalize by
 *    construction.
 *
 * Protocol (three states, so "armed" is never mistaken for "reached"): the
 * test ARMS by writing `{ at }`; the matching handler ACKNOWLEDGES by
 * rewriting `{ at, held: true }` and then blocks; the test kills only after
 * observing `held: true`, and removes the key in its `finally` — the gate's
 * own safety timer runs inside the worker being killed, so it cannot be
 * relied on for cleanup.
 */
export type RestoreGateHoldPoint = "service-restore" | "account-state"

export interface RestoreGate {
	/** Resolves when the restore step at `at` may proceed. Default: immediately. */
	waitAt(at: RestoreGateHoldPoint): Promise<void>
}

/** The production default: never holds. */
export const NOOP_RESTORE_GATE: RestoreGate = {
	waitAt: () => Promise.resolve(),
}
