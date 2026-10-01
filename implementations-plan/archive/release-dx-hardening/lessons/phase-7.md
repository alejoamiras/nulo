# Phase 7 — Auto main→dev sync + prerelease re-baseline

Automates the manual "After a stable cut promotes to main" two-step into one PR the release run opens for you.

## The wiring (logic in scripts, YAML is glue)
- **`scripts/release/open-sync-pr-run.ts`** — I/O runner around the pure `syncEligible` + `decideSyncPrAction` (Phase 1, 10 tests). Resolves the Release-PR merge sha (zero-API unless push+stable), gates via `syncEligible`, then: idempotent open-PR check → branch FROM `origin/main` + prerelease-manifest re-baseline commit → `gh pr create --base dev` → GitHub-computed mergeability → clean leaves it, CONFLICTING/UNKNOWN labels `needs-manual-resolution` + comments. 9 unit tests (dispatch/prerelease/old-tag skip, idempotent exists, MERGEABLE clean, CONFLICTING + UNKNOWN fail-closed). `scripts/release/` → 84/0.
- **`release.yml`**: NEW `sync-main-to-dev` job `needs: [resolve, attach-assets]`, `if: always() && event=='push' && is_prerelease=='false' && attach-assets success`. Mints the App token, checks out with it, runs the runner.

## Decisions
- **One PR, not two.** The manual runbook is (1) merge main→dev, (2) separate manifest-bump PR. The job combines them: a branch off `origin/main` carries the release bump + CHANGELOG, plus one commit re-baselining `.release-please-prerelease-manifest.json`. Simpler for the human (one review).
- **Never a local merge** (codex). The runner branches from `origin/main` and lets GitHub compute mergeability — no `git merge` in CI that could half-resolve a conflict. Clean → human squash-merges; conflict → labeled, never auto-merged.
- **Signed-commits resolved from the existing release-please precedent (no codex consult needed).** dev requires signed commits, but a CI `git commit` isn't signed. Resolution: open the PR via the **App token** (exactly why release-please does — release.yml:55-58: App token makes the PR bot-verified AND triggers dev's required CI, which `GITHUB_TOKEN` would suppress), and the branch's own (unsigned) commit is fine because **dev is squash-only and the UI squash-merge is GitHub-signed**. This is an established repo pattern, not a novel fork — applied it directly rather than consulting.
- **Advisory, NOT in `status`** (like verify-live): it runs AFTER publish, so a sync hiccup must not retro-fail a shipped release. A conflict is surfaced as a labeled PR; an IO error reds only this job.
- **Push-only + sha==merge guard** (codex Critical-1): `syncEligible` rejects every `workflow_dispatch` AND requires `github.sha == the resolved Release-PR merge commit`, so a republish of an old tag (e.g. v0.20.0) can't re-sync. Defense in depth: the YAML `if` is also push-only.
- **`--force-with-lease` on the per-version `sync/main-to-dev-vX` branch**: bot-owned, disposable, never human-touched → NOT a hard-limit violation (the limit is force-push on main/release/human branches). Makes a re-run after a partial failure (branch pushed, PR-open failed) idempotent instead of wedging on a stale branch. The idempotency check (`findOpenSyncPr`) handles the already-open-PR case first.

## Gate — GREEN (fallback scope)
- `bun test scripts/release/` → 84 pass / 0 fail (incl. 9 new sync-runner tests). `bun run lint:actions` → exit 0.
- Test-repo rehearsal (happy-path PR + induced conflict → labeled PR + dispatch-no-fire): SKIPPED (fallback). Proven instead by the first stable real release (the job opens a real sync PR; observe + squash-merge).

## DOC PRIORITY
CLAUDE.md § "After a stable cut promotes to main" gained an "Automated (`sync-main-to-dev` job)" callout; the manual two-step is reframed as the fallback the job automates. CI.md's `push:main` flow lists the sync job. Same commit.
