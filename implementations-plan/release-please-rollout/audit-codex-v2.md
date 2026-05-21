# Final review — release-please rollout v2

## Verdict
REJECT

## v1 → v2 fidelity
- Force-version bootstrap: fixed. `release-as: 0.20.0` + manifest `0.17.1` is the right shape.
- Flat outputs/root-as-package: fixed. `packages["."]` gives root outputs for `release_created`, `tag_name`, `version`, `sha`.
- Root `package.json` sync: fixed. `extra-files` on `packages/extension/package.json` is the right mirror because root becomes source of truth.
- `ref` propagation: partial. The `ref` input is wired everywhere, but `resolve` can emit the wrong SHA on manual/tag runs.
- `issues: write`: fixed.
- `gh release upload --clobber`: fixed.
- `run_network_e2e`: fixed. `dry_run`: unfixed; v2 removed it rather than preserving it.
- Cloudflare + marketplace gates: fixed.
- Signed-commit assumption: fixed in principle, contingent on the Q1 ruleset bypass being accepted.
- Cross-workflow chaining: fixed.
- `changelog-path` escape, `tag-separator`, concurrency, bootstrap wording: fixed.

## New issues introduced by v2
1. The core architecture is still wrong for Release PR CI. `release-please-action` documents that PRs/releases created with `GITHUB_TOKEN` do not trigger later workflows, so the auto-opened Release PR will not run normal `pull_request` CI. That conflicts with required `Quality / Status` checks in [CLAUDE.md](/Users/alejoamiras/Projects/nulo/nulo-3/CLAUDE.md:24) and the actual PR workflows in [pr-quick.yml](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/pr-quick.yml:1). Single-workflow fixes `release: published` chaining, but not Release PR checks.
2. `resolve` is unsafe on manual republish. It checks out shallow HEAD with no tags, then does `git rev-list -n 1 "$TAG"` and falls back to `github.sha`. On `workflow_dispatch`, that can publish assets for the requested tag from the wrong commit. Empty `tag` also skips silently instead of failing loudly.
3. v2 drops `environment: production` from the release path. If current secrets/approvals are environment-scoped, they disappear.
4. Repo-policy docs are stale after this plan. [CLAUDE.md](/Users/alejoamiras/Projects/nulo/nulo-3/CLAUDE.md:24) still says main advances only via promote PRs and releases happen via manual `gh workflow run release.yml`; v2 changes both.
5. Minor config gotcha: `pull-request-title-pattern` should likely add `component-no-space: true`, otherwise `${component}` can render/parse with a leading space.

## Implementation greenlight
no-go + items:
- Use a PAT/App token for release-please PR creation if Release PR CI must auto-run.
- Make `resolve` fetch/verify the tag commit and fail on empty/unknown `tag`.
- Restore or explicitly drop `dry_run`.
- Preserve/update `environment: production` semantics if still needed.
- Update `CLAUDE.md` to match the new release model.

Refs: [release-please-action README](https://github.com/googleapis/release-please-action), [manifest root-path docs](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md), [extra-files docs](https://github.com/googleapis/release-please/blob/main/docs/customizing.md), [GitHub reusable workflow docs](https://docs.github.com/en/actions/how-tos/sharing-automations/reusing-workflows).