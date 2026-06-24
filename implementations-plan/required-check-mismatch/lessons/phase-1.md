# Phase 1 — Rename the three required aggregator jobs

## What
Renamed the `name:` of the `Status` aggregator job in the three workflows whose `Status` is in the required set, so each produces a **unique, bare** check-run name that branch protection can match:

| Workflow | job key | `name:` before | `name:` after |
|---|---|---|---|
| `pr-quick.yml` (workflow `Quality`) | `status` | `Status` | `quality-status` |
| `pr-network-e2e.yml` (workflow `Network e2e`) | `status` | `Status` | `network-e2e-status` |
| `pr-smoke-e2e.yml` (workflow `Smoke e2e`) | `status` | `Status` | `smoke-e2e-status` |

Only the `name:` changed. The job **key** (`status:`) is unchanged — verified no other job references it via `needs:` (grep returned none), so the key rename was unnecessary and would only risk churn. `if: always()` and the `needs:` aggregation lists are byte-identical (confirmed in the diff).

## Out of scope (per both audits)
- `release.yml` — its job is `name: status` (lowercase), runs on `push:main`/`workflow_dispatch` only, never on `pull_request`. Not a PR check-run, not a required context → causally irrelevant.
- The Lint workflow's `Status` — produced but **not** in the required set → harmless. Left bare.

## Validation gate — PASS
- `bun run lint:actions` (actionlint) → exit 0, no findings.
- `git diff` on the three workflows → exactly three `name:` lines changed, nothing else.

## Why a bare name (the crux, settled by both auditors + verified live)
GitHub Actions matches a required check by exact string against the produced **check-run name**. A normal job's check-run name is its **bare** job `name:` (`quality-status`); only `uses:` reusable-workflow jobs get a `{caller}/{inner}` prefix. The old required context `Quality / Status` was a hand-typed phantom (the workflow-level `name:` never enters the check-run name) → it never matched the produced bare `Status` → the gate hung `Expected` forever. After this rename the required context must be the bare `quality-status` etc. — **observed live in Phase 2 before re-pointing**, never assumed.

## Next
Phase 2 cannot start until this rename is on `dev` (so a `dev` PR produces the new names). PR1 → dev carries the rename + the plan artifacts. The branch-protection re-point is a live API op (Phase 2), not part of this PR.
