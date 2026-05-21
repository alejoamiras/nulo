# Re-review — prerelease rollout v2

## Verdict
APPROVE

## Resolution of v1 findings
- first-bump version (rc vs rc.1): fixed. v2 consistently says first cut is `0.21.0-rc`, with `.1` starting on the second iteration.
- gh release create target/--verify-tag: fixed. Runbook now uses `gh release create "v$VERSION" --verify-tag --prerelease` and drops `--target`.
- --ref main on workflow_dispatch: fixed. The runbook explicitly pins `gh workflow run release.yml --ref main ...`.
- post-stable reset sequence (main→dev merge first): fixed. The runbook now requires `main` → `dev` merge before resetting `.release-please-prerelease-manifest.json`.
- smoke test commit type: fixed. The smoke test now uses a disposable `feat:` commit instead of docs/chore/no-op.
- stable manifest drift fix: fixed. v2 adds the explicit `0.17.1 → 0.20.2` correction as commit 1 and uses `0.20.2` consistently as both baselines.
- JSONC comments stripped: fixed. The actual prerelease config example in §3b is valid strict JSON. Minor note: §3c still shows commented illustrative JSON in a markdown code block, but that is documentation-only, not the file content.

## New issues (if any)
1. None blocking. The only minor nit is the commented `json` block in §3c; if you want zero ambiguity for implementers, change that fence to `jsonc` or plain text.

## Implementation greenlight
GO