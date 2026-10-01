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

## Live observations on PR #170 (the rename PR)

- **The 4th `Status` is `actionlint.yml`** (workflow display name "Lint workflows"), confirmed via `gh run view <run> --json workflowName`. It is **not** in the required set → harmless, correctly left bare. (`network-e2e-soak.yml` also has a `name: Status` aggregator but is schedule/dispatch-only — it never runs on `pull_request`, so it produces no PR check-run.) So the historical "Status ×4" = Quality + Network e2e + Smoke e2e + actionlint.
- **`app_id` pin value observed live = `15368`** (slug `github-actions`) on the actionlint `Status` run. NOTE: the check-runs API nests it at `.app.id`, **not** a top-level `.app_id` (my first probe wrongly read `.app_id` → `null`). The Phase-2 re-point reads `.app.id`.
- **head-vs-base naming (the "observe, don't assume" step):** the aggregator job is `if: always()` + `needs:[…]`, so its check-run only registers once its needs finish (~8 min for quality; ~25 min for network). GitHub's documented rule is that a `pull_request` run uses the **head ref's** workflow file (why a PR can test its own workflow edits), so #170's aggregators should register as `quality-status` / `network-e2e-status` / `smoke-e2e-status`. Confirming empirically via poller before re-pointing — `pull_request_target` (base-ref) is NOT in play here.

## Next
Phase 2 cannot start until this rename is on `dev` (so a `dev` PR produces the new names). PR1 (#170) → dev carries the rename + the plan artifacts; it merges via `--admin` one final time (the phantom gate is still required for it). The branch-protection re-point is a live API op (Phase 2), not part of this PR.
