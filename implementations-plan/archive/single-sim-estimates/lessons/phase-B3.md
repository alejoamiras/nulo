# Phase B3 — Full validation

## Gate results (all exit 0, at final HEAD e8d50dd+)

- `bun run audit:vue` — typecheck:all 4/4, 3926+ unit/component tests, lint, build.
- Armed smoke (`NULO_E2E_PROVERLESS=1 NULO_E2E_MIGRATION_FIXTURE=1
  VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`) — 79 passed / 0 failed. The smoke's
  own arming-contract test REQUIRES the migration-fixture pair on repo builds (mirrors
  `_smoke-e2e.yml`); a proverless-only env fails that contract by design.
- Full `NULO_E2E_PROVERLESS=1 bun run e2e:agent` — **65 files / 87 tests green** on the
  final tree (and green on the pre-codex-fix tree — two consecutive solo runs).
- Final `bun run test` 3927 passed · `bun run lint` clean.

## The mass-failure detour (recorded)

The first full-suite attempt failed 42 tests across 36 unrelated files. Root cause:
CONCURRENT HOST LOAD — the run shared the machine with `audit:vue` (build) and the full
vitest suite; 25s/70s e2e timeouts drowned. Two red herrings ruled out along the way (both
now in the `e2e-testing` skill): the one-line `[aztec-node] Address already in use` at boot
appears in green runs too (benign sub-service retry), and the 3-day-old orphaned sandbox
pair (reaped by pgid) held unrelated ports. A solo re-run was 87/87 with zero code changes.
Rule: the network e2e suite runs ALONE; its wall-clock is reserved.
