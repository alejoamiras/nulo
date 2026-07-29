# Phase 3 — release-please Release PR #321 (0.26.0)

**Status:** ✓ GREEN — merged.

## Resolution
- Live batch all green (Network e2e / Quality / Smoke e2e latest runs = success); aggregators superseded the stale cancelled ones → `mergeable=MERGEABLE state=CLEAN`, 0 fails.
- Merged #321 via `gh pr merge 321 --merge`. Merge commit **`TAG_SHA=bffaad26e0601765119e34f72df2018644cc101d`**; 2-parent check = 3 → merge-commit. `origin/main` advanced.
- `TAG_SHA` is what Phase 4 tag `v0.26.0` + the built artifacts + the faucet `buildId` must derive from (distinct from `RELEASE_SHA=4e5435b`).

## CHANGELOG review ✓
- Version `0.26.0`, compares `v0.25.0...v0.26.0`, dated 2026-07-24. All 21 PRs correctly categorized (Features/Bug Fixes/Tests/Misc/Docs). Accurate. Version matches expectation.

## Superseded-run artifact (NOT breakage)
- First read: all 3 required aggregators `fail` while 12 checks pending — alarming, investigated before any action.
- Root cause: **two CI batches on the same head SHA `06aa9c9`**. The FIRST batch (Quality `30061618335`, Smoke `30061618329`, Network `30061618342`) is `cancelled` → a cancelled run's status check reports as FAILURE, producing the 3 "fail" aggregators. The SECOND batch (Quality `30061618563`, Smoke `30061618534`, Network `30061618511`) is `in_progress` — the authoritative run.
- GitHub required-check evaluation uses the LATEST check-run per context, so the live batch's results supersede the cancelled ones. No re-run, no merge until the live batch completes.
- Watch-script weakness noted: exiting on "3 aggregators non-pending" tripped on the stale cancelled-run FAILUREs. Switched to a **run-completion watcher** keyed on the head SHA (latest run per Network/Quality/Smoke workflow must conclude `success`).
- Likely cancellation cause: the gating workflows re-triggered on the same SHA (pull_request opened→synchronize/ready or an app re-fire) and `cancel-in-progress` killed the first invocation. Benign as long as the live batch runs to completion.
