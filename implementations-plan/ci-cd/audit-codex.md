# Audit — CI/CD Bring-Up Plan

## 1. Showstoppers

- Most repo facts are correct: there is no `.github` directory, the remote default branch is still `master`, there is no `origin/dev`, the repo is private, there are 8 workspaces, `bun.lockb` exists and `bun.lock` does not, the extension is `0.14.9`, and the network suite baseline is `46 / 66` (`package.json:4-26`, `packages/extension/package.json:6`, `packages/extension/tests/e2e/README.md:5-9,107-109`, `implementations-plan/network-test-triage/plan.md:5,33-52`). Two corrections: only `packages/extension/dist/chrome/` exists in-tree today; `dist/firefox/` is only a configured output path in `packages/extension/vite.firefox.config.mts:18`. Also `bun run test` is extension-only, not repo-wide (`package.json:12-16,23`).
- `pull_request_target` is the wrong trigger for label opt-in. `pull_request` already supports `labeled`, and your proposed job executes PR-controlled build/test code. Using `pull_request_target` needlessly upgrades the token/security context for untrusted code.
- `pr-network-e2e.yml` step 3/4 is internally wrong. `packages/extension/scripts/e2e/agent.sh:18-52` already resolves fresh ports, rebuilds Chrome with `VITE_LOCAL_NETWORK_RPC_URL`, grep-asserts the baked URL, and then runs Vitest. A separate fixed-port prebuild before `bun run e2e:agent` is redundant at best and inconsistent at worst.
- The planned failure artifacts `/tmp/aztec-node.log` and `/tmp/anvil.log` do not exist. `global-setup.ts` only streams subprocess output to stdout/stderr; it never writes those files (`packages/extension/tests/e2e/global-setup.ts:232-318,357-367`).
- The eight-package `unit-tests` matrix will fail immediately for `@nulo/playground` and `@nulo/landing`, because neither package defines a `test` script (`packages/playground/package.json:6-10`, `packages/landing/package.json:6-10`). Your plan text at `plan.md:179-180` is incorrect on this point.
- Prerelease extension versions are currently broken. `packages/extension/manifest/manifest.config.ts:6-12` turns `0.14.9-rc.1` into `0.14.9.` for Chrome’s 4-part version field. That blocks the planned prerelease flow outright.
- Release smoke against an extracted zip cannot work with the current harness. `packages/extension/tests/e2e/global-setup-smoke.ts:7-32` hardcodes `../../dist/chrome`; it cannot point at a temporary extracted artifact path. Your own proposed fix only appears later in `plan.md:457-458`.
- `dry_run` is not actually dry as written. `plan.md:254-263` still implies pushing the release branch and tag, then creating a draft release. A dry run must not create permanent refs.

## 2. Sequencing Risk

- Do not rename `master` to `main` before a minimal PR workflow exists. That rename changes remote defaults, branch names, docs, and human habits all at once; if the first CI pass is wrong, rollback blast radius is much larger than necessary.
- The branch model is internally inconsistent. `plan.md:57` makes `main` the default branch, while `plan.md:47-50,60` wants daily PRs to target `dev`. GitHub does not have a separate “suggested base” knob; either `dev` is the default branch or humans must keep changing the base manually.
- Phase 4 is too early for release automation. The release workflow depends on three unresolved prerequisites: valid prerelease version normalization, an `EXTENSION_PATH`-aware smoke harness, and a settled policy on post-release PRs/tokens.
- If you keep `paths-filter`, copy the accelerator’s explicit manual-dispatch override pattern (`aztec-accelerator/.github/workflows/accelerator.yml:32-35`) anywhere you expect “force a full run” behavior. Otherwise manual exercises on old branches will be surprising.

## 3. Missing Gates

- Highest ROI: add a manifest-policy gate. The wallet’s permission surface lives in `packages/extension/manifest/manifest.config.ts:14-37` and Firefox overrides in `packages/extension/manifest/manifest.firefox.config.ts:17-28`; permission, host-permission, and CSP expansions should not slide through as ordinary build diffs.
- Second: add a version/package gate. Check semver input, Chrome 4-part normalization, monotonicity, and Firefox `gecko.id` rules before release. This directly covers the current parser bug and the placeholder `gecko.id` at `packages/extension/manifest/manifest.firefox.config.ts:17-20`.
- Third: add a lightweight production dependency/license review for the shipped extension only. `packages/extension/package.json:31-73` pulls a non-trivial crypto/browser dependency set; this is better ROI than broad monorepo SBOM work on day one.

## 4. Over-Engineering

