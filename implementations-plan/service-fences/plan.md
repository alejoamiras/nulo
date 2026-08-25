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
7. **F** (was I1, REFUTED by codex round 1): capture-after-the-secret-await is NOT atomic — `getProfileSecret` releases the profile lock before the awaiting caller's continuation runs, and other queued continuations (a deletion's `beginDeletion`) can interleave in that microtask gap. Capture must precede the secret await.

## Architecture & implementation

No new files. Three surgical edits + pins, all applying capture-then-assert with the repo's no-await-between-assert-and-write discipline.

### N-03 — `account/service.ts`

- **BEFORE the :216 secret await** (first statements of `createAccountInternal` after the type check): `const deletion = this.profileService.getDeletionState()`; reject `if (deletion.isReserved(profileId))` (mirrors `captureExecutionFence`); `const epoch = deletion.capture(profileId)`. Capture-before-await means any deletion that begins during the secret await, the probe, or the derivation bumps past the captured epoch.
- Immediately before the :240 write: `deletion.assertCurrent(profileId, epoch)` — no await between assert and `storage.set`. A moved epoch throws out of `createAccountInternal`; `serializePerTuple` propagates the rejection (existing behavior, already pinned for rejections).
- A deletion fully completed before capture leaves the profile row gone → `getProfileSecret` returns null → the existing `unauthorized` throw covers it.
- Comment: D13 language, mirroring `transaction/service.ts:173-179`.

### N-14 — nine slice-restore writers (revised per codex round 1)

