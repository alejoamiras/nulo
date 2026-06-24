# Phase 6 — Auto-unstick the v4 abort (in-run, guarded, flag-off)

The riskiest phase: it *restructures* release.yml's release-creation flow. Built via the fallback (no test repo), but safe by design — see "Why flag-off is the rehearsal".

## The wiring (logic in scripts, YAML is glue)
- **`scripts/release/auto-unstick-run.ts`** — the I/O runner around the pure `decideUnstick` (Phase 1, 11 tests). Resolves PR-by-commit (`gh api repos/{repo}/commits/{sha}/pulls`) + tag SHA (`git rev-parse {tag}^{commit}`), calls `decideUnstick`, performs tag + relabel + empty-release on `create`. **Zero-API short-circuit**: resolution runs only when flag on AND `release_created != true` AND `event==push` — so flag-off (default) and ordinary pushes make no `gh`/`git` calls. CLI entry (`import.meta.main`) builds the real `gh`/`git` IO + writes `unstuck`/`tag_name` to `$GITHUB_OUTPUT`; 10 unit tests inject a fake IO (the CLI never fires on import). 75/0 across `scripts/release/`.
- **`release.yml`**: NEW `auto-unstick` job `needs: release-please`, `if: always() && event=='push' && release_created != 'true'`, job-scoped `permissions: {contents: write, pull-requests: write}`, outputs `unstuck`+`tag_name`. `resolve` now `needs: [release-please, auto-unstick]`, its `if` gains `|| unstuck == 'true'`, and TAG falls back `${TAG_FROM_PLEASE:-$TAG_FROM_UNSTICK}`. Added to the `status` aggregator.

## Why flag-off is the rehearsal (the staged rollout, restated)
`vars.AUTO_UNSTICK_ENABLED` defaults OFF (unset = off). Flag-off, the job still RUNS but `decideUnstick`→`disabled`→exit 0, `unstuck=false` → `resolve` stays skipped on the abort path → **today's behavior exactly** (manual unstick still required). So the **first real release after this ships validates the entire job-graph restructure with the action inert** — if the wiring is wrong, the flag-off release reveals it without ever auto-creating a tag. Only after that clean release does the human flip the flag (`gh variable set AUTO_UNSTICK_ENABLED -b on`); the *second* release exercises the actual unstick. That two-release sequence is the rehearsal the test repo would have been — which is why no test repo was needed for the flow-restructure risk.

## Decisions
- **PR-to-SHA, never a title heuristic** (plan + codex): the guard is "merged PR at `github.sha`, base `main`, carries `autorelease: pending`". A `release:` promote PR (base main, no such label) correctly no-ops — unit-pinned.
- **Fail-closed on a wrong-SHA tag** → exit 1 (the job fails, `status` fails, `resolve` skips). Never re-points a tag.
- **In the `status` aggregator** (unlike advisory `verify-live`): flag-off it's always `success` (inert, no rollout impact); flag-on a genuine `abort`/infra failure SHOULD fail the pipeline. Safe to add now.
- **Token**: job-scoped `GITHUB_TOKEN` with `contents: write` + `pull-requests: write` — least-privilege, not a widening of an existing job's token. The annotated tag needs no signature (main's signed-commits rule covers commits; the tag points at the already-bot-signed merge commit).
- **Skip-semantics**: `resolve` already used `always()`, so adding `auto-unstick` to its `needs` doesn't change happy-path / workflow_dispatch behavior (auto-unstick skips on both; `resolve`'s explicit conditions gate it). `auto-unstick.if` uses `always()` so it runs whether release-please succeeded-empty OR failed.

## Gate — GREEN (fallback scope)
- `bun test scripts/release/` → 75 pass / 0 fail (incl. 10 new runner tests: zero-API short-circuit, create/skip/abort, double-fire idempotency, rc→prerelease, promote-PR no-op). `bun run lint:actions` → exit 0.
- Test-repo full-path rehearsal + real-repo `dry_run` pre-flight: SKIPPED (fallback). Proven instead by the staged flag-off→flip→flag-on release sequence above.

## DOC PRIORITY
CLAUDE.md § Release runbook gained an "Auto-unstick (staged rollout — currently OFF)" callout (what it does, the flag, how to flip, manual stays the fallback/source-of-truth). CI.md's `push:main` release-flow description now explains the abort + the `auto-unstick` job. Same commit.
