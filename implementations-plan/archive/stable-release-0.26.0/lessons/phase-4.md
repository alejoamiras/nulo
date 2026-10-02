# Phase 4 — auto-unstick + build + publish + deploy (release.yml run 30062111294)

**Status:** ✓ GREEN — release published, sites deployed.

## Outcome (all success)
- `auto-unstick` ✓ tagged `v0.26.0` + created the Release + relabeled #321 (no manual unstick, no stranded state).
- **Tag integrity ✓**: `git rev-list -n1 v0.26.0` == `bffaad26…` (== TAG_SHA, the #321 merge commit).
- `network-e2e` **skipped** (confirms it's OFF on the auto push:main publish, as planned) → `smoke-against-artifact` is the gate; it passed on the real built zip.
- Release `v0.26.0`: `isPrerelease=false`; assets = `nulo-chrome-0.26.0.zip`, `nulo-firefox-0.26.0.zip`, `SHASUMS256.txt`; body = real git-cliff notes (NOT the "Filled by publish run." placeholder).
- `refresh landing` ✓, `deploy faucet` ✓, `verify live deploys (advisory)` ✓ (landing serves v0.26.0 + faucet `buildId` on testnet.tools.nulo.sh matches the release SHA).
- `publish to Chrome Web Store` / `publish to Firefox AMO`: **skipped** — no marketplace publish (hard limit held).
- `sync main → dev` ✓ opened **#322**.

## Gate: all conditions met — no partial-unstick recovery needed.
