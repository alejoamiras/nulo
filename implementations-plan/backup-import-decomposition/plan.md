# backup-import-decomposition (arc 4, monster 2 of 3)

Decompose `apps/extension/src/composables/useFullBackupImport.ts`'s `restoreBackup()` (cognitive 114, 220 lines) plus its shell (328 lines) and the two ~22-score siblings (`pickBackupFile`, `decryptBackup`), burning all **5** directives in the file. Money-path-adjacent (restores wallets, opens sessions, deletes orphan profiles): behavior-preserving transcription, staged like useDeposit's decomposition.

## Recon (this file has already been half-mined)

Earlier arcs extracted the deep machinery — `resolveRestoredActiveNetworkId`, `runImportChainSync`, `normalizeAllIds`/`remapByMap`, `collectRestoreErrors` live in helper modules; `validateAndMigrateBackup`, `restoreAccountsAndFilterOwnedSlices`, and `relinkRestoredTokenBalances` are ALREADY-EXTRACTED exports of the monster file itself (codex recon correction). Those three STAY in `useFullBackupImport.ts` — they carry no directives, and moving them risks import cycles + suite edits for zero budget gain. What remains over-budget is the ORCHESTRATION: `restoreBackup` threads thirteen sequential stages with per-stage failure copy, rollback bookkeeping, and a liveness-gated outer catch.

**Equivalence proof: the EXISTING 74-test suite stays green with ZERO edits, PLUS pre-extraction real-wiring pins committed FIRST** (codex assumption-attack: the suite covers the major failure branches but NOT duplicate-confirm decline/retry, active-pointer rejection, imported-key invocation order, error-log reset semantics, failure-path disconnects, pick/decrypt behavior beyond two cases, or the exact stage/status/error matrix of seven failure paths). The new pins drive the CURRENT `restoreBackup`/`pickBackupFile`/`decryptBackup` over the existing mock scaffolding before any refactor; no deposit-sized snapshot harness needed.

## Load-bearing invariants (transcribe, never re-derive)

1. **Stage/status discipline**: `restoreStage` progresses exactly as today (`restoring:profile → networks → [accounts] → tokens → services → finalizing → account-state → chain-sync → finished` with `rolling-back/rolled-back/rollback-failed/failed` on the failure paths); every `fillError` copy verbatim; `restoreStatus` transitions (`progress`/`failed`/`""`/`"finished"`) exact — the page's re-enable guard keys on them.
2. **Rollback matrix**: pre-finalize failure with a created profile → bounded-retry `rollbackCreatedProfile` (commit-ambiguous delete: never treat "Invalid profile id" as success); DISCONNECT-classified failures gate on the worker-liveness advance first, failing CLOSED to cleanup-pending; post-finalize failures KEEP the profile. `finalizeStarted`/`createdProfileId` bookkeeping must stay visible to the outer catch (out-param scratch, as in deposit).
3. **Order-of-restore law**: profile → unconditional `normalizeAllIds` profileId remap (graft-hole closure) → networks (index-paired remap, duplicate-source-id backstop, ONE remap pass) → active-network pointer (never fails the import) → accounts + imported keys (before reconciliation) → tokens + balance relink → the six-service loop (whole-loop try/finally, all clients disconnect) → `reconcileImportedAccounts` BEFORE finalize → finalize (own catch) → account-state AFTER finalize (PXE store key needs the open session) → chain-sync budget → completion.
4. **Completion isolation**: a rejected `completeImport` after genuine success only surfaces — never flips status or reaches the rollback catch.
5. **Secret-shape gates**: epoch-4 entropy/dek field presence rules per profile type, exact fillError copy; the passkey ceremony handoff (silent `UserRejectedError` cancel resets status to `""`).
6. **Client lifecycle**: every service client constructed in the flow disconnects in the same finally discipline as today (P7) — profileService/networkService span the whole restore.

## Architecture

New sibling module `apps/extension/src/composables/full-backup-restore.ts` (mirrors `deposit-flow.ts`: module functions, no Vue reactivity, explicit io). The composable keeps the refs, the public surface, `pickBackupFile`/`decryptBackup`/`showRestoreErrorLog`/`resetBackupState`, and a thin `restoreBackup` orchestrator.

