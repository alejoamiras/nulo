# Fable-leg audits — monorepo-restructure (run on Opus 4.8 1M, per the blueprint Fable→Opus fallback)

The fable leg ran as the `Plan` subagent on `model: opus`. Full transcripts are the subagent JSONL runs (not re-pasted here to avoid context bloat); the load-bearing outputs are captured below + folded into `plan.md`.

## 1. Independent plan (3rd parallel draft)
Produced the most complete of the three drafts. Unique contributions adopted into the consolidated plan:
- **FLAT `packages/` recommendation** (the contested decision, ultimately approved): grouping fights the guard test's `join(ROOT,"packages",pkg)` identity model + deepens 13 biome globs for cosmetic gain; `apps/packages/contracts` already supplies the meaningful nesting.
- **`method-descriptors.test.ts:212`** — the 2nd fragile cross-package test file (neither main nor codex caught it).
- **Depth analysis**: under FLAT, `wallet-bridge` stays at `packages/wallet-bridge/`, so `dispatcher.test.ts:1082` `resolve(__dirname,"../../..")` must be LEFT UNCHANGED while the import *target* prefixes change.
- **`extension/vitest.config.ts` sibling-lib includes** (`../wallet-core/src/**` ×5 → `../../packages/…`).
- The **lockfile G2 caveat** (one non-frozen install to rewrite member paths, eyeball path-only diff) + the **deliberate biome-violation probe** (G3).
- Error CORRECTED by main: opus called the contracts "zero-coupling, move first" — false; `bridge-core/artifacts.ts` import + `bridge-evm/foundry.toml` remapping ARE coupled.

## 2. Fresh hostile audit — verdict: `conditional approve`
3 mechanical conditions, all verified + folded:
- **B1 (BLOCKING)** `_lint-and-typecheck.yml:54-57` `setForceLocal` forbid-grep scans `packages/` only → moved extension code escapes the accelerator-boundary enforcement silently (feeds required `quality-status`). → Phase 6 extends scope to `apps/ packages/` + a B1 gate.
- **B2** `_lint-and-typecheck.yml:31-32` tsbuildinfo cache path + hashFiles key → `apps/extension` (stale = silent permanent cache miss).
- **B3** `.storybook/main.ts:26` `../../design/src/**` live sibling glob → `../../../packages/design/` (storybook not CI-gated → silent). Corrected the briefing's false "vite/storybook = stale comments only" claim.
Confirmed SOUND: the flat recommendation, `dispatcher.test.ts:1082` unchanged, the contracts correction. Cleared false-alarms: `vite.shared.ts` node_modules depth-safe, keystone Nargo sibling-relative, soak/prerelease covered, `setup-accelerator-server` clean.

See `plan.md` "Audit verdicts" + the decision ledger for how each finding maps to a phase/gate.
