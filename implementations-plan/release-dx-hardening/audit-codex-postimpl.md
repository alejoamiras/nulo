# Codex post-implementation audit — release-dx-hardening

Session `019ef0db-241e-7c72-b3cc-443c0083add7`, xhigh, read-only, against the 16-commit branch. Verdict: **"Not ready — real correctness holes in the release path, plus avoidable token over-grant."** Findings + dispositions below (all verified against the code before acting — codex isn't an oracle).

## Critical — both FIXED
1. **Silent false-green on auto-unstick lookup failure.** `resolveMergedPr` returned `null` on any `gh api` failure → `decideUnstick` noop → `resolve` skips → `status` ignores skipped → a transient GitHub/auth error leaves the release stuck but green. **Fix:** the real `resolveMergedPr` now THROWS on `exitCode != 0` (a commit with no PRs is exit 0 + empty output, still null). Fails loud → job red → surfaced.
2. **Sync PR cut from moving `origin/main`, not the release SHA.** If another PR lands on `main` during the long release run, the "sync for vX.Y.Z" PR carried later unpublished work. **Fix:** `prepareSyncBranch` now branches from `baseSha` (= `github.sha`, the release commit), not `origin/main`.

## Should-fix — 2 FIXED, 1 deferred to /harden
3. **Auto-unstick not rerun-safe after partial success.** Tag pushed before the release created; if `createRelease` failed after the tag existed, a rerun hit "tag exists → skip" and never repaired the missing release. **Fix:** `createRelease` → idempotent `ensureRelease` (`gh release view || create`); the `skip` path now HEALS (ensures release + relabel), never a 2nd tag.
4. **verify-live could pass an old-but-self-consistent faucet.** Only checked HTML↔JSON buildId match + chainId, not freshness; a prior release's faucet (both files stale together) passed. The faucet version is decoupled from the release, so the **sha** is the freshness signal. **Fix:** plumbed `expectedSha` (the release commit) into verify-live; the faucet buildId's sha component (`version+sha`) must equal the release sha's first 8.
5. **Permissions broader than needed** (workflow-wide `contents/pull-requests/issues: write` inherited by build/test jobs; auto-unstick needs only pull-requests:read not write). **DEFERRED to `/harden security`** (its domain — the next gauntlet step). Note: this partially revises the issues:write I added in the /code-review round — auto-unstick needs issues:write (label) + pull-requests:READ; sync needs both writes.

## Nit — deferred
6. **`resolve-tag.ts` is tested but unwired** — the live `resolve` job still duplicates the logic in bash. Wiring it cleanly needs a `resolve-tag-run.ts` I/O wrapper + restructuring a load-bearing job; deferred as a clean follow-up (codex's lowest severity).

## Looks-fine (codex confirmed)
- Flag-off auto-unstick is side-effect inert; `resolve` stays skipped.
- `workflow_dispatch` republish does not reopen sync PRs (push-only + sha re-check).
- The signed-commit rationale holds given dev's UI-squash-only merge rule.

Post-fix: `scripts/release/` 85 pass / 0 fail; actionlint clean.
