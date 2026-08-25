# service-fences — batch 7 of the PR #448 audit remediation [light]

Findings N-03, N-14, N-10 (`audit/bugs/2026-08-22-production-ready/`): three deletion/generation-fence gaps in wallet services. All three are the same family — a durable write dispatched after an await, under authorization captured before it. Fix = the repo's existing capture-then-assert discipline (D13 / N-17), no new mechanisms. Runbook: `implementations-plan/audit-448-remediation/runbook.md` batch 7. Recon: [recon.md](recon.md).

## Success criterion

Each finding's race provably closed by a discriminating colocated pin (red with the fence reverted), `audit:vue` + smoke + solo network e2e green, PR squash-merged into dev under all three required gates with codex final-diff sign-off. No behavior change outside the raced windows.

## Assumptions (light floor — verified Facts)

1. **F**: `createAccountInternal` writes unfenced at `account/service.ts:240` after three awaits (:227-229); secret read at :216 (read live).
2. **F**: `ProfileDeletionState` exposes `capture/assertCurrent/isCurrent/isReserved`; shared instance via `ProfileService.getDeletionState()` (`profile/service.ts:1197`); `getSecretWithFence` does not exist (grep zero; adjudication note).
3. **F**: every N-14 writer service already holds the real `ProfileService` instance (file:line table in recon.md) — no dependency-graph change needed.
4. **F**: `restoreRows` is per-row error-continue BY DESIGN (doc comment forbids hardening into abort); a throwing `writeOne` records `restoreError` and continues.
5. **F**: `BalanceJobQueue` has no generation access today; `TokenBalanceService.profileGeneration` (:61) is bumped per switch (:254) and never passed to the queue (construction :103-116).
6. **F**: `syncBatch` has two post-projector write sites (:260, `writeSyncFailure` :178) each already double-fenced by `isBalanceInvalidated`/`isRowEmittable`; a second await (:232) sits between the projector await and the :260 write.
7. **I** (inference): a deletion cannot interleave between a resolved await and the next synchronous statement (JS single-thread) — capturing the epoch synchronously after the secret null-check is atomic with the secret's resolution. Codex: challenge this.

## Architecture & implementation

No new files. Three surgical edits + pins, all applying capture-then-assert with the repo's no-await-between-assert-and-write discipline.

### N-03 — `account/service.ts`

- After the :216-219 secret null-check (synchronously): `const deletion = this.profileService.getDeletionState()`; reject if `deletion.isReserved(profileId)` (mirrors `captureExecutionFence`'s reserved check); `const epoch = deletion.capture(profileId)`.
- Immediately before the :240 write: `deletion.assertCurrent(profileId, epoch)` — no await between assert and `storage.set`. A moved epoch throws out of `createAccountInternal`; `serializePerTuple` propagates the rejection (existing behavior, already pinned for rejections).
- Comment: D13 language, mirroring `transaction/service.ts:173-179`.

### N-14 — nine slice-restore writers

- Per service, inside `restore()` (and `restoreImportedKeys`): resolve `const deletion = this.profileService.getDeletionState()` once; capture epochs lazily per distinct `profileId` encountered (`Map<string, number>`; first-touch capture is synchronous within that row's `writeOne` before any of its awaits — subsequent rows assert against the first-touch capture). Concretely each `writeOne` starts `const epoch = epochs.get(pid) ?? capture-and-store`, and asserts `deletion.assertCurrent(pid, epoch)` immediately before its `set()` (no await between). Post-deletion rows throw → `restoreRows` records `restoreError` per its contract → zero writes land, errors surface in the import error log.
- profileId source per writer: the row's own `profileId` field where present; where the slice key encodes scope instead, the id the writer already uses to build the row key (verified per site during implementation — each writer manifestly knows the profile it writes under).
- Hand-rolled loops (`network`, one branch of `account`) get the same inline assert before their `set`.
- Exempt: `config` (global slice, no profile anchor), `account-state` (PXE-side) — documented in code comment? NO — documented here and in the PR body only (comments describe live behavior, not absent scope).

### N-10 — `token-balance/balance-job-queue.ts` + `service.ts`

- `BalanceJobQueueCallbacks` += `getGeneration?: () => number`; construction site wires `getGeneration: () => this.profileGeneration`.
- `syncBatch` first statement: `const gen = this.callbacks.getGeneration?.()`.
- Before the :260 write (after the :256 emittable check): bail `if (gen !== undefined && gen !== this.callbacks.getGeneration?.())` → `failTask(taskId, "Profile changed mid-sync")`, continue.
- `writeSyncFailure(id, message, at, gen)` — same bail immediately before its :178 write. Covers both call sites (:226, :280).

## Test plan (succinct; every fence revert-probed)

- **N-03** (`account/service.test.ts` or the serialize-per-tuple harness): park `resolveVerifiedL1ChainId` (deferred `svc()` stub), `beginDeletion` mid-park, resolve → `createAccount` rejects AND storage holds no account row; positive control (no deletion → row lands). Probe: strip the assert → red.
- **N-14** (one mechanism pin + one representative service): `transaction/service.test.ts` — restore 3 rows with row-1's storage `set` parked (deferred), `beginDeletion` mid-park, resolve → rows 2-3 carry `restoreError`, storage holds only row 1 (its write pre-dispatched — unavoidable and harmless: purge follows tombstone), no emits; positive control. Plus `account/service.test.ts` variant for the hand-rolled + imported-keys path... (implementation picks the two highest-value sites; remaining writers share the identical five-line pattern — the two pins + probe establish the mechanism; per-site divergence is caught by review + the shared pattern's simplicity).
- **N-10** (`balance-job-queue.test.ts`, pattern-matching :385-430): bump the generation from inside the `makeProjector` results-function → ok-branch write never lands, no emit, task failed "Profile changed mid-sync"; failure-path variant (projector throws → `writeSyncFailure` bails); positive control (stable gen → write + emit land). Probe each bail → red.

## Validation gates

`bun run audit:vue` → armed smoke (`VITE_NULO_E2E_MIGRATION_FIXTURE=1` build + `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`) → `NULO_E2E_PROVERLESS=1 bun run e2e:agent` SOLO (services touched ⇒ network gate). Then `/code-review max --fix` → codex fix loop → PR → required checks → codex final-diff sign-off → squash-merge.

## Security & adversarial considerations

- The fences are authorization re-checks at commit time — they REDUCE the attack/corruption surface (post-deletion writes). No new inputs, no crypto, no storage-shape change (no migration; pre-production).
- Failure modes: a spurious assert (epoch bumped by an unrelated deletion of the SAME profile) fails the write — correct by definition (the profile is being deleted). `assertCurrent` on a NEVER-deleted profile compares 0 === 0 — no false trips.
- N-10's bail uses `failTask` (visible task failure), not silence — consistent with the file's existing fences.
- Restore fence errors surface via `restoreError` rows in the existing import error log — no silent data loss; the rows belong to a profile being deleted regardless.
- DoS: none — all checks are O(1) map lookups.

## Out of scope (logged)

- `dapp-session/mac-storage.ts:29-33` — same-shaped unfenced write found by recon, NOT among the 28 findings. Runbook forbids new surfaces without codex agreement; flagged in the codex audit for an in/out ruling (default OUT).
- tornGuard-based alternative for N-14 (the audit's other option) — runbook chose the writer fence.
- `config`/`account-state` restore exemptions (rationale in recon.md).

## Delivery

Single arc, one PR: `fix(services): deletion+generation fences on account create, slice restores, balance sync`. First commit carries batch 6's `implementations-plan/index.md` row.
