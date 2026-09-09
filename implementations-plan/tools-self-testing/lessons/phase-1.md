# Phase 1 — CI names say the app

## What was done

- Renamed six workflow files with `git mv` (history preserved): `pr-smoke-e2e` → `pr-extension-smoke-e2e`, `pr-network-e2e` → `pr-extension-network-e2e`, `_smoke-e2e` → `_extension-smoke-e2e`, `_network-e2e` → `_extension-network-e2e`, `network-e2e-soak` → `extension-network-e2e-soak`, `contracts` → `bridge-contracts`; every `uses:` in `release.yml` / `nightly.yml` repointed.
- Aggregators renamed: `extension-smoke-e2e-status`, `extension-network-e2e-status`, `bridge-contracts-status` (the latter also converted to the exact-state aggregator shape and bumped to `checkout@v7` + `fetch-depth: 0` + `paths-filter@v4`). `quality-status` unchanged.
- Labels: `e2e:extension-smoke` / `e2e:extension-network`; the legacy labels stay accepted until the next stable cut (the `decide` gates OR both).
- `_build-tools.yml` step renamed "Tools jsdom smoke (mock wallet, no browser)"; the tools vitest configs' comments say "jsdom smoke" so the extension's smoke and the tools' smoke are never confused.
- `scripts/ci-cd/required-checks.{ts,sh,test.ts}`: the per-branch runbook (`print`, `--apply --expect`, `--add`), pure functions unit-tested; `behavior-gating.test.ts` gained the aggregator-name pin (+ the rename-target cross-pin); `decide-gate.test.ts` and `verify-cert-run.sh` repointed.
- Docs: `CLAUDE.md`, `CI.md` (new `bridge-contracts.yml` + runbook sections), `.github/README.md`, `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `UPDATE.md`, the extension/tools test READMEs, `.claude/skills/e2e-testing/SKILL.md`, and the two extension e2e files that name workflow files in comments.

## Findings along the way

- `verify-cert-run.sh` expected `Run / heavy / fee-methods / Aztec agent`, but the heavy job has been named `Run / heavy / fee-methods + selfpay-phase` since selfpay-phase joined it, so the certification script could never match that agent. Fixed in passing (one string).
- `biome.json` ignores `scripts/ci-cd/**`; the CI scripts are guarded by `bun test scripts/ci-cd/` only.
- The live protection (read-only `print`) on 2026-09-09: `dev` strict=false and `main` strict=true, both `[network-e2e-status, quality-status, smoke-e2e-status]` at app 15368 — matches recon.

## Gate

- `bun run lint:actions` → exit 0.
- `bun run test:ci-gating` → 91 pass / 0 fail (8 files).
- `rg` for `smoke-e2e-status|network-e2e-status|contracts-status` outside `implementations-plan/`, `audit/`, `wallets-architecture-research/` → only the new names remain.
- `bun run lint` → 0 errors (33 pre-existing warnings, 5 infos).
- `bun run test:all` → see the log line pasted below before the first push.

## Not done here (by design)

- The branch-protection `--apply` and the label creation happen at merge time (owner; `MORNING.md`).
- CI proof of the renamed workflows comes from the arc-1 PR at Delivery (a `workflow_dispatch` cannot target a file that is not yet on `dev`).
