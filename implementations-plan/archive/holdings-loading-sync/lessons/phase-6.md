# Phase 6 — scan outcomes + sync-state deletion

## What shipped
- The per-contract sync-state API is gone in one piece: `getSyncState`, `onIncomingSyncStateChanged`,
  `IncomingSyncState/Snapshot/StateChanged`, `BACKFILL_INDICATOR_THRESHOLD_BLOCKS`,
  `emitSyncStateIfChanged` + its five call sites (the plan counted four; the class-gate early return was
  the fifth), `lagBehind`, the `syncState` map and its three clear sites, the client passthrough.
- `scan-health.ts` (pure): `ScanOutcome`, `isScanSuccess` / `isScanFailure`, `nextBackoffMs`, `isStalled`.
- `scanPublicContract` returns a `ScanOutcome` for the whole tick; `handleScanFailure` extracted;
  `stepReconciliation` and `forwardScanOnce` return outcomes. `pollPublic` does not consume the outcome
  yet — Phase 7 does.
- "§3 Catching up" describe replaced by "public-scan tick outcomes" (13 cases).

## Decisions
1. **Outcome is judged on the cursor, never on block coverage.** `progress` = a cursor write that the
   epoch fence accepted (`persistCursorLocked` returned `true`); a fenced-out write is `no-progress`.
   A multi-page pass whose LAST page was dropped still advanced the cursor over validated pages →
   `progress`; a node that then keeps dropping yields `no-progress` on the next tick, which is what the
   episode needs.
2. **`lastCoveredBlock` + `coveredBlock()` deleted** (the plan said "coverage data the outcome needs
   stays"). With decision 1 the outcome needs none, and the field's only reader was the deleted lag
   datum — it had become write-only persisted state. Pre-production: no migration; the schema is a
   non-strict `z.object`, so an old row carrying the key still parses (the key is stripped).
3. **Checkpoint-hash check moved ahead of the class gate.** The gate answered `unresolved` without a
   hash, which the new mapping would have reported as `failed`; the plan wants that degraded tick as
   `no-progress`. Side effect: `forwardScanOnce`'s own no-hash branch (which advanced
   `lastScanFinalized` without scanning) was already unreachable behind the gate; it is now a bare
   `no-progress` return.
4. **A reorged pending page and an anchored throw both report `failed`** even though the reconciliation
   they start may finish in the same tick. One `failed` cannot stall anything (`isStalled` needs ≥ 2
   failures AND > 10 min), and the next tick's `progress` / `idle-at-tip` clears the episode.

## Attempts
1. `bun run lint` exit 1 on the first run — one formatter diff in `service.ts` (a two-line `if … return`
   the formatter joins). `biome format --write`, then exit 0. The 30 warnings in the log are pre-existing
   e2e unused imports, not this diff.
2. The worktree Bash guard refuses `bun run "$VAR/…"` (a runtime-computed script path); literal paths work.

## Gate (as written in plan.md)
- `bun run typecheck:all` — exit 0
- `bun run lint` — exit 0
- `bun run --cwd apps/extension test src/wallet/services/incoming-transfer src/popup` — exit 0
  (100 files, 1061 tests)
