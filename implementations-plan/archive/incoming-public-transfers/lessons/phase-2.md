# Phase 2 — Service: indexer module, scan arm, cursors, record identity, UI keying

Log for Phase 2 (the largest phase — `apps/extension` incoming-transfer service + record rewrite + UI keying + capability probe).

## What shipped

- **Record identity rewrite** (`spec.ts`): `IncomingTransferRecord` is now a zod
  `discriminatedUnion("kind", [note, public-event])` with a NEW profile+network-scoped `id` PK
  (`noteRecordId` / `publicRecordId`), `noteIndexInTx` → `indexInTx` (common field holding either
  index space), note-only `{siloedNullifier, noteHash, owner}` + public-only `{from, blockHash}`.
  Added `PublicScanCursor` + `IncomingBalanceOutboxRow` types/schemas/key-builders.
- **Repository** (`repository.ts`): records keyed by `id`; two new tables
  `nulo:core:incoming-public-cursors` + `nulo:core:incoming-balance-outbox`; `clearProfile`/
  `clearChain` fan out to cursor + outbox (key-prefix delete, survives a codec-invalid row).
- **`public-event-indexer.ts`**: injected paging collaborator — budgeted multi-page `scan`,
  cross-page cursor-monotonicity guard, `filterToRecipients`, single-page `probe` (reorg check).
  Never touches storage; `referenceBlock`-throw propagates unchanged (D6 signal).
- **Service public arm**: per-`(networkId, contract)` scheduler; node-direct class gate (D2) cached
  by the finalized tip; forward scan with the `pendingPage` crash window; **full D6 reconciliation**
  (rewind to persisted `lastScanFinalized`, hash-pinned staged/resumable `reconciling` marker,
  orphan delete-with-refresh-enqueue-first, mid-reconcile discard+restart, moved-receipt in-place
  update via `commitPublicEvent({reconcile:true})`). D4 write-side `markBalanceDirty` (drain = Phase 3).
  Lifecycle: token-delete deletes cursor + drops class-gate cache; account-add resets cursors;
  account-delete + purges fan out to outbox.
- **Runtime**: `getPublicScanTips` now also returns the checkpointed block HASH (via
  `node.getBlockData("checkpointed")`) — the D6 `upperBoundHash` fork anchor. **Narrow subpath
  export `@nulo/aztec-runtime/pxe/public-events`** so the extension spec doesn't drag the whole PXE
  barrel (see gotcha below).
- **UI identity propagation**: the 3 keying sites (`activity-rows.ts:72`,
  `useIncomingTransfers.ts:62/67/71`, `RecentActivityView.vue:111`) moved to `inc.id`.
- **Tests**: 37 new public-arm scenario tests (`service.scenarios.test.ts`) + 10 indexer unit tests;
  note-arm fixtures rewritten to the union shape; `storage-codecs` gained a public-event corpus row;
  e2e seed fixture (`incoming-transfers.test.ts`) updated to the new record shape; network-suite
  **capability probe** `public-events-capability.test.ts`.

## Phase-boundary decision (logged)
D3's per-event flow + D6 reconciliation both structurally need "write outbox BEFORE record/delete",
and Phase 2 has a named test for the reconciliation enqueue — so the **outbox table + write-side
(`markDirty`) landed in Phase 2**. **Phase 3 adds the DRAIN** (causal task-anchored ack), the
note-arm parity write, and the `TokenBalanceService`/`TaskService` deps. Each phase's gate stays
self-verifiable.

## Gotchas (verified)
- **`std::bad_cast` under jsdom** — the extension's `vitest.config.ts` runs in `jsdom` and sweeps in
  `packages/**/*.test.ts`, but EXCLUDES bb.js-heavy runtime tests (they crash under jsdom). My
  `public-events.test.ts` uses live bb.js (`computeLogTag` + the class-id hash) → added to that
  exclude list; it runs in the runtime's node-env suite (phase-1 gate + `test:all`). This is the
  established pattern (derivation-vectors / artifact-freeze / instantiation-descriptor).
- **`-122 write` (tmpfs full)** — under heavy multi-agent load `/tmp` (tmpfs, 16G) filled; vitest
  transforms of the large aztec JSONs failed with `Unknown system error -122, write`. Fix (CLAUDE.md
  run-isolation): `TMPDIR=~/.cache/nulo-vitest-tmp` (real disk) for all vitest runs.
- **Barrel-import bloat**: importing `PublicEventCursor` from the `@nulo/aztec-runtime/pxe` BARREL
  pulls `known-artifacts` → the `@wonderland-token-artifact` vite-alias JSONs. Narrow subpath
  `@nulo/aztec-runtime/pxe/public-events` avoids it.
- **Initial scheduler kick races unit tests**: `hydrateSchedulers` fires an immediate `pollPublic`
  that consumes the fake reader's queue / overwrites seeded cursors. Test harness `bootPublic`
  drains it (`flushPromises`) then clears cursors/outbox + the class-gate cache + reader counters.
- **Fixture id must be recomputed on spread**: `noteRecord({...recordA, siloedNullifier:X})` carried
  recordA's stale `id` → same-key collision. Helper now always recomputes `id` from the final fields.

## Validation gate — PASS (capability probe pending confirmation)
- `bun run audit:vue` → typecheck:all exit 0 · **test exit 0** (287 files, 3456 tests) · lint exit 0
  (41 pre-existing warnings) · build exit 0.
- Named scenario tests all present + green: public first-receive pending; dedupe vs own outgoing;
  partial-page cursor advance; page-budget; MAGIC/zero `from`; non-standard-class no-scan; same-tx
  note+public double record; D6 reconciliation (`referenceBlock`-throw detection, rewind to persisted
  `lastScanFinalized`, orphan-delete-enqueues-refresh, staged marker, mid-reconcile discard+restart,
  `pendingPage` crash window, deletions-by-blockHash-only); chain-purge epoch bail; account-add reset;
  token delete → cursor delete.
- `bun run e2e:agent -- public-events-capability.test.ts` — **PASS** (1 file, 3 tests) against the
  live sandbox: tips well-formed, `getPublicTokenTransferEvents` serves a well-formed page (proves
  the node serves `getPublicLogsByTags`, Inference 3), and the sandbox token gates as standard
  (never `non-standard`).

## Codex consults
None yet this phase.
</content>