- `RestoreIo`: `{ opts, setStatus, setStage, resetErrors, appendErrors, hasErrors }` — LIVE callbacks only, never a captured errorLog object (codex HIGH: the ref's value is replaced at restore start; a captured object would strand failures in a stale log and let a degraded import auto-complete clean). Error-log conservation is a named invariant: append-not-assign everywhere, including the direct dropped-balances append.
- Stage functions return **typed terminal descriptors** rendered by ONE small `applyOutcome` helper (codex position adopted over the draft's stages-write-own-status shape: descriptors carry the stage's own copy but make every status/stage/error combination exhaustive and centrally testable): `{ kind: "proceed", ...payload } | { kind: "fail", title, message, stage?, status? } | { kind: "silent-cancel" } | { kind: "cleanup-pending" } | ...` as the matrix requires. Stages:
  1. `resolvePasskeyCredential(profile, masterKey, io)` → credentialData | done (ceremony wiring, silent cancel).
  2. `buildRestoreSecret(profile, backup, masterKey, io)` → RestoreSecret | done (entropy/dek gates, copy verbatim).
  3. `restoreProfileStage(...)` → { newProfile } | done (dup-confirm wiring, restoreError check).
  4. `restoreNetworksStage(data, networkService, io, rollback)` → { newNetworks, createdNetworks } | done (index-paired remap + recordErrors + no-networks rollback path).
  5. `restoreActiveNetworkPointer(...)` (never-fail).
  6. `restoreAccountsStage(...)` → { importedChainAddress } | done (duplicate-account rollback path; rethrow otherwise; client disconnect in finally).
  7. `restoreTokensStage(...)` (tokens + balance relink + recordErrors).
  8. `restoreServiceSlices(data, profileId, io)` (the six-client loop, whole-loop finally).
  8b. `reconcileImportedAccountsStage(accountService, profileId)` — EXPLICIT stage after ALL service slices and before finalize (codex HIGH: folding it into the accounts stage would reorder it ahead of later-restored dependent rows and orphan them); fail-fast, deliberately uncaught (outer catch rolls back).
  9. `finalizeStage(...)` → done-on-failure (own catch, copy verbatim).
  10. `restoreAccountStateStage(...)` (chain-sync tail).
  11. `completeStage(...)` (status flips + isolated completeImport).
  12. `rollbackCreatedProfile(profileService, id)` hoisted; `runLivenessGatedRollback(err, scratch, io, profileService)` — the outer-catch body.
- `pickBackupFile`/`decryptBackup`: extract `publishParsedName(selection/backupObject)` (the shared sanitize-prefill block) and `applyDecryptedSelection` — enough to clear their 22/23 scores.
- The orchestrator: guards → validate gate → scratch bookkeeping → try { stages in order } catch { liveness-gated rollback } finally { disconnects } — target ≤ 15 cognitive / ≤ 80 lines, stages hoisted to module scope so the shell shrinks too (the deposit lesson: nested stage fns re-trip the shell's line cap).

## Test plan

- **Pre-extraction pins FIRST** (`useFullBackupImport.stages.test.ts`, the existing suite's mock scaffolding, committed against CURRENT code and kept green unchanged): (a) a real-wiring stage-order trace over the happy path incl. imported keys, the six-service loop order, reconcile-before-finalize, BOTH network projections feeding the account-state tail (successful ids for probing vs the full index-aligned result for restore — codex HIGH), and the completion payload (`completeImport(newProfile)` with both finished markers already set; `importedProfile` only on the partial-errors path); (b) the epoch-4 gates' four rejections + PERMISSIVENESS pins (password ignores an extra sealed DEK; passkey ignores an extra plain DEK — asymmetry preserved); (c) the stage/status/error matrix for ceremony-cancel, secret-gate, duplicate-decline, profile-restoreError, no-networks, duplicate-account, finalize-failure — including that no-networks and duplicate-account roll back WITHOUT emitting `rolling-back`/`rolled-back` (stage stays `restoring:networks` — historical, preserved); (d) rollback matrix: bounded delete retries + cleanup-pending copy, post-finalize keep, liveness-gate fail-closed; (e) `pickBackupFile`/`decryptBackup`: guards, cancellation drop-selection, parse/decrypt failures, reset ordering, successful decrypt publication, sticky parsed-name semantics, stale-selection fences; (f) error-log conservation (reset at restore start; append-not-assign incl. dropped balances); (g) scratch bookkeeping timing (`createdProfileId` set immediately post-restore, `finalizeStarted` before the finalize call).
- **The 74 existing tests green with zero edits** throughout.
- Gates: `audit:vue`, `test:ci-gating`, extension unit suite; smoke e2e if the diff trips the filter (composable only — it will ride `quality-status` + smoke on PR).

## Rollback

Squash revert stops NEW bad imports; it cannot undo profiles or child rows a faulty build already restored — recovery for those is the normal profile-deletion flow (rows cascade via the deletion coordinator). No storage shape, RPC, or export change; the composable's public surface and the three in-file helper exports are unchanged.

## Decision ledger (dual positions reconciled — codex session 01a05afa, response-6)

1. **Module split**: both YES — `full-backup-restore.ts`, with the three existing in-file helper exports LEFT IN PLACE (no move, no cycle risk).
2. **Outcome shape**: DIVERGED and codex's position ADOPTED — typed terminal descriptors + one `applyOutcome` renderer, not stages-writing-own-status: copy stays in the stage, the write matrix becomes exhaustive and centrally testable.
3. **pick/decrypt**: both LIGHT-TOUCH — a pure name-normalization helper only; the conditional publication and stale-selection fences keep their exact shapes (no shared publisher with reset authority).
4. **Codex conditional-approve conditions, all folded**: explicit reconcile stage; live error-log callbacks; helpers preserved in place; real-wiring + pick/decrypt pins committed BEFORE extraction; rollback claim narrowed.
