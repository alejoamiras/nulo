# Phase 1 — Extraction harness

## What shipped
Pure, `bun:test`-able decision logic for the release pipeline, in `scripts/release/` (no behavior change, no secrets — the workflow glue that calls these comes in later phases):

- `resolve-tag.ts` — extracts `release.yml`'s tag/version/is_prerelease parser (the git-side tag-existence + SHA stay in the workflow). 12 tests.
- `chain-guard.ts` — canonical V5 testnet identity (`11155111` / `4239416255` → wallet chainId `4229590296`) + `assertTestnetIdentity` drift guard. **Pins the exact prod bug**: `walletChainId(11155111, 4127419662) === 4138294185` (a BUG-PIN regression test). 11 tests.
- `auto-unstick.ts` — `decideUnstick` pure decision for the v4 abort: guards (flag off / release_created / not-push / not-a-Release-PR → noop), then create/skip/abort with the **tag-SHA == merge-SHA** assertion + idempotent re-invoke. 11 tests.
- `verify-live.ts` — `verifyLive` fail-closed post-deploy check; the faucet HTML `nulo-build` meta must EXACTLY match `/build.json` buildId (the split-CDN-cache false-pass codex flagged) + chainId; landing must reference `releases/tag/v$VERSION`. 13 tests.
- `open-sync-pr.ts` — `syncEligible` (push-only + stable + `sha == Release-PR merge` — explicitly false on `workflow_dispatch` republish, codex Critical-1) + `decideSyncPrAction` (fail-closed conflict-surfacing). 10 tests.

Plus the F11 sub-fix: `actionlint.yml` shellcheck `find` + paths-filter now cover root `scripts/`.

## Doc-drift caught + fixed (would've broken the autonomous loop)
`CLAUDE.md` + this plan's gates + the `/loop` seed all reference **`bun run lint:actions`**, but **no such root script existed** (only the CI `actionlint.yml`). Added `"lint:actions": "actionlint"` to root `package.json` so the documented + plan-referenced command is real. `actionlint` is installed locally (homebrew); CI uses `reviewdog/action-actionlint`. This is a Phase-2 doc-drift item resolved early because the loop's per-phase gate depends on it.

## Gate result — GREEN
- `bun test scripts/release/` → **57 pass / 0 fail** (5 files, each ≥10 cases).
- `bun run lint:actions` → **exit 0** (all workflows clean, incl. the edited `actionlint.yml`).
- No behavior change: pure logic modules + a lint script + actionlint coverage. Nothing is wired into a workflow yet.

## Notes for later phases
- `resolve-tag.ts` is ready to replace the inline bash in `release.yml`'s `resolve` step (Phase 6/7 wiring).
- `chain-guard.ts` holds the canonical identity — Phase 3 wires `chain-info.ts` to import it (single-source; drop the `VITE_CHAIN_*` env path).
- `auto-unstick.ts` / `open-sync-pr.ts` / `verify-live.ts` are the cores for Phases 6 / 7 / 5 — wiring + test-repo rehearsal there.
