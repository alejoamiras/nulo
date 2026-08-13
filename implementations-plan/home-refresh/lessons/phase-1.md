# Phase 1 lessons — substrate (blocksBehind, seed label, cursor fix)

## Block-cadence measurement (sizes `BACKFILL_INDICATOR_THRESHOLD_BLOCKS`)

Raw samples (`node_getBlockNumber` JSON-RPC against the two seeded dRPC endpoints, 2026-08-13):

| network | t1 (unix) | block1 | t2 (unix) | block2 | Δblocks | Δt |
|---|---|---|---|---|---|---|
| Alpha V5 | 1786635240 | 46000 | 1786635421 | 46002 | 2 | 181 s |
| Testnet | 1786635240 | 41424 | 1786635422 | 41426 | 2 | 182 s |

Point estimate ≈ 90 s/block on BOTH networks (no divergence → single constant, no per-ChainKind map).
A 2-block sample quantizes the true cadence to roughly 60–180 s/block, so the constant uses the
FASTEST plausible cadence: 900 s ÷ 60 s = **15 blocks** — the conservative direction (the dot
under-triggers; at the 90 s point estimate, 15 blocks ≈ 22.5 min). Constant + reasoning live in
`incoming-transfer/spec.ts`.

Tooling note: `@aztec/aztec.js` isn't bun-resolvable from outside the workspace packages (scripts in
scratch dirs / package roots failed with "Cannot find module") — raw JSON-RPC via curl was the clean
path (`node_getBlockNumber`, no params).

## Coverage watermark — the test-harness probe gotcha

Two new threshold-crossing tests initially failed with `caught-up, 0` instead of `backfilling, N`:
after a COMMITTED pass persists `lastSyncedBlockHash`, every subsequent `scanPublicContract` runs the
boundary ancestry probe, and `indexer.probe()` consumes ONE `fetchTransferPage` response from the
fake reader's queue before the scan pages. Any multi-pass sync-state test must push a `probeAck()`
placeholder ahead of each post-anchor pass's pages (existing tests dodge this by seeding
`lastSyncedBlockHash: null` — the CRITICAL quiet-token test's comment says exactly that). Also: the
indexer aggregates up to 5 pages per scan; a lone `hasMore: true` response falls through to the
default EOF page and reads as reached-tip — partial passes must exhaust the page budget (5
strictly-advancing positions), mirroring `budgetIncomplete()`.

## Lint gate reading

`bun run lint` (biome) carries 37 pre-existing warnings + 11 infos on dev; only error-severity
diagnostics fail the script. The two errors after my edits were MY unformatted lines (biome format),
not the pre-existing noise — `--diagnostic-level=error` is the fast way to separate them.

## Gate result (2026-08-13)

- `bun run typecheck:all` → exit 0 (all workspaces)
- `bun run test` → 4032 passed | 2 skipped | 7 todo (includes the 7 new sync-state cases: quiet-token
  transient failure, restart watermark, mid-reconciliation, cold start, crossing down+silent bucket,
  crossing up, unknown-key snapshot; + the seeded-dRPC-label network test)
- `bun run --cwd packages/design test` → 37 files / 295 passed (new base.css hash pinned)
- `bun run lint` → 0 errors
- Post-format re-run of the two touched test files → 182 passed
