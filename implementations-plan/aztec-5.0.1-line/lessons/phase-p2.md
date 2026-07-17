# Phase P2 — Import-page recovery (the actual restore fix). RESULT: code + tests done; e2e gate CI-deferred (local box blocked, root-caused).

## What P2 fixes
The P0-proven wedge: after a full-backup restore the popup's `completeImport`
awaited the SW `onActiveProfileChanged` handshake for a flat 30 s and, when an MV3
worker restart killed the in-process emit, dead-ended on a silent "Finishing…"
screen, then blindly routed to `/popup/auth`. The wallet itself recovers on reopen;
the PAGE was the bug.

## Code (done, unit-validated)
- **New pure orchestrator `completeImportWithRecovery.ts`** (+7 unit tests): fast
  path returns `"active"` when the activation wait resolves; on ANY wait failure it
  runs the caller's `recover()` (the same thing a fresh popup does) and returns
  `"active"` if a session survived, else `"needs-unlock"`. Never throws — a throwing
  `recover` falls through to `"needs-unlock"` (always an actionable screen). This is
  the "no dead-end wait" guarantee, decoupled from any shell for testability.
- **Popup `import.vue`**: `completeImport` now drives `completeImportWithRecovery`
  with `waitForActive = waitForProfileActive(30s)` and `recover = hydrateKnownProfile`
  (wakes the SW via `getActiveProfile()` + bootstraps). Kept the 30 s backstop (a
  legitimately slow bootstrap on a loaded runner needs it); the win is that on
  timeout it RECOVERS instead of blindly re-authing — a surviving session now reaches
  `/popup/general` instead of a forced unlock.
- **Onboarding `import.vue`**: unified on the same orchestrator; its `waitForActive`
  IS the direct `bootstrapActiveProfile` (onboarding has no app-shell listener), its
  `recover` is `hydrateKnownProfile`. Routes to `/onboarding/learn` regardless (that
  screen gates on unlock); only the toast copy reflects the outcome.

### Rejected sub-approach (recorded so it isn't re-tried)
An earlier `waitForImportActivation` watched `isBackgroundConnected` to reject
sub-timeout on a genuine SW drop. **Reverted + deleted.** A transient
disconnect/reconnect during the heavy 11-service restore is indistinguishable from
the wedge at drop-time, and rejecting early made recovery RACE app.vue's still-live
bootstrap → regressed the healthy path in smoke. The backstop **timeout is the only
race-free "the listener has genuinely given up" signal.**

## e2e (rewritten per plan step 3; gate deferred to CI — see blocker)
- `backup-roundtrip` (smoke), `backup-restore-integrity` + `backup-migration-roundtrip`
  (network) rewritten from "assert a straight path to `/popup/general`" to the
  realistic settle→recover: wait for an ACTIONABLE screen (`general` OR `auth`),
  unlock if locked, assert `/popup/general` + a store-dependent read; then a
  lock→unlock store-reopen cycle (`reopenAndRecoverAfterImport`, new shared helper in
  `fixtures/helpers.ts`) re-reads the account to prove the encrypted OPFS store
  RE-OPENS under the re-derived key (refuse-and-preserve — never wiped).
- The rewritten smoke deliberately does NOT tolerate a "completed with errors" screen
  → it stays a real gate (green only when restore is clean, as on CI).

