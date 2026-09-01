# balance-durable-jobs — round-2 plan 4 (blueprint light, BL/C)

Scope authority: [round-2 scope](../complexity-residue-round-2/scope.md) § 4. 2 PRs.
Burns 13 prod directives across 9 files: `stores/balances.store` 312L + 60 + 29,
`token-balance/service` 50, `token-balance/balance-job-queue` 34,
`token-balance/balance-projector` 27, `token-balance/reconcile-pairs` 22,
`incoming-transfer/service` 47 + 35 + 47, `token/seeder` 33,
`operation-journal/service` 29, `operation-journal/reaper` 23. Manifest 100 → 87. (The
`balances.store.fuzz.test.ts` ×2 and `incoming-transfer/service.scenarios.test.ts` ×1
entries are harness accepts — untouched.) Seam toolkit as adjudicated in plans 1–3: sync
guard-ladder helpers; tail-returns; an awaited helper only where its call replaces a span
that already awaited, under a caller-side applicability guard; register-immediately spans
(write → Map.set / write → emit / markBalanceDirty → upsertRecord) never gain a hop;
epoch/ticket re-checks stay in the same continuation as the await they follow; any helper
that creates a cancellable/registered resource owns the create→register span.

## Recon findings that shape the cuts

- **Nesting rent is the dominant driver in two clusters.** The three `balances.store`
  directives sit inside the 312-line Pinia setup closure (the score-60 `run` arrow is two
  closures deep); the three `incoming-transfer` directives are `withServiceLock` callback
  arrows nested poll → scan → for → lock. Biome charges +1 nesting per enclosing lambda
  on every branch, so the cheapest correct win is hoisting bodies to nesting 0 (a
  module-level class / private methods) — the same lesson as plan 3's engine callback.
- **Coverage is dense everywhere except one function**: `TokenBalanceService.onTransactionUpdated`
  (score 50) is wired as a stub in 13 setups and never invoked in `service.test.ts`
  (grepped `onTransactionUpdated.invoke` — zero hits; e2e asserts rendered amounts only).
  Its narrow-vs-broad refresh branching is unpinned → BL/C pins FIRST.
- Everything else has load-bearing pins already: `balances.store.test.ts` (28 — epoch
  fence, raw-flight reuse, B-08 forced authority, D11 debt, LRU) + the fuzz property test;
  `balance-job-queue.test.ts` (23 — deletion/ownership/generation fence ladder, TOCTOU
  pins); `balance-projector.test.ts` (two-pass PUBLIC-before-PRIVATE order pin);
  `reconcile-pairs.test.ts`; `incoming-transfer/service.scenarios.test.ts` (scanContract
  dedup + emit semantics, public-event D3/D6, outbox D4 write/drain); `seeder.test.ts`
  (commit fencing, marker write safety); `operation-journal/service.test.ts` +
  `reaper.test.ts` (FSM invariants, CAS races). These are the zero-edit equivalence base.

## PR split

- **PR-a — balance pipeline**: `balances.store` (×3), `token-balance/service`,
  `balance-job-queue`, `balance-projector`, `reconcile-pairs`. 7 directives, 100 → 93.
- **PR-b — durable jobs**: `incoming-transfer/service` (×3), `token/seeder`,
  `operation-journal/service`, `operation-journal/reaper`. 6 directives, 93 → 87.
- Both PRs run ALL six e2e gates (the outbox drain in PR-b calls the balance queue PR-a
  restructures; `account-switch-isolation` spans both).

## Decomposition — PR-a

