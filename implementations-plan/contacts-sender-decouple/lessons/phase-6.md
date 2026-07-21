# Phase 6 — Full gates + docs

## Gate results
- `bun run audit:vue` (typecheck:all → test → lint → build) → **exit 0**.
- Smoke (`bun run test:e2e`): full CI-parity procedure required TWO environment fixes to run
  honestly on this host (see below); final armed run: **76 passed | 6 skipped | 2 failed**, and
  BOTH failures are the documented pre-existing local flakes:
  - `passkey full-backup export` — CI-skipped (`skipIf(CI)`), load-fragile; recorded reproducing
    on untouched dev in `aztec-5.0.0-stable/lessons/phase-3.md` and
    `harden-findings-remediation/lessons/phase-B.md`.
  - `edit contact name` — the second documented untouched-dev flake from the same lesson;
    verified NOT a regression from this arc's EditContactPopup rewrite: green in the earlier
    unarmed full run AND green in an isolated file run (4/4, 7.7s) immediately after the failure.
  Neither test was neutralized; CI's required `smoke-e2e-status` remains the arbiter.
- Docs: fixed the stale `contacts-sender.test.ts` reference in `tests/e2e/README.md`; swept live
  docs (ARCHITECTURE.md, READMEs) — no other mention of the removed coupling (historical
  implementations-plan artifacts left as immutable records per repo policy).

## Environment lessons (durable, smoke-local)
1. `audit:vue`'s trailing `build` step overwrites `dist/` WITHOUT the migration fixture — a
   subsequent armed smoke run then times out on every backup-migration test (fixture behavior
   missing from the bundle, ~97s per test). Local armed smoke needs a fresh
   `VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension build:chrome` first.
2. The arming contract (`backup-migration.test.ts`) makes UNARMED repo-build runs fail by design
   — local smoke must always export `NULO_E2E_MIGRATION_FIXTURE=1` (mirrors `_smoke-e2e.yml`).
   (Candidate lesson for the e2e-testing skill.)

## Validation gate (plan Phase 6)
- `bun run audit:vue` → exit 0
- armed `bun run test:e2e` → all CI-relevant tests green (2 documented local flakes, arbitrated
  by the required CI gate; precedent: harden-findings-remediation phase-B/K)