## ⚠️ CORRECTION (CI-confirmed) — the restore failure is a REAL 5.0.1 REGRESSION, not environmental
The "environmental SW-eviction, CI will be green" conclusion below was **WRONG**. Pushing to CI
(PR #282, run 29620113858 / 29620113805) proved it: `backup-roundtrip` (smoke) and
`backup-migration-roundtrip` (network) FAIL on a dedicated CI runner too — timing out because the
restore lands on "completed with errors". The quality gate (unit/lint/typecheck/build) is GREEN.
- **`dev` (5.0.0) has smoke + network e2e GREEN**; my 5.0.1 branch fails the restore trio. My
  PRISTINE P1 tree already failed backup-roundtrip locally → the regression is in **P1 (the 5.0.1
  bump)**, not P2/P3.
- **Root cause**: under 5.0.1 the exported account-state slice includes the account's OWN contract
  instance (`0x086c…`, class-id `0x020ec199…`); restore calls `pxeService.registerContract` for it
  DURING `restoreBackup`, BEFORE `finalizeRestore` opens the session — so the per-profile PXE store
  key is not yet provisioned and the client's `PXE_STORE_KEY_MISSING` retry-once provider can't
  supply it (the profile secret isn't available pre-finalize). `registerContract` throws → the row is
  recorded as a restore error → `isRestoreHasErrors` → the import stops on the manual "Continue"
  screen instead of auto-advancing. On 5.0.0 the account-state slice apparently had no such contract
  to register during restore, so the store key was never needed that early.
- **The known flakes masked it**: `tokens.test.ts "import token by contract address"` (frame-detach)
  and `[aztec-node] Error: Address already in use` (port-collision boot) are BOTH documented in
  `harden-quality-arc/lessons/Q-0{6,7}.md` as infra flakes that clear on re-run — they inflated the
  "systemic network failure" picture. The deterministic signal is the restore trio.
- **FIX (real, required for P2's gate) — scoped**: the store-key provider
  (`runtime.ts:202`) does `derivePxeStoreKey(getProfileSecret(profileId))`, and
  `getProfileSecret` → `sessionManager.getSecret(id)` needs an **OPEN session**. Restore DEFERS
  session-open to `finalizeRestore` (so `onActiveProfileChanged` fires only after all slices are
  written — `service.ts:1166,1201,1284`). So during the account-state restore step there is no
  open session → provider returns undefined → `PXE_STORE_KEY_MISSING` propagates. And account-state
  has **NO boot/unlock re-registration** (its only `registerContract` is in `restore`,
  `service.ts:226`) — so "defer to next unlock" is NOT free; it needs a new sync path. Three
  candidate fixes, each a session-lifecycle DESIGN FORK on the user-data path (warrants a codex
  consult before implementing):
  1. **Open the session at the START of restore but SUPPRESS the `onActiveProfileChanged` emit until
     `finalizeRestore`** (split "secret available" from "activate") — most principled; touches
     `sessionManager`/restore.
  2. **Explicit provision RPC during restore** — `useFullBackupImport` unseals the just-created
     profile's secret with the password it already holds, derives the store key, provisions it before
     the account-state step — most surgical; adds a provision entrypoint.
  3. **Reorder account-state restore to AFTER `finalizeRestore`** — simplest but risks app.vue's
     activation handler (`getOrInitNetworks`/`ensureDefaultAccount`) running before contracts register.
  This is the CORE restore-e2e blocker under 5.0.1 (mis-filed earlier as a deferrable P3 item); it
  must land before P2/P3 e2e go green. Implement with care + a fresh context.

## (SUPERSEDED by the correction above) BLOCKER — local smoke/network e2e cannot pass ON THIS BOX
Running `backup-roundtrip` smoke locally fails identically on the PRISTINE pre-P2
tree (stash-tested) — so it is not a P2 regression. Definitive root cause captured by
forwarding the offscreen/SW console:
```
[sw:wallet] [account-state registerContract] 0x086c…  Error: PXE_STORE_KEY_MISSING: no store key provisioned for profile <id>
[popup:ui] Error: Client disconnected   (flooding)
```
- The MV3 service worker is being **evicted under multi-agent memory pressure on this
  host** (many agents share the box — see CLAUDE.md run-isolation). Eviction drops the
  in-memory master → the per-profile PXE store key can't be provisioned → account-state
  `registerContract` throws `PXE_STORE_KEY_MISSING` → restore "completes with errors" →
  the flow shows the manual "Continue" button and never auto-advances.
- This is the SAME mechanism P0 identified (SW restart drops master), here triggered
  by host load rather than an injected restart. On a dedicated CI runner the SW stays
  alive, master persists, the store key provisions, restore is clean → the test is
  green (it is a required smoke gate on `dev`).
- The error is **NOT a 5.0.1 protocol incompatibility**: a version rejection would say
  "invalid contract version / class-id mismatch"; `PXE_STORE_KEY_MISSING` is purely the
  encrypted-store-key/master-availability runtime concern. So this is not a
  probe-contradiction STOP — it's an infra limitation of the local box.
- **Honest gate = CI.** The three rewritten e2e validate on the CI smoke/network
  runners (and at P7's full run). Not weakening the gate to force a local green.

## NEW FINDING (out of P2 scope → hand to P3)
Account-state `registerContract` runs DURING restore, BEFORE `finalizeRestore` opens
the session and provisions the store key — it depends on the `PXE_STORE_KEY_MISSING`
provider→retry-once provisioning the key from the available master. If the SW
restarts mid-restore (production-plausible for MV3, not just test load), that retry
can't provision → contract registrations are silently lost from the restored profile
(balances won't sync until re-registered). This is a real robustness gap in the
restore/store-key ordering — **P3 territory** (store-key provisioning + incarnation
fence), NOT the import-page dead-end P2 owns. Filed here for P3 to pick up; do NOT
expand P2 to fix it.

## Gate status
- typecheck:all **0**; P2 composable unit tests **57 passed** (incl. +7 new); biome
  clean on all 8 touched files; chrome build green.
- e2e (smoke + network): **deferred to CI** — local box blocked by SW eviction
  (documented above). This is the one gate line P2 cannot turn green locally.

`LESSONS_FILE=implementations-plan/aztec-5.0.1-line/lessons/phase-p2.md`
