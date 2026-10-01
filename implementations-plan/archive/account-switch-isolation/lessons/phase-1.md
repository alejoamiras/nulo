# Phase 1 — complete containment (Layer A, drop-only, no sequence numbers)

## Done + committed (6899d98) — incoming-transfer containment (ingest + render)
- **`useIncomingTransfers.ts`** (composable, shared by RecentActivityView + activity.vue):
  - `flush:'sync'` scope watcher on `scopeKey(scope())` → clears `incomingTransfers.value=[]` immediately on
    account/network/profile switch, then `refresh()`. Sync so B never paints A's rows for a tick.
  - `refresh()` captures `{scopeKey, refreshSeq}`; drops the result if disposed / a newer refresh started /
    the active scope changed during the await (A→B→A safe).
  - `onAdded`/`onUpdated` accept ONLY when `inc.profileId/networkId/accountAddress === live scope`; drop else
    (the service broadcasts every account's events to every client — enforce active account HERE, never trust
    the wire, never infer). `onDeleted` left unscoped (strictly subtractive, filter by unique nullifier).
  - Tests: 18 (added foreign-account/network/profile drop, sync clear+refetch on switch, A→B→A generation).
- **`buildActivityRows` (`utils/activity-rows.ts`)** — render-time defense-in-depth: tx filtered by
  `account`+`chainId`, incoming by `accountAddress`+`networkId` (journal already was). Applied only when the
  scope field is supplied; `activity.vue` now passes `chainId`+`networkId`. Tests: 13 (+4 scope-filter cases).

