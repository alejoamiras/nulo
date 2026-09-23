# service-fences — recon (batch 7 of the PR #448 remediation)

Consolidated from three read-only recon agents against dev @ `16e721ba`. Findings adjudicated in `audit/bugs/2026-08-22-production-ready/adjudication-2026-08-24.md`; all three carry proof = "recipe" (no executable audit proof to adopt — the regression pins are authored here).

## N-03 — unfenced account write racing deleteProfile (Major → re-weighted S, hygiene)

- Surface: `apps/extension/src/wallet/services/account/service.ts` — `createAccountInternal` (:210-243). Secret read `getProfileSecret` at :216; then THREE awaits (`resolveVerifiedL1ChainId` :227 — slow custom-network probe; `deriveAccountSeed` :228; `NuloAccount.new` :229); unfenced durable write `this.storage.set(accountRowIdOf(account), account)` at :240 + emit :241. (Audit cited :205/:216-218/:229-230 at its HEAD; drifted.)
- Race: `deleteProfile` (`profile/service.ts:1229`) begins mid-derivation → purge covers only snapshot addresses → tombstone cleared + reservation released (:1336-1339) → resumed creation writes the row → permanent orphan (inert: no secrets, invisible to reads — hence the re-weight).
- Mirror pattern: `transaction/service.ts:180-184` — `deletionState.assertCurrent(fence.profileId, fence.epoch)` immediately before the durable write. The audit's `getSecretWithFence` helper DOES NOT EXIST (adjudication + grep-confirmed); the real API is `ProfileDeletionState` (`profile/profile-deletion-state.ts`): `capture(id)`, `assertCurrent(id, captured)` (throws), `isCurrent` (non-throwing), `isReserved(id)`; accessor `ProfileService.getDeletionState()` (:1197). `AccountService` already holds the real `ProfileService`.
- Same-shaped adjacency found by recon, NOT in the audit's 28: `dapp-session/mac-storage.ts:29-33` (secret derive → await → unfenced write). OUT OF SCOPE unless codex rules it strictly required — logged here for the record.

## N-14 — slice-restore writers race composable rollback (Minor → confirmed M)

- Race: `useFullBackupImport.ts:947-978` — an RpcTimeoutError-classified slice failure takes the immediate-rollback path → `rollbackCreatedProfile` → plain `deleteProfile` (NO tornGuard) → tombstone cleared + reservation released — while the SW-side restore loop is still writing rows for that profileId. "Slice restores deliberately don't consult deletion state" (the F-B24 comment at `profile/service.ts:1324-1331` documents the gap; its tornGuard mitigation covers only the boot-resume reap path).
- Writers (all route through `restoreRows` in `wallet/services/restore-rows.ts` except the two hand-rolled):
  | writer | write site |
  |---|---|
  | `contact/service.ts` restore | :281 |
  | `fpc/service.ts` restore | :459 (NO colocated test file exists) |
  | `auth-registry/service.ts` restore | :505 |
  | `token-balance/service.ts` restore | :413 (only writer not under a service lock) |
  | `account/service.ts` restore | :662 |
  | `account/service.ts` restoreImportedKeys | :729 |
  | `transaction/service.ts` restore | :549 (same file already has the D13 fence in addTransaction — just not here) |
  | `token/service.ts` restore | :692 |
  | `network/service.ts` restore | :819 (hand-rolled loop) |
- Exempt with rationale: `config/service.ts` restore (global slice, no profileId anchor — the per-profile race doesn't apply); `account-state/service.ts` restore (PXE/IndexedDB, not `chrome.storage.local`; a fence would need a PXE-side hook — out of this batch's scope).
- Every fenced service already holds the real `ProfileService` (verified: contact:35, fpc:71/81, auth-registry:57/85, token:67/87, network:202/222, token-balance:41, account, transaction) → `getDeletionState()` available with zero dependency-graph changes.
- `restoreRows` contract (read verbatim): per-row error-continue BY DESIGN ("do not harden this into aborting") — a fence that throws inside `writeOne` records `restoreError` on that row and continues; post-deletion rows each fail the assert, so nothing lands and the errors are visible in the import error log.

## N-10 — no generation fence inside syncBatch (Major → re-weighted Minor, pattern consistency)

- Surface: `token-balance/balance-job-queue.ts` — `syncBatch` (:186-293, sole caller `tick()` :153). Projector await at :213 resolves LIVE active-profile handles mid-projection (`balance-projector.ts:163-178`). Two write sites after the await: ok-branch `repo.set` :260 (second await :232 re-reads `current` between projector await and write) and `writeSyncFailure` :178 (shared by the per-result error branch :226 and the outer catch :280). Both already carry two callback fences (`isBalanceInvalidated` :250/:177, `isRowEmittable` :256/:171/:264/:182) — neither is generation-based; A→B→A repopulates the tokens map and disarms `isRowEmittable`.
- Generation primitive exists ONE FILE OVER: `token-balance/service.ts:61-65` `private profileGeneration = 0`, bumped per profile switch (:254); every other handler in that file follows capture-then-recheck (:275/:282/:288/:302). The queue is constructed at `service.ts:103-116` with a callbacks object — `getGeneration` is simply not passed.
- Fix shape (recon-mapped): add optional `getGeneration?: () => number` to `BalanceJobQueueCallbacks` (:39-56); wire `getGeneration: () => this.profileGeneration` at the construction site; capture `const gen = this.callbacks.getGeneration?.()` as syncBatch's first statement; bail immediately before EACH write dispatch (before :260, and inside `writeSyncFailure` — which takes `gen` as a parameter — before :178), matching the file's own "fence check with NO await between it and the write dispatch" discipline and the N-17 seeder precedent (`incoming-transfer/service.ts:994-1141`, pinned by `service.scenarios.test.ts:830/:888`).
- Test harness: `balance-job-queue.test.ts` — `makeProjector(resultsOrFn)` lets a results-FUNCTION mutate state during the projector await (the deletion-fence TOCTOU pins at :385-430 use exactly this); `raw()` fixture, `makeTaskService()`, `makeRepo()`. Zero existing generation tests in the file.

## Reuse/adapt map

- Reuse as-is: `ProfileDeletionState` (all three N-03/N-14 fences), `profileGeneration` (N-10), `restoreRows` (unchanged contract), `svc()`/`FakeBrowserApi`/`ServiceCollection` harness, `makeProjector` mutation-injection trick.
- Adapt: `BalanceJobQueueCallbacks` (+1 optional field), `writeSyncFailure` (+1 param), each writer's `writeOne` closure (fence line), `createAccountInternal` (capture + assert).
- Conventions to match: assert-with-no-await-before-write; capture synchronously at entry; comments explain WHY (D13/N-17 language already in-tree).
