# Phase 1 — Delete the [SYNC-DEBUG] round-trips

- Both blocks removed from `packages/aztec-runtime/src/pxe/service.ts` (proveTx + simulateTx). Each was an unconditional `pxe.getSyncedBlockHeader()` + `node.getBlockNumber()` (a real node RPC) inside the exclusive `withPxeWrite` lock, purely feeding a debug log line. The `node` callback param became unused in both closures and was dropped (`(pxe, node)` → `(pxe)`), matching biome's unused-parameter rule.
- No test asserted on the lines (verified in recon); no replacement logging added (flag-gating would need an `ILogger.isEnabled` predicate that doesn't exist — plan decision #3).

## Gate result: PASS
- `grep -rn "SYNC-DEBUG" packages/ apps/ | wc -l` → 0
- `bun run lint` exit 0 (same 33 pre-existing dev warnings, none introduced)
- `bun run typecheck:all` all packages exit 0
- `bun run test` → 302 files / 3748 tests passed, 2 skipped
