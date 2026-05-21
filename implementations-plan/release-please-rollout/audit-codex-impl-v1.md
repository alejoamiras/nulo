# Implementation review — release-please rollout

## Verdict
REJECT

## Per-area
- `release.yml`: Checklist is mostly satisfied in [.github/workflows/release.yml](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:1): single workflow, `release-please` runs only on `push`, App token is minted before `googleapis/release-please-action`, `resolve` does `fetch-tags: true` and fails on empty/missing tags, reusable workflows consume `ref: ${{ needs.resolve.outputs.sha }}`, `attach-assets` uses `gh release upload --clobber` plus `gh release edit --notes-file`, dry-run skips publish, `refresh-landing`/marketplace/env/permissions/concurrency/status all match. Blocking gap: `attach-assets` does not depend on `network-e2e`, so release assets can publish before the long gate finishes or fails ([release.yml:136](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:136), [release.yml:172](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:172)).
- `release-please-config.json`: Pass. Root package path `"."`, `release-as: "0.20.0"`, `extra-files` mirrors `packages/extension/package.json`, all listed changelog sections are visible, `component-no-space: true`, and the PR title pattern matches ([.github/release-please-config.json](/Users/alejoamiras/Projects/nulo/nulo-3/.github/release-please-config.json:1)).
- manifest + `CHANGELOG`: Pass. Manifest is `{ ".": "0.17.1" }` and `CHANGELOG.md` is seeded with `0.20.0` entries referencing PRs `#7`, `#8`, `#9` ([.release-please-manifest.json](/Users/alejoamiras/Projects/nulo/nulo-3/.release-please-manifest.json:1), [CHANGELOG.md](/Users/alejoamiras/Projects/nulo/nulo-3/CHANGELOG.md:1)).
- `package.json` bumps: Pass. Root and extension are both `0.20.0` ([package.json](/Users/alejoamiras/Projects/nulo/nulo-3/package.json:51), [packages/extension/package.json](/Users/alejoamiras/Projects/nulo/nulo-3/packages/extension/package.json:6)).
- `.release-it.json` delete: Deleted, but docs are not fully cleaned up: [CI.md](/Users/alejoamiras/Projects/nulo/nulo-3/CI.md:52) still documents the old manual `workflow_dispatch` + `release-it` flow.
- `CLAUDE.md` update: Pass. Both targeted areas are updated to the release-please model and the “no human `chore: bump`” rule is retained ([CLAUDE.md](/Users/alejoamiras/Projects/nulo/nulo-3/CLAUDE.md:185), [CLAUDE.md](/Users/alejoamiras/Projects/nulo/nulo-3/CLAUDE.md:324)).

## Issues found
1. Blocking: release publication is not actually gated by `network-e2e`; `attach-assets` can upload/edit the GitHub Release before `network-e2e` passes ([release.yml:136](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:136), [release.yml:172](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:172)).
2. Non-blocking: `CI.md` still describes the removed `release-it`/manual-release model ([CI.md:54](/Users/alejoamiras/Projects/nulo/nulo-3/CI.md:54)).
3. Non-blocking: commit subjects pass `commitlint` for the range, but `3110e5dd` is not strictly CLAUDE-lowercase because it contains `CHANGELOG.md`; `commitlint` also reports one footer warning, not a subject error.

## Greenlight to merge
no-go

Items:
1. Make `attach-assets` wait on `network-e2e` when that gate is enabled.
2. Update `CI.md` to the release-please workflow shape.
3. Optional hygiene: normalize commit-message/body formatting before merge if you want strict CLAUDE compliance.