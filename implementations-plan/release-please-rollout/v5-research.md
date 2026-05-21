# release-please-action @v5 — research

## v5 high-level changes

- **v5.0.0** released 2026-04-22 ([tag](https://github.com/googleapis/release-please-action/releases/tag/v5.0.0))
  - Single breaking change: runtime upgraded from Node 20 to **Node 24** ([#1188](https://github.com/googleapis/release-please-action/issues/1188))
  - Bundled `release-please` bumped from **17.3.0 → 17.6.0** ([#1199](https://github.com/googleapis/release-please-action/issues/1199))
  - No other action-level logic changed. `src/index.ts` `main()` is byte-identical between v4 and v5 (confirmed in [#1203](https://github.com/googleapis/release-please-action/issues/1203)).

- **release-please 17.4.0 – 17.6.0** changes between v4 and v5 (2026-04-06 → 2026-04-13):
  - 17.4.0: dependency security updates, Java-yoshi mono-repo support ([compare](https://github.com/googleapis/release-please/releases/tag/v17.4.0))
  - 17.4.1: **"do not attempt to create pull request when no changes detected"** ([#2722](https://github.com/googleapis/release-please/pull/2722)) — fixes the `pulls/0` "Not Found" crash when `code-suggester` returns PR #0
  - 17.5.0: `include-commit-authors` option, SCM abstraction
  - 17.5.1: `no-verify` option in Git operations
  - 17.5.2: limit git fetch to `cloneDepth`
  - 17.6.0: GitHub API for file updates, yoshi-java-monorepo version bump

## Does v5 fix Bug 1 (outstanding abort)?

**NO — not fixed.**

The "outstanding abort" is triggered by a component-matching failure in `release-please`'s release-build pass. The exact symptom described (`PR component: undefined does not match configured component: <name>` → `There are untagged, merged release PRs outstanding - aborting`) is reproduced verbatim against **v5.0.0 / release-please 17.6.0** in the wild.

Evidence:

- [release-please-action #1205](https://github.com/googleapis/release-please-action/issues/1205) (opened 2026-05-12): user on `release-please-action@v5.0.0` / `release-please 17.6.0`, single-package node repo, reports the exact same deadlock. Two consecutive releases had to be manually tagged to break the loop. The issue is open and unassigned.
- [release-please #2712](https://github.com/googleapis/release-please/issues/2712) (opened 2026-03-30, still open): describes the **root cause** — the default `group-pull-request-title-pattern` produces `chore: release main` (no `${version}`), which causes `pullRequestTitlePattern miss the part of '${version}'` and `Expected 1 releases, only found 0`. Assigned to maintainer `chingor13`, **not yet fixed** in any release through 17.6.0.
- None of the 17.4.x – 17.6.0 release notes mention fixing the abort path, component matching, or the `Expected 1 releases, only found 0` log line. The full commit list between v17.3.0 and v17.6.0 was inspected and contains zero commits referencing these strings.

**Your specific workaround (explicitly setting `group-pull-request-title-pattern`) is still required on v5.** Removing it would regress you into the same abort loop even on v5.

## Does v5 fix Bug 2 (component → branch-name fallback)?

**NO — workaround still required.**

Bug 2 (the default `group-pull-request-title-pattern` substituting the branch name for `${component}`) is precisely the issue described in [release-please #2712](https://github.com/googleapis/release-please/issues/2712), which remains open and unfixed as of 17.6.0. v5 bundles 17.6.0. The explicit `group-pull-request-title-pattern` override you're already using is still the only known workaround.

## Migration: v4 → v5

**Breaking change:** Node 24 runtime. If your self-hosted runners do not have Node 24, the action will fail to start. GitHub-hosted runners (`ubuntu-latest`) ship Node 24 and are unaffected.

**No config changes required.** All inputs, outputs, and config keys are identical between v4 and v5. The v5 README still references `@v4` in its examples (docs were not updated), but the inputs table is the same. The bundled `release-please` version is the only functional difference.

**New open bug in v5:** [release-please-action #1203](https://github.com/googleapis/release-please-action/issues/1203) describes a pass-2 failure mode where a transient GraphQL error during `createPullRequests` marks the step failed even though pass-1 (tag + release creation) already succeeded, permanently stranding `release_created=true` for that run. This exists in both v4 and v5 and is not fixed. Workaround: add `continue-on-error: true` to the action step.

## Recommendation

**Stay on v4, keep the manual workaround.** The title-pattern workaround you already have (`group-pull-request-title-pattern: "chore${scope}: release${component} ${version}"`) is the correct fix and it is still required on v5. Migrating to v5 would add the Node 24 runtime requirement without fixing either bug. The root cause (component-matching logic, default title pattern) remains open in `release-please` itself ([#2712](https://github.com/googleapis/release-please/issues/2712)) with no active fix in progress.

If you do migrate later, the only change needed is `googleapis/release-please-action@v5` in the `uses:` line — no config changes. But do not expect the abort bug to disappear.

## Real-world v5 monorepo examples

No confirmed working root-as-package monorepo examples with v5 were found in the wild that do **not** use the explicit `pull-request-title-pattern` override. The only public reproduction evidence found runs against v5.0.0 and confirms the bug is still present ([#1205](https://github.com/googleapis/release-please-action/issues/1205)).