- **`balances.store.ts` (312L / 60 / 29)** — convert the setup-closure body into a
  module-level `BalancesCore` class: every closure becomes a method with its body
  verbatim (`this.` prefixes only); the closure `let`s (`subToken`, `lruTick`,
  `txConnected`) become fields — flagged NON-mechanical by recon because plain
  relocation would break by-value capture, which the field form avoids. The `defineStore`
  setup body shrinks to: construct the core, install the sync belt watcher
  (`useAppStore` needs Pinia context, stays), return the same five-member API
  (`entries` stays the core's `ref`). The `run` IIFEs become methods `runGasFetch` /
  `runFpcFetch` invoked exactly where the IIFE was (`const run = this.runGasFetch(...)`
  then `legFlights.set(...)` — an async method call runs synchronously to its first
  await precisely as the IIFE did, so the single-flight registration keeps its position).
  Then sync helpers at nesting 0: `gasSuccessSlice` / `gasFailureSlice` /
  `fpcSuccessSlice` / `fpcFailureSlice` (the ternary-dense commit literals),
  `isGasRunStale(opts, mySeq, key, scope, epoch)` (the two post-RPC re-checks — a plain
  sync call in the await's continuation), `beginForcedRun` (the forced-pending count +
  seq registration, sync, BEFORE any await). The forced pre-trigger wait stays inline
  under its existing `if (forced) / if (stale)` guards (its span is conditionally
  awaited — no helper).
- **`token-balance/service.ts` `onTransactionUpdated` (50)** — pins first
  (`token-balance-tx-refresh.pins.test.ts`): pending ignored; UI-origin with transfer
  info enqueues ONLY the matching (account, token) rows via `queue.enqueue` and never
  calls `refreshAccountBalances`; UI-origin without transfer info → ONE broad refresh and
  the early return (no double refresh); non-UI origin → broad refresh; a UI tx whose
  transfers name unknown contracts falls through to broad. Then sync
  `collectTransferParties(calls)` + `tokenIdsForContracts(contracts)`, and awaited
  `enqueueNarrowedBalances(addresses, tokenIds)` under the existing
  `addresses.size > 0 && contracts.size > 0` guard (its first op is the `repo.getAll`
  await). The if/else + `return` shape stays explicit in the caller.
- **`balance-job-queue.ts` `syncBatch` (34)** — sync `startBatchTasks` (the
  register-immediately task loop, whole), awaited `applyProjectedOk(result, …)` (the
  248–290 span moved VERBATIM: `repo.get` → four sync fences → `repo.set` →
  completeTask → post-write emittable re-check → emit; both awaits and every fence keep
  relative order), awaited `applyProjectedError` (failTask + `writeSyncFailure`),
  awaited `failBatchOnProjectorError` (the catch body), sync
  `releaseOwnedTaskPointers` (finally). Each awaited helper replaces a per-branch span
  that already awaits.
- **`balance-projector.ts` `projectChunk` (27)** — the three enqueue loops STAY INLINE
  (their awaits are per-iteration and conditional — a pass helper would add a hop on a
  chunk with no matching fn); only the always-awaited simulation tail moves:
  awaited `runBatchedSimulation(chainId, account, calls, perBalance)` under the
  existing `calls.length > 0` guard (`getViewSimulationDeps` is its first await), plus
  the network resolve stays inline. Main lands ≈ 9.
- **`reconcile-pairs.ts` `reconcilePlan` (22)** — pure sync: `groupAccountsByChain`,
  `buildDesiredPairs`, `classifyExistingRows`, and a named `comparePairs` replacing the
  nested-ternary sort key. Zero await surface.

## Decomposition — PR-b

- **`incoming-transfer/service.ts` — scanContract note arm (47), commitPublicEvent arm
  (35), drainBalanceOutbox arm (47)** — hoist each lock-callback body to a private method
  (`commitScannedNote`, `commitPublicEventLocked`, `drainOutboxRow`), the callback
  becoming `() => this.method(...)` (nesting 0 for every branch). Then per arm, awaited
  helpers whose spans already await and which keep their fences INSIDE:
  `backfillBlockTimestamp` (blockTimestampFor → epoch re-check → upsert);
  `resolveTrustTransition` (getTrust → epoch re-check → setTrust+emit as one sync pair →
  visibility-gated Pending emit) shared by the note and public arms;
  `commitDiscoveredRecord` (blockTimestampFor → epoch re-check → `markBalanceDirty` →
  [public arm: epoch re-check] → `upsertRecord` → visibility+epoch-gated Added emit —
  the D4 `markBalanceDirty → upsertRecord` adjacency never gains a hop);
  `resolveAnchoredOutboxRow` (sync `readTaskState` + ticket `isCurrent()` re-evaluated
  immediately before each write); `anchorFreshTask` (outbox re-read → `dirtyAt`
  staleness compare → `isCurrent()` → `setOutbox`, one atomic helper). The
  transient-throw catch around `requestBalanceRefresh` stays in the drain method.
  NON-mechanical: five distinct post-await epoch re-checks in the public arm — each
  stays in the continuation of its own await.
- **`token/seeder.ts` `doRun` (33)** — awaited `resolveSeedContext` (the five prelude
  reads, returning the bound `guardsHold` closure — NOT re-derived), awaited
  `skipIfAlreadySeeded` under the existing `isTokenPresent` branch, sync-then-awaited
  `recordAttempt` (the guard THEN increment ordering stays visible at the call site),
  and `commitSeedResult` = the `withMarkerLock` COMMIT block moved verbatim as ONE
  method — never decomposed further (the source's deadlock warning: any inner
  `updateMarker` would re-acquire the lock). The per-seed loop + try/catch stays in
  `doRun`.
- **`operation-journal/service.ts` `_transitionLocked` (29)** — sync asserts:
  `assertErrorInvariant`, `assertSucceededKindInvariant`, `assertNoHashDrift`. The
  `storage.set → emit` pair stays inline and adjacent.
- **`operation-journal/reaper.ts` `reap` (23)** — sync `shouldSkipRecord`,
  `classifyReapKind`, `buildReapReason`; the CAS `transitionIfStage` await + per-record
  try/catch stays in the loop.

## Equivalence

BL/C. New pins FIRST for `onTransactionUpdated` (committed before any refactor, byte-
identical after). Existing suites zero-edit green per PR (named above). Gates per
scope.md § 4, BOTH PRs, single sequential run: account-balance-orphans ·
balance-row-reconciliation · incoming-transfers · receive-unregistered ·
default-token-seeding · account-switch-isolation — plus audit:vue + test:ci-gating.

## Acceptance

- PR-a: 7 directives, 100 → 93, zero inserted (read the regen diff); tx-refresh pins
  green pre+post; store/queue/projector/reconcile suites + fuzz zero-edit.
- PR-b: 6 directives, 93 → 87, zero inserted; scenarios/seeder/journal/reaper suites
  zero-edit.
- Codex loop: one session — plan audit → PR-a impl review → PR-b impl review → approve.

## Rollback

Squash revert per PR; in-process refactors only — no storage shape, wire shape, or
journal-schema change.
