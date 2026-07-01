# Phase 3 — re-cut + publish the real `v0.24.0-rc.0` (2026-07-01)

Goal (the user's "done"): drive the real prerelease to a published GitHub Release with assets. Prereleases skip prod-site (Cloudflare) deploys.

## Steps + observations

1. **Preflight (codex F5):** no `v0.24.0*` tag, no `v0.24.0-rc.0` release, PR #189 still OPEN (`autorelease: pending`, the broken `0.23.0` cut). ✓
2. **Re-fired `release-prerelease.yml` (App-token cut on dev)** — run `28526931520` succeeded and **updated PR #189 in place** from `chore(dev): release 0.23.0` → **`chore(dev): release 0.24.0-rc.0`**. Diff sanity: prerelease manifest + `package.json` + `apps/extension/package.json` all `0.24.0-rc.0`; changelog `## [0.24.0-rc.0](compare/v0.23.0...v0.24.0-rc.0)` (bounded). This is the end-to-end proof the fix works through the real workflow, not just a local dry-run.
3. **#189 CI**: because the release PR bumps `apps/extension/package.json`, the whole-package gate fires the **full network e2e** (5 shards + heavy + canary) — the accepted over-trigger for a version-only PR. Builds pass immediately; e2e ~25 min. Required checks must be green to merge (network flake → re-run, not neutralize).

_(remaining steps recorded as they happen: squash-merge #189 → manual unstick (tag + relabel + prerelease release) → `release.yml` publish escape-hatch → verify assets.)_
