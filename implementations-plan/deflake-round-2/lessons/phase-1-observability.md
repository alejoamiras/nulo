# Phase 1 (PR-1 observability) — lessons

## Gate evidence (2026-08-13)

lint + typecheck green; 6 sandbox-free pins green (3 formatter, 2 assertPgOk stub-page, 1
child-vitest reporter integration, 351ms — bun+cached-vitest child spawns really are that
fast, verified standalone before trusting the green); armed smoke sanity chunk green; FULL
network suite solo `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1`: **65 files / 87 tests, attempt-1,
zero retries** (after the self-inflicted-load episode below).

## Self-inflicted load reds — the run-solo rule applies to MY OWN shell too

First full-suite run: 3 reds (authwit-lifecycle ConnectionClosedError at newPage;
authwit-variants fixture verify-popup race; session-reconnect 30s setup timeout) — zero
assertion failures, all infrastructure shapes. Cause: I ran monorepo typechecks + pin suites
DURING the run, treating only codex (API-bound) as safe. Trio solo rerun at true idle: 3/3
attempt-1. Clean full rerun at true idle: all green. Rule sharpened: while a network suite
runs, the session runs NOTHING local — no typecheck, no vitest, no builds; API-bound consults
only.

Census note (retry=0 exposure): the two fixture-side shapes (approveVerify "persistence may
be racy" label; session-reconnect setup wait) are load-triggered, not steady-state flakes —
both green solo. Not ledgered as flakes; noted here as load-sensitivity markers.
