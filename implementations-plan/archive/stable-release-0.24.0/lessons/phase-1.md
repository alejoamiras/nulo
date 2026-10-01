# Phase 1 lessons — promote dev → main (2026-07-02)

## strict:true needed dev up-to-date FIRST
main's protection is `strict: true` + 3 required checks. dev was behind main by 2 (`#173` "rename required-check aggregators (main)", 3 lines / 3 workflow files) → the promote PR #250 opened as **BEHIND**.
- **`gh pr update-branch 250` FAILED** (opaque GraphQL error) — it tries to push a merge to the protected `dev` head, which dev's ruleset blocks.
- **Fallback that worked:** a manual `sync/main-to-dev-pre-0.24.0` PR — `git merge origin/main` (bring #173, signed), PR to dev, **commitlint-skips** (#223, sync-branch head), merged with `--merge`. dev then fast-forwarded up-to-date with main → #250 flipped BEHIND→BLOCKED→(CI)→CLEAN.
- The sync PR **skip-passed** smoke+network (the #173 workflow tweak is behavior-neutral) → only quality-status ran (~min), not the 25-min e2e. No gate neutralized.
- The 3-way merge kept main's `#173` (dev never touched those files); no revert.

## The Release PR's first CI failed FAST — a concurrency-cancellation flake, NOT breakage
Right after the promote merged, release-please opened #252 (`chore(main): release 0.24.0`) AND the promote's `push:main` `release.yml` run fired at the same instant. The PR-workflow **concurrency groups (cancel-in-progress)** cancelled #252's first CI → `Detect`/`Decide`/`Commitlint` = CANCELLED → the 3 aggregators failed in 2-5s with `A required job failed or was cancelled: cancelled`.
- **Diagnosis before action** (per the gate rule): a 2-5s aggregator failure ≠ a real test failure or a 25-min e2e flake — the log showed `cancelled`, not an assertion.
- **Fix = re-run** (never neutralize): once the promote's `release.yml` run completed (success), `gh run rerun <id>` on the 3 cancelled runs started a clean run (Detect pass, shards pending). GitHub resolves each required check to its LATEST run, so the fresh green supersedes the stale fail.
- Lesson: on a stable release, the promote-merge push and the release-please PR opening race on the concurrency group — expect a one-time cancel on the Release PR's first CI; re-run it, don't panic.

## Version confirmed
Stable cut = `0.24.0` (`compare/v0.23.0...v0.24.0`), version stamped into package.json + apps/extension/package.json + the stable manifest. The `v0.24.0-rc.0` tag did not poison it (Q2 held live).