- **Entry capture, not lazy**: immediately after each `restore()`'s existing `await this.ensureInitialized()` and BEFORE any further await (lock, collision reads, validation): resolve `deletion`, then synchronously for every distinct profileId in scope — reject up front `if (deletion.isReserved(pid))` (a restore starting mid-deletion writes nothing) and `epochs.set(pid, deletion.capture(pid))`. Each `writeOne` then only asserts `deletion.assertCurrent(pid, epochs.get(pid))` immediately before its `set()` (no await between). Post-deletion rows throw → `restoreRows` records `restoreError` per its contract; zero writes land.
- **profileId source — ownerless shapes get it threaded** (codex round 1: authwits and balances carry NO profileId, transaction's is optional/backup-controlled): the composable passes the authoritative `createdProfileId` (`useFullBackupImport.ts:685`) as a new parameter to the `restore` RPCs of `auth-registry`, `token-balance`, and `transaction` (spec + client + call-site updates; the fence keys on the passed id, never on row fields). Services whose rows carry a validated `profileId` (`contact`, `token`, `account`, `network`, `fpc` — verified per site at implementation; any found ownerless joins the threaded group) fence on the row-scope id they already use.
- `restoreImportedKeys` fences on the profileId it already receives/derives for the DEK-rewrap context.
- Hand-rolled loops (`network`, `account`'s branch) get the same entry-capture + inline assert before their `set`.
- Exempt: `config` (global slice, no profile anchor), `account-state` (PXE-side) — rationale recorded here and in the PR body only.

### N-10 — `token-balance/balance-job-queue.ts` + `service.ts` (revised per codex round 1)

- `BalanceJobQueueCallbacks` += **required** `getGeneration: () => number` (optional + `!== undefined` guards would silently disable the fence if production wiring were dropped while queue-level pins stay green; required makes omission a type error). Construction site wires `getGeneration: () => this.profileGeneration`. Test constructions supply a real counter.
- `syncBatch` first statement: `const gen = this.callbacks.getGeneration()`.
- Before the :260 write (after the :256 emittable check): bail `if (gen !== this.callbacks.getGeneration())` → `failTask(taskId, "Profile changed mid-sync")`, continue.
- `writeSyncFailure(id, message, at, gen)` — same comparison immediately before its :178 write, but its bail is a **silent return** (the helper holds no taskId; its callers own task state — the per-result error branch has already failTask'd, and the outer catch failTask's before calling it).

## Test plan (succinct; every fence revert-probed)

- **N-03** (`account/service.test.ts` or the serialize-per-tuple harness): TWO races — (a) park the SECRET promise (`getProfileSecret` deferred), `beginDeletion` + full release mid-park, resolve → rejects, no row (this pin discriminates the CAPTURE ORDER: capture-after-secret sees the post-bump epoch and lands the row → red); (b) park `resolveVerifiedL1ChainId`, `beginDeletion` mid-park, resolve → rejects, no row. Positive control. Probe: strip the assert → both red; move the capture after the secret await → (a) red.
- **N-14** (codex round 1: EVERY write site must have a discriminating pin — reverting any one site must red): a compact **table-driven suite** (`restore-deletion-fence.test.ts`, colocated under `wallet/services/`): one row per fenced writer {service factory + minimal deps, row fixtures, restore invoker, storage reader}; the shared scenario drives each — park row-1's write (deferred storage set), `beginDeletion` mid-park, resolve → later rows carry `restoreError` and no further writes land; plus an ENTRY-CAPTURE race case (deletion begins during a pre-write await — e.g. parked collision read — rows reject) on the two structurally distinct shapes (locked `restoreRows` writer + hand-rolled loop). Positive control per writer (no deletion → rows land). This creates the missing `fpc` coverage. Revert-probe: strip each site's assert (scripted sed loop) → that writer's row must red.
- **N-10** (`balance-job-queue.test.ts`, pattern-matching :385-430): bump the generation from inside the `makeProjector` results-function → ok-branch write never lands, no emit, task failed "Profile changed mid-sync"; failure-path variant (projector throws → `writeSyncFailure` bails); positive control (stable gen → write + emit land). Probe each bail → red.

## Validation gates

`bun run audit:vue` → armed smoke (`VITE_NULO_E2E_MIGRATION_FIXTURE=1` build + `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`) → `NULO_E2E_PROVERLESS=1 bun run e2e:agent` SOLO (services touched ⇒ network gate). Then `/code-review max --fix` → codex fix loop → PR → required checks → codex final-diff sign-off → squash-merge.

## Security & adversarial considerations

- The fences are authorization re-checks at commit time — they REDUCE the attack/corruption surface (post-deletion writes). No new inputs, no crypto, no storage-shape change (no migration; pre-production).
- Failure modes: a spurious assert (epoch bumped by an unrelated deletion of the SAME profile) fails the write — correct by definition (the profile is being deleted). `assertCurrent` on a NEVER-deleted profile compares 0 === 0 — no false trips.
- N-10's bail uses `failTask` (visible task failure), not silence — consistent with the file's existing fences.
- Restore fence errors surface via `restoreError` rows in the existing import error log — no silent data loss; the rows belong to a profile being deleted regardless.
- DoS: none — all checks are O(1) map lookups.

## Decision ledger (codex round 1 — REJECT, all 5 findings adopted)

1. I1 REFUTED: capture moved BEFORE the secret await (microtask interleave via the profile lock release); parked-secret pin added as the discriminator.
2. I3 REFUTED: lazy first-row capture → synchronous entry capture (post-`ensureInitialized`, pre-everything-else) + entry `isReserved` rejection.
3. Ownership claim CORRECTED: authwits/balances have no `profileId`, transaction's is optional — `createdProfileId` threaded into those three restore RPCs from the composable.
4. `getGeneration` REQUIRED (not optional) — omission must be a type error, not a silent fence-disable; `writeSyncFailure`'s bail is a silent return (no taskId in the helper).
5. I6 REJECTED: per-writer table-driven pins covering all nine sites (creates the missing fpc coverage), not two representatives.
- Ratified: I2 (entry-capture makes the post-deletion-start case the covered one; fully-post-deletion restores out of scope), I4 (per-row `restoreError` flood over aborting), the runbook's writer-fence mechanism, and `mac-storage` OUT.

## Out of scope (logged)

- `dapp-session/mac-storage.ts:29-33` — same-shaped unfenced write found by recon, NOT among the 28 findings. Codex round 1 CONCURS: OUT (real adjacency, but fencing it needs new dependency design; not required by these findings).
- tornGuard-based alternative for N-14 (the audit's other option) — runbook chose the writer fence.
- `config`/`account-state` restore exemptions (rationale in recon.md).

## Delivery

Single arc, one PR: `fix(services): deletion+generation fences on account create, slice restores, balance sync`. First commit carries batch 6's `implementations-plan/index.md` row.
