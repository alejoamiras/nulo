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
