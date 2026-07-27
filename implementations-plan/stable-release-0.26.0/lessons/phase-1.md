# Phase 1 — freeze SHA + pre-flight

**Status:** ✓ green (gate passed)

## Frozen release identity
- `RELEASE_SHA = 4e5435b3b9971f3fd6a8ee1303f174d584290c99` (origin/dev HEAD, PR #318). The promote is authorized for this exact SHA.
- `main` HEAD `3b930ae968f8738ab57868159c9bbd0dae982538` == `v0.25.0` tag → main sits exactly at the last release. Clean baseline.

## JIT pre-flight (all pass)
- Open PRs into `main`: **none** (only #49 open, base=dev, unrelated).
- `AUTO_UNSTICK_ENABLED = on`.
- Required checks on main: `network-e2e-status`, `quality-status`, `smoke-e2e-status`.

## Notes
- `TAG_SHA` (Release-PR merge commit) will be created in Phase 3/4 and is DISTINCT from `RELEASE_SHA`. Faucet `buildId` freshness (Phase 6) checks against `TAG_SHA`, not this.
