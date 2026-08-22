# Cluster F3a — Passkey surface (ceremony/window/race lens)

> Scanner: general agent, 2026-08-22.

## F3a-1 — SW 5-min hard timeout kills a legitimate two-leg WebAuthn ceremony (~6 min worst case)

**Severity:** Minor | **Repro confidence:** high (deterministic; device frequency moderate) | **Type:** Wrong result (false failure) / resource mis-budget

**Counter-example.** User on an authenticator that only returns PRF on `get` creates a profile via the SW-driven window (PATH B). Registration touch lands at t≈2:59 (leg 1 budget: PASSKEY_TIMEOUT = 60_000 * 3, `passkey/spec.ts:4`). Because ext.prf.enabled is false, runCreate falls back to a fresh full runGet with its own new 3-minute challenge/timeout (`passkey-ceremony.ts:104-118`). At t=5:00 WindowManager's timer fires (PASSKEY_TIMEOUT_MS = 5*60*1000, `passkey/service.ts:16`; window-manager.ts:76-79) → _settle(..., "Timed out") → windows.remove(windowId) force-closes the popup under the user's finger (`window-manager.ts:181-185`), createKey rejects, createPasskeyProfile fails after the user did everything right. The just-minted resident credential (userHandle = pre-picked id) is orphaned on the authenticator; retry mints a second credential under a new id.

**Violated invariant.** Timeout's own doc claims it bounds "when neither the user interacts nor onRemoved fires… 5 minutes is ample for WebAuthn UX" (`service.ts:11-16`) — but the helper can legitimately need 2 × PASSKEY_TIMEOUT + overhead.

**Failing path:** service.ts:110-129 openWindowAndWait(timeoutMs: PASSKEY_TIMEOUT_MS) → window-manager.ts:76-79 → _settle → :181-185 windows.remove — racing passkey-ceremony.ts:118 second leg.

**Smallest safe fix:** raise PASSKEY_TIMEOUT_MS to 2*PASSKEY_TIMEOUT + slack (~7 min), or thread remaining wall-clock budget into fallback runGet.

**Instances:** PATH B only (createKey/getKey → openWindowAndWait). No production callers today (documented preservation), hence Minor. PATH A unaffected.

## Verified clean (lens checklist, with evidence)

- Concurrent ceremonies across contexts: independent frames run independent WebAuthn; SW commits serialize on facade Lock; id collision caught by locked repo.contains(id) || isReserved(id) re-check → ProfileIdConflictError (service.ts:568-569); cross-context retry handled by createPasskeyProfileWithRetry.
- Second Enter during pending ceremony: every caller latches synchronously before any await — isCreating (useProfileCreateFlow.ts:82), isImporting (:214), isAwaitingResponse (auth.vue:71), restoreStatus === "progress" (useFullBackupImport.ts:497). usePasskeyCeremony in-flight rejection unreachable via UI.
- Stale ceremony result resolving for profile B: unlockPasskeyProfile F-007 binds recovery.credentialId === snapshot.credentialId inside zeroizing try (service.ts:657-659), re-reads row + rotation check under lock (:661-677); restore() binds against backup's recorded id (:2228-2231); assertNotDuplicateCredential hard-rejects same-credential reuse (:1877-1884); deletion mid-prompt caught by isReserved re-checks. All stale paths fail closed.
- ProfileIdConflictError retry-once: conflict throws BEFORE any storage write under lock, so retry re-runs id-generation + full ceremony + create — no double-profile, no orphaned reservation.
- Window lifecycle: create-failure → _settle(msg); user-close vs settle ordering neutralized by detach-before-settle in resolvePasskeyRequest (service.ts:96-99); double-settle guarded by handle.settled; >5-min window-create self-heals (orphan window's getPendingRequest fails → own finally closes it).
- restore()/finalizeRestore stash races: every sweepStalePendingRestore site runs under facade lock; finalizeRestore excludes its id and removes entry before await (:2358, :2463-2467); deleteProfile zeroizes stashes under same lock; mid-import TTL expiry (>30 min) documented accepted; finalize-throw survivors land on documented torn/unlock-later taxonomy.
- navigator.credentials mapping: AbortError + NotAllowedError → UserRejectedError (PasskeyCeremonyDialog.vue:59-70, pinned by tests incl. no-double-emit-after-settle and dismount-abort); callers silently swallow cancels and reset form state.