- Your instinct is right: start simpler. The repo already has `lint`, `typecheck:all`, and `test:all` at the root (`package.json:17-25`). A first cut can be one lint job, one typecheck-all job, one test-all job, one extension build, and one smoke e2e job.
- The per-package matrix is not buying much yet. It increases YAML complexity, runner fan-out, and skip logic before you have any timing data proving the simpler pipeline is too slow.
- `release:major` / `release:minor` / `release:patch` / `release:prerelease` labels are dead weight in the current design. `release.yml` takes exact `version` and `channel` inputs (`plan.md:229-245`), and no step in the plan explains how PR labels become those values.
- `actionlint` appears twice: once as a job inside `pr-quick` (`plan.md:175-183`) and again as a standalone `actionlint.yml` (`plan.md:265-268`). Pick one.
- Dual changelogs are unnecessary. `packages/extension/CHANGELOG.md` is enough; a mirrored root changelog adds drift risk for no release value.
- Reusable workflows are fine later, but `_quality-matrix.yml` plus `_network-e2e.yml` is not the place to start in a repo that currently has zero CI.

## 5. `pull_request_target` Security

- Disagree explicitly: `pull_request_target` is not justified here. This job is not metadata-only; it builds and executes PR-controlled code. That is exactly the class of workload that should stay on `pull_request`.
- The safe fix is simpler than the plan: use `pull_request` with `types: [opened, reopened, synchronize, labeled]` for both `main` and `dev`, and gate the network job on base branch / label / paths-filter outputs.
- If you ignore that advice, minimum bar is `permissions: contents: read`, no repository secrets, and no step that executes PR-head code in the target-context job. In practice that strips away the reason to use `pull_request_target` at all.

## 6. Network E2E Baseline Handling

- `continue-on-error: true` until “≤6 failures” is the wrong exit criterion. A raw failure count is not a risk model; six remaining failures can still cover the most important wallet flows.
- Better approach: split the suite into `required` and `quarantined`. Gate `main` PRs and stable releases on the known-green subset, run the quarantined bucket informationally, and burn the quarantine down to zero. The current triage document is already clustered enough to support that (`implementations-plan/network-test-triage/plan.md:33-52`).
- If you refuse to split, at least key the informational gate to “no unexpected failures against a checked-in allowlist,” not “remaining failures below N.”
- Your cache-invalidating example is slightly off. The reference `setup-aztec` action keys the Aztec CLI cache by detected Aztec version (`aztec-accelerator/.github/actions/setup-aztec/action.yml:45-52`), so a real `@aztec/aztec.js` version change does invalidate the cache. The remaining risk is same-version upstream installer drift, not cross-version reuse.

## 7. Changelogen Choice

- Mild disagreement. `changelogen` is fine only if you actually want commit-driven versioning. Your plan still asks a human for the exact `version` input and also talks about release labels, so changelogen is reduced to “render the changelog and maybe touch package.json.”
- If exact-version `workflow_dispatch` stays, I would prefer a tiny explicit version-bump script plus GitHub-generated release notes or `git-cliff`. That is simpler and avoids ambiguity between the repo-root `package.json` and `packages/extension/package.json`.
- If you keep `changelogen`, you must scope it to the extension package. Both `package.json` files exist (`package.json:1-34`, `packages/extension/package.json:1-111`); the plan should say exactly which directory it runs in and which changelog file it owns.

## 8. Release Post-Bump Strategy

- The brief is stale here: the current plan does include a post-release PR/back-sync flow in `plan.md:259`, then questions that decision again in `plan.md:486`.
- Recommendation: do not auto-open or auto-merge the post-release PR in v1. The accelerator makes that workable because it uses a PAT-backed flow (`aztec-accelerator/.github/workflows/release-accelerator.yml:409-479`). In this repo, that adds token policy, branch choreography, and silent-CI failure risk before baseline CI is even proven.
- Simpler v1: release from the chosen branch, create the tag/release, and leave the follow-up version/changelog sync as a normal human PR until branch protection and token policy are solved.

## 9. Open Question Recommendations

- 1. Branch protection: upgrade to GitHub Pro for this private wallet repo; do not make it public just to unlock rules.
- 2. Network baseline: replace the “≤6 failures” threshold with a hard-gated known-green subset plus an explicit quarantine allowlist.
- 3. Changelog location: keep only `packages/extension/CHANGELOG.md`.
- 4. Tag prefix: use `vX.Y.Z` until there is a second shipped artifact.
- 5. Release workflow access: keep `workflow_dispatch` limited to maintainers with push/admin access; do not build extra label-based policy around releases.
- 6. Promote-to-main PR after stable release: skip it in v1; manual follow-up is safer until PAT + protection are in place.
- 7. Smoke on `release/*`: yes, same quick gates, but only after the smoke harness supports an override extension path.
- 8. Aztec version bump workflow: defer it; CI bring-up and network-test quarantine are higher ROI.
