# Phase 4 — local smoke (A5 = none)

`CANDIDATE=092e9229f58b45794851a8aaf4a6ac28d3f63f5e` (clean tree; the Phase 3 commit).

## Smoke (2026-09-17)

Run alone from this worktree via `.playwright-mcp/smoke-run.sh` under tmux (the fixture build, then
`NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e`). Host at launch: 22 GiB
available; three foreign `aztec --local-network` sandboxes belonging to other agents' tools runs
(smoke needs no sandbox; noted for the record); no Chrome loaded from this dist.

```
HEAD=092e9229f58b45794851a8aaf4a6ac28d3f63f5e
BUILD_EXIT=0
Test Files  32 passed | 1 skipped (33)
Tests       123 passed | 6 skipped (129)
Duration    589.11s
EXIT=0
```

No red file, so no re-run and no baseline comparison. After the run: zero Chromes loaded from
this worktree's dist. The two `[import-stage-timing] record write failed` lines in the log are a
probe test writing to a deliberately missing path ("measurement lost, test unaffected").

## Network

Not run locally (A5 = none); the PR's required `extension-network-e2e-status` runs CI's partition
at retry 0 on this commit.
