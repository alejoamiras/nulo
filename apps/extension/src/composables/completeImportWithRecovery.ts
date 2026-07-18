/**
 * Import-completion orchestration, decoupled from any shell so it is unit-testable
 * in isolation. Both import pages (popup + onboarding) drive it with their own
 * activation + recovery closures.
 *
 * The bug this closes (P0-proven): after a full-backup restore, the MV3 service
 * worker can restart mid-bootstrap. The worker's in-process `onActiveProfileChanged`
 * emit then never reaches the page, so the naive "await the handshake for 30s" wait
 * dead-ends on a silent "Finishing…" screen. The page itself is fine — a fresh page
 * recovers by re-reading the active profile and bootstrapping. This helper makes the
 * SAME recovery happen in-place, promptly.
 */

export interface ImportCompletionDeps {
	/**
	 * Resolves once the profile is active for THIS page (popup: the SW handshake
	 * flipped `isLogined`; onboarding: the direct bootstrap activated). Rejects on
	 * timeout or if activation didn't happen — either rejection triggers `recover`.
	 */
	waitForActive: (timeoutMs: number) => Promise<void>
	/**
	 * The active-profile recovery a fresh page would run: wake the SW (a
	 * `getActiveProfile()` call resumes a restarted MV3 worker), bootstrap, flip
	 * `isLogined`. Returns true iff a valid session was recovered for this profile.
	 */
	recover: () => Promise<boolean>
	/**
	 * Fast-path activation ceiling (ms). Deliberately short: a healthy handshake
	 * resolves in well under a second, so a dead-SW wedge reaches an actionable
	 * screen in seconds instead of the old 30s dead-end. Defaults to 8000.
	 */
	timeoutMs?: number
}

export type ImportCompletionOutcome = "active" | "needs-unlock"

/** The default fast-path activation ceiling — see `ImportCompletionDeps.timeoutMs`. */
export const IMPORT_ACTIVATION_TIMEOUT_MS = 8_000

/**
 * Complete a profile import without a dead-end wait.
 *
 * Fast path: `waitForActive` resolves within the (short) timeout → `"active"`.
 * If it rejects (handshake never arrived because the MV3 worker restarted, or the
 * direct bootstrap didn't activate), actively re-run `recover`. A recovered session
 * → `"active"`; otherwise `"needs-unlock"` (strict mode + worker restart dropped the
 * master secret, so the store key is unrecoverable until the user unlocks).
 *
 * Never throws: a throwing `recover` (e.g. the store refuses to open) falls through
 * to `"needs-unlock"`, which is always an actionable screen.
 */
export async function completeImportWithRecovery(deps: ImportCompletionDeps): Promise<ImportCompletionOutcome> {
	const timeoutMs = deps.timeoutMs ?? IMPORT_ACTIVATION_TIMEOUT_MS
	try {
		await deps.waitForActive(timeoutMs)
		return "active"
	} catch {
		// Activation didn't arrive in time — fall through to active recovery.
	}
	try {
		if (await deps.recover()) return "active"
	} catch {
		// Recovery itself failed (dead SW that won't wake, or the store refuses to
		// open) — the unlock screen is the honest next step.
	}
	return "needs-unlock"
}