## Remaining Phase 1 (delegated / next)
- **`app.store.ts`** (Layer-A store containment):
  - `activityGeneration` ref + `resetActiveFeedState()`; bump + reset in the SINGLE active-account mutation
    choke point (the `app.vue:87` watcher path / centralized setter). Sync clear of `transactions` on switch.
  - `syncTransactions` (:153-157): capture generation before the await, assign only if still current + filter
    rows to captured account+chain (mirror `syncNetworkStatus`'s `oldNetworkId` guard).
  - `onTxAdded`: update the active view only when tx scope == live scope; placeholder cleanup by `tx.account`
    + captured scope (not active). `onTxUpdated`: require account **plus** hash (hash-only hits the wrong
    account's row). `send.vue`: unique awaiting-placeholder id + captured scope on rejection.
- **`RecentActivityView.vue`** (878 lines — minimal, additive; a later phase restructures):
  - switch-reset watcher (reset journalOps/executingTask/executingSubtasks/pendingCancelJobIds + re-snapshot);
    captured-account guard on each async resolution (getOperations, getTasks).
  - its INLINE `recentActivityRows` merge (:103-112) needs the same tx+incoming account scope filter.
  - `hasOrphanExecutingTask` (:427) require `executingTask` in active scope; account-scope dApp `isExecutingTask`
    (:568-580). Scope the jobId-only `clearExecutingTaskIfPendingCancelTerminal` (:480-486). **Until the Phase-1a
    task↔journal binding lands, DISABLE all uncorrelated TaskService cards + journal enrichment** (fail-closed).
- **`incoming-transfer/service.ts`** (trust-boundary hardening, Phase 1.6/1.8):
  - fail-closed wire-event validation (service param + client result + event-dispatch override); reject
    `renderError`/malformed; `content.owner` present-and-!==accountAddress → drop, canonicalize-or-drop owner,
    static no-read guard; pin UintNote schema + storage slot; identity `(scope, siloedNullifier)` not global.
  - `isVisibilityEnabled` (:692-701) fail-OPEN → fail-CLOSED for UI emission/read (retain records).

## Gate 1 (run after the above)
lint · typecheck:all · `bun run test <store/composable/component paths>` · `bun run test:e2e` ·
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts`
(extend the harness test with the full isolation assertions) · full `e2e:agent` · negative-grep.

## Service hardening (Phase 1.6/1.8) — done + deliberate deferrals
- **isVisibilityEnabled fail-CLOSED** (`service.ts` ~733): config-error catch now returns `false` (was `true`).
  A privacy toggle must not surface hidden receives on a port hiccup; the record persists hidden → reappears
  when visibility resolves. Test: config throws for the visibility key → no Added emit, record still persisted.
- **Owner trust-boundary drop** (`scanContract`, after the amount parse): if `note.content.owner` is PRESENT
  and ≠ the scan `accountAddress`, DROP the note (PXE only decrypts under the scan account; a disagreeing owner
  is anomalous). Every scope/dedup/render path keys on `accountAddress`/`siloedNullifier`, never `owner`. Tests:
  owner-mismatch dropped; owner-match accepted. 53 scenarios green.

### Deferred / judged-unnecessary (flag for post-impl auditors)
- **(scope, siloedNullifier) re-keying — DEFERRED (rationale corrected by codex).** A siloed nullifier is unique
  within ONE rollup's nullifier tree, NOT across independent `networkId` trees — cloned/forked chains can repeat
  the value, so the global key has a cross-NETWORK collision (data-loss) risk. UI scope filters still prevent
  DISCLOSURE, so the re-key is a safe FOLLOW-UP for this same-network privacy fix, but must land before multi-net.
- **Wire-event validation (service param + client result + dispatch override) — DEFERRED** as lower-priority
  defense-in-depth. The cross-account LEAK is already closed at every UI ingress (composable scope-filter +
  store generation/scope guards + component + buildActivityRows), so an unvalidated malformed event is a
  robustness concern, not a privacy leak. It touches the shared extension-messaging dispatch layer (broad blast
  radius on a stable system) — deferring keeps Phase 1 low-risk. Revisit as a follow-up / let the auditors weigh.

## Phase 1 CONTAINMENT complete (all four facets closed at the UI/store layer). Next: Gate 1.
Extend `tests/e2e/network/account-switch-isolation.test.ts` from the Phase-0 harness to the FULL isolation
assertions (a real note lands on A while B is active → never surfaces in B; + a settled A tx via an
extension-submitted tx; positive control switch-back), then run the network gate + full suite.

## Gate 1 GREEN — Phase 1 complete (network-proven)
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 e2e:agent account-switch-isolation.test.ts` → 2/2 passed (94s):
the Phase-0 harness + the full isolation test (A's incoming + settled tx render 0 cards in B while B is
active + observer no-leak; positive control back-to-A reappears). Asserted on the History surface
(deterministic root; the general RecentActivityView root vanishes for a contained fresh B). Full suite
3473, typecheck:all 0, smoke re-run. Phase 1 = the SHIPPABLE privacy fix, done.
Phase 1a (re-enable correlated dApp task cards via an atomic taskId↔journalId binding) is separate/next;
until then uncorrelated dApp task cards stay disabled (fail-closed).

## Smoke note (NOT a regression) — migration-arming contract
Local `bun run test:e2e` reports 73 passed / 1 failed: `backup-migration.test.ts > "fixture-arming
contract: unarmed runs are allowed ONLY against a release artifact"`. This is a PRE-EXISTING guard:
`if (!HAS_FIXTURE) expect(IS_RELEASE_ARTIFACT_RUN).toBe(true)` where both come from env
(`NULO_E2E_MIGRATION_FIXTURE`, `NULO_E2E_ARTIFACT_RUN`). `test:e2e` (= `vitest run`) does NOT arm the
migration fixture; only `agent.sh` does. So a plain local smoke fails this contract BY DESIGN; CI arms
it (`_smoke-e2e.yml:41`) → green. Orthogonal to account-switch (no migrations/backup/build-config touched).
Gate-1 account-switch layers are all green: lint · typecheck:all · 3473 unit/component · isolation e2e
2/2 · negative-grep · 73/73 relevant smoke tests. The migration smoke is a CI concern, unaffected here.

## Codex PRE-MERGE audit — REJECT (blocking; fixing before PR). Consult logged.
audit-codex-postimpl.md. 3 blocking + regressions + deferral-rationale correction:
1. BLOCKING journal-detail bypass: `journal/[id].vue` loadOp fetches by id, no scope guard/watch → A's
   journal detail (amount/recipient/dApp origin) stays under B. FIX: scope-validate + watch account.
2. BLOCKING read fail-open: `getIncomingTransfers` (service.ts:283-296) returns records on config error;
   only emit was fail-closed. FIX: fail-closed read via isVisibilityEnabled.
3. BLOCKING regression: owner-mismatch drop is WRONG — `content.owner` = TRUSTED NoteDao.owner (not sender
   content); delegated discovery legitimately has owner != accountAddress. REVERT the drop + its 2 tests.
4. Nullifier claim CORRECTED: siloed nullifiers unique within ONE rollup tree, NOT across networkId trees →
   cross-network collision risk. Re-key stays a follow-up (UI filters prevent disclosure) but rationale fixed.
5. Non-blocking (Layer-B / Phase 2-3, don't cause foreign RENDER): event-during-snapshot reschedule absent;
   journal/task A→B→A address-only guard (stale resurrection). e2e gaps: commits-before-switch (not live race),
   observer omits tx-card, History has no awaiting cards (vacuous). Noted for hardening/Phase 2-3.
