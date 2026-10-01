# Phase 5 — regression sweep + docs

| Gate | Result |
|---|---|
| `bun run audit:vue` | exit 0 — 5078 tests passed / 2 skipped, then chrome build ✓ |
| Armed source smoke (`VITE_NULO_E2E_MIGRATION_FIXTURE=1` + testnet default + token-seed pair build, both markers grepped present, `NULO_E2E_MIGRATION_FIXTURE=1 test:e2e`) | 31 files / 112 tests passed, EXIT=0 |
| Unarmed artifact-mode smoke (plain rebuild, armed marker grepped ABSENT, `NULO_E2E_ARTIFACT_RUN=1 test:e2e`) | 29 files / 105 tests passed (3/13 skipped — the artifact-mode skips), EXIT=0 |
| `NULO_E2E_PROVERLESS=1 bun run e2e:agent` (full network suite) | 74 files passed / 2 skipped (76), zero failures, retry-0 clean |

`ARCHITECTURE.md` balance-row bullet rewritten for the new invariants (identity triple,
shared predicate, stale-identity deletion, legacy sweep, registered tuple purge).

## Findings

- The first source-smoke attempt failed the **fixture-arming contract** by design: the
  audit:vue build is unarmed, and `backup-migration.test.ts` fails-closed on an unarmed
  repo build (`Build with VITE_NULO_E2E_MIGRATION_FIXTURE=1…`). Not a regression — the
  guard doing its job; the armed rebuild (exact `_smoke-e2e.yml` env set) passed clean.
- No flakes anywhere in the sweep: every suite passed on its first (retry-0) attempt,
  including the full network run with the new orphan spec in it.
