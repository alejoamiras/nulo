# Phase 3 — re-cut + publish the real `v0.24.0-rc.0` (2026-07-01)

Goal (the user's "done"): drive the real prerelease to a published GitHub Release with assets. Prereleases skip prod-site (Cloudflare) deploys.

## Steps + observations

1. **Preflight (codex F5):** no `v0.24.0*` tag, no `v0.24.0-rc.0` release, PR #189 still OPEN (`autorelease: pending`, the broken `0.23.0` cut). ✓
2. **Re-fired `release-prerelease.yml` (App-token cut on dev)** — run `28526931520` succeeded and **updated PR #189 in place** from `chore(dev): release 0.23.0` → **`chore(dev): release 0.24.0-rc.0`**. Diff sanity: prerelease manifest + `package.json` + `apps/extension/package.json` all `0.24.0-rc.0`; changelog `## [0.24.0-rc.0](compare/v0.23.0...v0.24.0-rc.0)` (bounded). This is the end-to-end proof the fix works through the real workflow, not just a local dry-run.
3. **#189 CI**: because the release PR bumps `apps/extension/package.json`, the whole-package gate fires the **full network e2e** (5 shards + heavy + canary) — the accepted over-trigger for a version-only PR. Builds pass immediately; e2e ~25 min. Required checks must be green to merge (network flake → re-run, not neutralize).

_(remaining steps recorded as they happen: squash-merge #189 → manual unstick (tag + relabel + prerelease release) → `release.yml` publish escape-hatch → verify assets.)_

## Steps 4–7 (2026-07-01) — merged, unstuck, published

4. **Squash-merged #189** (App-verified release commit → **no `--admin`**; the throwaway needed `--admin` here only because it used a PAT). dev's prerelease manifest → `0.24.0-rc.0`. #189 ran the FULL network e2e (5 shards + heavy + canary) — green.
5. **Manual unstick:** tag `v0.24.0-rc.0` on the squash commit + push, relabel #189 `pending → tagged`, `gh release create … --prerelease --verify-tag`.
6. **Publish chain — first attempt FAILED (stale path):** `gh workflow run release.yml --ref main …` (per the old runbook) died at build with `ENOENT: Could not change directory to "packages/extension"`. Cause: `--ref` resolves the reusable `_build-extension.yml` at the caller's ref, and **`main` is still pre-#186 (`packages/extension`)** while the tag's code is post-#186 (`apps/extension`). The runbook's "always `--ref main`" is broken until #186 promotes to main.
   - **Fix: re-fired with `--ref dev`** → `apps/extension` workflow matched the tag's layout → build+smoke+attach all green. Runbook updated (publish a prerelease with the ref of the branch it was cut from).
7. **✅ PUBLISHED:** `gh release view v0.24.0-rc.0` → `isPrerelease: true`, assets `nulo-chrome-0.24.0-rc.0.zip` · `nulo-firefox-0.24.0-rc.0.zip` · `SHASUMS256.txt`. Cloudflare landing + faucet deploys **skipped** (prerelease). The user's "done" is met.

## Lesson: workflow/code layout must match the publish `--ref`
A cross-branch `--ref` (main workflow, dev-cut tag) silently mismatched the monorepo layout post-restructure. When branches diverge on file layout, a reusable-workflow `--ref` is a hidden coupling. Rule of thumb: **publish artifacts with the ref of the branch the tag was cut from** (or the tag itself), so workflow paths and code paths agree.
