# Phase 3 — docs + the arc-1 allow-list

## What moved

Identity prose everywhere outside the drip feature: `CLAUDE.md` (Pages env-var note, release runbook table + steps, troubleshooting rows, the primitives list), `CI.md`, `ARCHITECTURE.md` (test-matrix rows), `UPDATE.md`, `apps/tools/README.md` (title, lede, app prose — the `implementations-plan/faucet/` archive links and the drip-feature paragraphs stay for arc 2), `apps/tools/tests/e2e/README.md`, `packages/{bridge-core,design,wallet-bridge,wallet-sdk-schema-patch}/README.md`, `contracts/bridge/{aztec,evm}/README.md` (product name + "the tools app's hardcoded config"; the `.sol` files untouched), `.claude/skills/aztec-update/SKILL.md`, comment prose in `apps/extension/src/**` (6 files), `packages/design/src/**` (8), `packages/wallet-bridge/src/dispatcher.test.ts`, `packages/wallet-sdk-schema-patch/src/apply.ts`, `packages/extension-messaging/src/errors.ts`, `packages/bridge-core/src/**` (7) and `scripts/**` (11, `live-intent.ts` excluded — its vocabulary is the drip manifest, arc 2), `apps/tools/scripts/**` (design resolver, verify-deployments, `deploy.ts:407`), and ≈25 app-identity comment lines inside `apps/tools/src/**` that the plan's file list had not enumerated (session factory, deposit flow, fuel claim, L1 wallet, theme, picker modal, account switcher, sponsored FPC, chain constants, emoji, errors copy, format, fuel-claim state, testids header, theme-vars + css-parity guards, capabilities line 8, bridge-deployments 18/73). The `.claude/skills/e2e-testing/SKILL.md` had no hits.

Rule applied: `the faucet` → `the tools app` (possessive kept), then bare `faucet`/`Faucet`/`FAUCET` → `tools`/`Tools`/`TOOLS`; three phrasings needed a hand fix afterwards ("the tools app-driven e2e", "The prod tools broke", a line-wrapped "the / faucet" in the README). No archive link was inside any bulk-edited file (checked first).

## Arc-1 allow-list (master grep after Phase 3 — every remaining hit, by file → count → class)

`K` = keep list (never renamed) · `B` = Bucket B, removed by arc 2 · `L` = the permanent legacy literal

| file | n | class |
|---|---|---|
| `apps/extension/src/assets/icons.json`, `packages/design/src/internal/icons.json` | 1 + 1 | K (generic tap glyph key) |
| `apps/extension/src/components/JsonViewer/useLogFilters.ts` | 1 | K (log-source filter chip) |
| `apps/extension/src/popup/components/modules/activity/TransactionCard.vue` | 1 | K (icon name for `mint` tx) |
| `apps/extension/src/utils/tx-enrichment.test.ts` | 1 | K (dApp-supplied name fixture) |
| `apps/extension/src/wallet/services/price/price-map.ts`, `token/default-tokens.ts`, `token-balance/service.ts` | 1 + 1 + 1 | K ("faucet-minted" / "faucet mints" concept prose) |
| `apps/extension/src/utils/primary-method.test.ts`, `execution/operation-planner.test.ts`, `tests/e2e/network/incoming-transfers.test.ts` | 1 + 1 + 2 | B ("Faucet drip shape", "faucet drip", "faucet-drip" — arc 2 rewords to drip) |
| `apps/tools/README.md` | 4 | 2 K (archive links `implementations-plan/faucet/`) + 2 B (tab list, `useFaucetDrip`) |
| `apps/tools/scripts/deploy-config.ts`, `deploy.ts` | 5 + 1 | B (`FaucetTokenConfig`, "Faucet contract deployer") |
| `apps/tools/src/App.vue` | 14 | B (tab id + label) |
| `apps/tools/src/components/{BridgeAddToken,TokenCard}.{vue,test.ts}`, `MintTestUsdc.vue`, `WalletPanel.vue` | 3+2+7+2+1+1 | B (`useFaucetAddToken`, `useFaucetDrip`, `FaucetToken`, tab copy) |
| `apps/tools/src/composables/useFaucet{Drip,AddToken}{,.test}.ts`, `useBridgeWallet.ts`, `useL1Usdc.ts`, `useWalletConnection{,.test}.ts` | 6+16+1+9+2+2+3+1 | B, except `useL1Usdc.ts` (2, K concept "faucet mint"/"faucet-style") and `useWalletConnection.ts:24` (1, L) |
| `apps/tools/src/constants/tokens.ts` | 6 | B |
| `apps/tools/src/contracts/bridge-deployments.ts:15` | 1 | B ("the faucet's own contracts" = the drip deploy) |
| `apps/tools/src/lib/capabilities{,.test}.ts` | 23 + 9 | B (`buildFaucetManifest`, `faucet` grant locals, descriptions) |
| `apps/tools/src/lib/network.ts:57` | 1 | B ("no faucet" on mainnet) |
| `apps/tools/src/lib/testids.ts` | 3 | B (`tabFaucet`, two tab comments) |
| `apps/tools/src/lib/{build-integrity,preview-hosts}.test.ts` | 1 + 4 | K (historical branch-name fixtures `worktree-faucet-multi-account` — they exercise CF's 28-char alias truncation; renaming the branch would change the truncation case) |
| `apps/tools/src/views/FaucetView.{vue,test.ts}` | 3 + 4 | B |
| `apps/tools/tests/e2e/tools-smoke.test.ts` | 3 | 2 B (`useFaucetDrip` import/reset) + 1 L (case 2c) |
| `contracts/bridge/aztec/README.md:4` | 1 | B ("the faucet Dripper") |
| `contracts/bridge/evm/README.md:68` | 1 | K ("Faucet-by-design") |
| `contracts/bridge/evm/**/*.sol` (4 files) | 1+2+1+1+1 | K (bytecode metadata) |
| `packages/bridge-core/README.md:40` | 1 | K (archive link) |
| `packages/bridge-core/scripts/live-intent.ts`, `src/promotion{,.test}.ts` | 31 + 6 + 8 | B (`assertFaucetCandidateShape`, `faucet*` locals, mode/summary strings, prose) |
| `packages/wallet-bridge/README.md:134` | 1 | K ("Nethermind faucet") |

Anything not in this table at the Phase 3 gate is a miss. Domain residue check: `faucet.nulo.sh` / `nulo-faucet.pages` → 0 (verified in the gate below).

## Gate (2026-09-01 22:40 UTC)

```
bun run audit:tools → typecheck:all every workspace exit 0 ∥ test:tools 67 files / 737 passed ∥ lint: biome 0 errors + complexity-baseline check OK → verify:deployments: all committed addresses match → build:tools ✓ built
bun run lint:actions → exit 0
scripts/check-no-brand.sh → ok: no legacy brand/path strings found
git grep -E 'faucet\.nulo\.sh|nulo-faucet\.pages' (live tree) → 0
master grep → 52 files, per-file counts identical to the allow-list table above (md5 of `git grep -c` output: 4b1af008…)
```
