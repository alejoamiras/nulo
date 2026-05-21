# Implementation review — prerelease rollout

## Verdict
APPROVE-WITH-FIXES

## Per-area
- stable manifest drift fix: `git diff origin/dev..HEAD` shows a single-line change in `.release-please-manifest.json`: `0.17.1` → `0.20.2`. No other side effects in that file.
- prerelease config: `.github/release-please-prerelease-config.json` is valid JSON (`jq empty` passes). It sets `prerelease: true`, `prerelease-type: "rc"`, and `versioning: "prerelease"` under `packages["."]`, and otherwise mirrors the stable config.
- prerelease manifest: `.release-please-prerelease-manifest.json` is exactly `{ ".": "0.20.2" }`.
- release-prerelease.yml: trigger is `workflow_dispatch` only; App token is minted before `googleapis/release-please-action@v4`; `config-file`, `manifest-file`, `target-branch: dev`, `token`, and top-level permissions are all correct.
- release.yml network-e2e opt-in: `workflow_dispatch.inputs.run_network_e2e.default` is `false`, and the `network-e2e` job now uses the requested `(stable push) || explicit true` condition. Stable `push:main` semantics are preserved; `workflow_dispatch` runs network e2e only when `run_network_e2e=true`.
- CLAUDE.md runbook: the new release-policy bullet names both workflows and both config sets. The runbook is split into stable / prerelease / after-stable-cut, stable uses `--verify-tag` without `--target`, prerelease uses `gh workflow run release-prerelease.yml --ref dev`, `gh release create ... --prerelease`, and `gh workflow run release.yml --ref main`. No absolute paths or milestone tags were introduced. No other functional misses from plan v2 stood out.

## Issues found
1. [CLAUDE.md](/Users/alejoamiras/Projects/nulo/nulo-3/CLAUDE.md:380) says the prerelease PR into `dev` should be merged with a “merge commit, per `dev`'s ruleset.” That contradicts the repo’s own branch rules, which say `dev` lands PRs via squash and allows only `squash` [CLAUDE.md](/Users/alejoamiras/Projects/nulo/nulo-3/CLAUDE.md:23) [CLAUDE.md](/Users/alejoamiras/Projects/nulo/nulo-3/CLAUDE.md:28). This is operator-facing and should be fixed before merge.
2. Commit `e5c20d8d` violates the lower-case subject rule. The policy says “Subject line must be lower-case” [CLAUDE.md](/Users/alejoamiras/Projects/nulo/nulo-3/CLAUDE.md:16), but the subject is `docs(claude): extend Release runbook with Prerelease (rc) procedure`.

## Greenlight to merge
no-go until item 1 is fixed. Item 2 is compliance-only and can be resolved by rewording that commit or ensuring the eventual squash commit subject is lower-case.