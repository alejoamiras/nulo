# Phase 3 — Release PR #338 (chore(main): release 0.27.0)

2026-07-29, in progress.

- Release-please opened #338 within ~1 min of the promote push; version exactly 0.27.0 (authorized);
  diff is the clean four-file bump (manifest, CHANGELOG, root + extension package.json).
- **Gate-harness bug (mine, caught in-flight): `set -e` was silently ineffective** in the session
  shell context — the assertion script printed "ASSERTIONS PASSED" and attempted the merge even
  though `Quality: cancelled` / `Smoke e2e: failure` had failed their `test`s. No harm done:
  GitHub's server-side required checks REFUSED the merge (no `--admin`, main unchanged, TAG_SHA
  empty). Corrected in the transcript immediately. Rule going forward: chain gate assertions with
  explicit `&&` (or check each exit code individually); never trust `set -e` under the tool shell.
- First CI batch on head `d4d14c9`: THREE concurrent batches fired; concurrency cancelled two;
  the surviving runs failed for two unrelated, non-content reasons:
  - Quality: `Renovate config validator` step — `npm ECONNRESET` downloading the validator via
    npx (runner network flake). Biome itself: 1446 files, 0 errors / 32 pre-existing warnings.
    Typecheck skipped downstream of the failed step.
  - Smoke: `backup-roundtrip.test.ts` 90s Puppeteer timeout — the SAME flake that hit promote
    PR #337 yesterday and cleared on re-run. Twice in two days now → filed mentally as a
    flaky-test follow-up (route to the e2e-testing skill after the release).
- Action per plan discipline: `gh run rerun --failed` on both runs (no gate weakened); watching.

- Re-runs: Quality 30458616198 completed/success, Smoke 30458618794 completed/success. The
  "latest completed per workflow" query proved unreliable with three same-timestamp sibling
  batches (ties put a cancelled batch at .[0]) — asserted on the SPECIFIC re-run ids + the
  mergeStateStatus=CLEAN arbiter instead. Gate passed honestly on attempt 2 (short-circuit
  `&&` chain; the set -e form is banned for gates from now on).
- Merged with `--match-head-commit d4d14c9…`; main tip now `d4c0e97a0eb35eecb27fb4f6ad63fe07f8d7efb7`
  = TAG_SHA, a true 2-parent merge (e3a3c61 + d4d14c9). Gate ✓.
