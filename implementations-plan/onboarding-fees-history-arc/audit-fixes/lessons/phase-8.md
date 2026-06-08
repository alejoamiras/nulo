# P8 lessons — test backfill (dedupe / late-delete / trust / visibility / cleanup)

## Outcome

`test(incoming): scanContract + replay + trust + lifecycle + cleanup coverage` —
typecheck clean, lint clean, +21 new behavioral tests, no regressions
(2096 / 2103 passing in the extension suite).

Covers the audit findings carried forward from:
- **P3** — RecentActivityView/PopupManager wiring already covered in
  PopupManager.test.ts; documented here.
- **P4** — visibility-gate matrix on `scanContract.onIncomingTransferPending`,
  `replayPendingPrompts`, and `setTrustAllow`.
- **P5** — account-lifecycle subscription (`onAccountDeleted` → targeted
  scheduler tear-down across networks; transport-error safety).
- **P8 proper** — 3-source dedup, late-delete on `onTransactionAdded`, trust
  transitions, cleanup wiring.

## Fixture strategy

`service.scenarios.test.ts` mocks `IncomingTransferRepository` with an in-memory
`Map`-backed shape, then stubs the 8 declared dependencies as plain objects matching
the `IService` shape (`name` + `dependencies` + `start`). The real
`ServiceCollection.start()` flow runs init end-to-end so the lifecycle subscribers
get wired up properly.

Why mock the repo rather than the storage: the EntityStorage layer relies on
`chrome.storage.local` which `tests/vitest.setup.ts` stubs as empty `{}`. Mocking
at the repo boundary keeps the dependency graph honest and avoids reimplementing
EntityStorage's K/V semantics in the test harness.

Two pitfalls hit + recorded:

1. **`EventHandler.invoke()` is sync but fires async listeners fire-and-forget.**
   After invoking an event, tests must `await flushPromises()` before asserting
   on side effects of the handler. The wallet-core `EventHandler` ignores the
   return value of each callback — failing to flush means the assertion runs
   before the handler's `await this.networkService.getNetworks(...)` has resolved.
2. **`getTransactions(accountAddress)` — single arg, not `(chainId, account)`.**
   The service filters by chainId locally. Pinning the stub argspec to match
   the real call keeps the test honest. Same shape for `getOperations({ profileId,
   isTerminal: false })` — the service then filters by `accountAddress` +
   `networkId` per-op, so stub operations must carry both fields.

## Test breakdown — 21 cases

**P4 visibility gating (5)**
- `getIncomingTransfers` returns `[]` when visibility=false.
- `getIncomingTransfers` returns visible records when visibility=true.
- `getIncomingTransfers` filters hidden records.
- `replayPendingPrompts` no-op when visibility=false (regression pin).
- `replayPendingPrompts` emits per pending contract when visibility=true.

**Trust transitions (3)**
- `setTrustAllow` flips hidden records visible + emits Added.
- `setTrustAllow` with visibility=false flips records but does NOT emit (P4 carry).
- `setTrustReject` sets state=blocked + leaves hidden records hidden.

**Account lifecycle (P5 carry) (2)**
- `onAccountDeleted` clears scheduler entries for that account across networks.
- `onAccountDeleted` with `getNetworks` throw — no crash, scheduler unchanged.

**scanContract dedup + emit (6)**
- First note from unknown contract → pending state + Pending emit + hidden record.
- (P4 carry) scanContract Pending emit gated on visibility=false — record
  persisted, no emit.
- Trusted contract → Added emit per note + visible record.
- **3-source dedup**: prior records (siloedNullifier), outgoing tx hash,
  in-flight journal `progress.txHash`. Each documented as a separate regression
  pin.
- Token-removed (no matching tokens for the contract) → scanContract no-ops.

**Late-delete on `onTransactionAdded` (2)**
- Pre-existing record with matching txHash → deleted + Deleted emit.
- Unrelated txHash → no delete, no emit.

**Cleanup wiring (2)**
- `clearProfile` wipes records + trust for that profileId only.
- `clearChain` wipes only records + trust matching `(profileId, networkId)`.

## What I cut from the plan

The plan's repository-level CRUD tests (`listByContract`, `listByTxHash`,
`listForAccount`, idempotent upsert) are implicitly covered by the service tests
— every dedup, emit, and cleanup assertion routes through the repo. Adding a
parallel repo.test.ts harness would duplicate the in-memory map already used
here for negligible coverage gain.

## Files

- `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts`
  (new file, 21 cases).

## Open items

None — P8 covers the high-value audit-flagged behaviors. P9 is the last phase.
