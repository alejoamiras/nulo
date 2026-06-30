# Codex audits — monorepo-restructure

## 1. Hostile audit (fresh xhigh) — verdict: reject (F1–F5)

**Facts**
- Blocking silent break: `router-abi.test.ts` points at `../../bridge-evm/out/...` and then `describe.skipIf(!existsSync(ARTIFACT))`; after moving EVM contracts, that ABI pin silently skips, even if `forge build` succeeded in the new location. See [router-abi.test.ts](packages/bridge-core/src/router-abi.test.ts:7) and [line 33](packages/bridge-core/src/router-abi.test.ts:33).
- Contract coupling inventory is still false/incomplete. `bridge-core` exposes `deploy:sandbox` and `verify:l1` scripts, and scripts hardcode `bridge-evm`, `bridge-aztec`, and `faucet/public` paths. See [package.json](packages/bridge-core/package.json:15), [deploy-bridge-testnet.ts](packages/bridge-core/scripts/deploy-bridge-testnet.ts:62), [portal-artifact.ts](packages/bridge-core/scripts/portal-artifact.ts:34).
- Required `quality-status` silently weakens unless fixed: `_lint-and-typecheck.yml` greps only `packages/` for `setForceLocal`, so moved app code under `apps/extension` escapes the guard without error. See [_lint-and-typecheck.yml](.github/workflows/_lint-and-typecheck.yml:49) and [line 57](.github/workflows/_lint-and-typecheck.yml:57).
- More unmapped loud couplings: extension/faucet design CSS tests assume `../design`/`../../design`, broken after app move. See [extension theme-vars](packages/extension/src/design/theme-vars.test.ts:7), [faucet theme-vars](packages/faucet/src/lib/theme-vars.test.ts:7), [faucet parity](packages/faucet/src/app.css.parity.test.ts:10).
- Smaller silent skip: root `check:imports` remains `biome check packages/`, excluding apps. See [package.json](package.json:32).
- Correct: leaving `dispatcher.test.ts` root depth unchanged is right for flat layout. `wallet-bridge` stays at same depth. See [dispatcher.test.ts](packages/wallet-bridge/src/dispatcher.test.ts:1082).
- Correct but incomplete: `artifacts.ts` breaks on Aztec move, and Foundry remap needs `../../../node_modules`. See [artifacts.ts](packages/bridge-core/src/artifacts.ts:6), [foundry.toml](packages/bridge-evm/foundry.toml:14).

**Inferences**
- `forge build` is necessary, not sufficient. It catches the remap, not the skipped bridge-core ABI pin or deploy/verify path readers.
- G2 “path-only `bun.lock` diff” is sound, but must also assert every expected `@nulo/*` workspace remains present.
- Worst release case is not only empty git-cliff notes. Cloudflare deploy hooks can return 2xx while dashboard project roots still point to `packages/*`; `verify-live` is advisory, not required. See [release.yml](.github/workflows/release.yml:345) and [line 406](.github/workflows/release.yml:406).

**Asks**
- Surface/update Cloudflare Pages project roots/build commands for landing and faucet.
- Add explicit gates proving `router-abi.test.ts` actually runs after `forge build`.
- Re-audit bridge-core scripts before claiming contract coupling complete.

**Verdict**
`reject (blocking findings: silent ABI-pin skip, incomplete bridge-core contract/app path inventory, required quality guard silently stops scanning moved app code).`
---
## 2. Final fresh-context pass — verdict: reject (2 narrow gaps)

**Verdict: `reject (blocking findings: F2 incomplete; root package scripts stale)`**

Findings:

1. **F2 is not genuinely resolved.** Phase 1 says “fix ALL” contract/faucet couplings but only names `portal-artifact.ts` and `deploy-bridge-testnet.ts` ([plan.md](implementations-plan/monorepo-restructure/plan.md:56), [plan.md](implementations-plan/monorepo-restructure/plan.md:61)). Live repo has additional functional path readers in `bridge-core/scripts`: [deposit-testnet.ts](packages/bridge-core/scripts/deposit-testnet.ts:49), [deploy-sandbox.ts](packages/bridge-core/scripts/deploy-sandbox.ts:49), [smoke-existing-testnet.ts](packages/bridge-core/scripts/smoke-existing-testnet.ts:48), [smoke-swap-existing-testnet.ts](packages/bridge-core/scripts/smoke-swap-existing-testnet.ts:53), [fuel-testnet.ts](packages/bridge-core/scripts/fuel-testnet.ts:49), and [verify-l1.ts](packages/bridge-core/scripts/verify-l1.ts:30). These would still point at removed `packages/bridge-*` or `packages/faucet/public`.

2. **Root package scripts are still under-mapped.** Phase 6 covers root `--cwd packages/{app}` scripts plus `check:imports` ([plan.md](implementations-plan/monorepo-restructure/plan.md:88)), but live `package.json` also has direct app paths: [package.json](package.json:21) `e2e:agent` and [package.json](package.json:27) `typecheck`. Proposed gates do not run those exact commands, so stale paths can survive.

Prior folded items otherwise look sound: F1 has a runs-not-skips gate ([plan.md](implementations-plan/monorepo-restructure/plan.md:63)); F3/F4/B1/B2/B3 map to live files; F5 is correctly framed as an external pre-release prerequisite ([plan.md](implementations-plan/monorepo-restructure/plan.md:140)). No repo-side Cloudflare config surfaced.

Fix the two inventory gaps and add explicit grep/gates for them, then this should be approvable.
---
## 3. Confirmation (resumed) — verdict: conditional approve

**Verdict: `conditional approve`**

The two reject conditions are resolved: F2 now covers all 8 `bridge-core/scripts/*` path readers and adds the G1 completeness grep ([plan.md:61](implementations-plan/monorepo-restructure/plan.md:61), [plan.md:63](implementations-plan/monorepo-restructure/plan.md:63)); root `e2e:agent` and `typecheck` direct app paths are now explicit in Phase 6 ([plan.md:88](implementations-plan/monorepo-restructure/plan.md:88)). The G9 repo-wide moved-path grep is the right structural catch ([plan.md:101](implementations-plan/monorepo-restructure/plan.md:101)).

Conditions:
1. Clarify “run after EACH phase” means informational until the relevant move/update phase; zero is only required at final G9.
2. Narrow `-g '!architecture/**'` to the actual archive set, or explicitly classify all `architecture/` as archival. Right now it hides non-`codex-notes` stale refs.

No remaining blocking implementation gap found.