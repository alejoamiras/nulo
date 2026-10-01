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

## Merge-block mechanism: cancelled duplicate runs leave FAILURE aggregators

Opening a PR with `--label`s fires pull_request events for opened + each labeled — the
concurrency group cancels the duplicates, but their aggregator status jobs (`if: always()`)
conclude FAILURE on the same head SHA. GitHub resolves required checks latest-per-name, and
the duplicates' failure check-runs can WIN over the real runs' successes → mergeStateStatus
BLOCKED with every visible gate green. Diagnosis: list the head's check-runs — both a success
and a failure per status name is the signature. Remedy: fresh head (empty commit → single
synchronize event). Durable fix candidate (ledger follow-up, out of this arc's scope): the
aggregator jobs should conclude CANCELLED/neutral when their run is cancelled instead of
failure — today's shape makes every labeled PR-open a coin flip on check-run ordering.
