# Infra/Glue Layer Map — `packages/extension` (utils, entries, configs, e2e harness)

Mapper: Fable Explore subagent.

## 1. Module inventory

| Area | Purpose | LOC |
|---|---|---|
| src/utils/ | Popup/UI-side helper grab-bag | ~1,895 src + ~1,720 tests (19 files) |
| src/accelerator/ | config.ts (43): host/port constants, ACCELERATOR_REQUIRED flag, build stamp | 43 |
| src/offscreen/ | entry shell + is-benign-sw-disconnect (25+31 test) | ~150 |
| src/content-script/ | content.ts (22): pure relay around wallet-sdk handler | 22 |
| src/types/ | generated auto-imports.d.ts (398), components.d.ts (81), .eslintrc json (227); hand-written console.d.ts, vite-env.d.ts | ~733 (mostly generated, tracked) |
| src/shims/ | bb-fetch-code (56), function-bind-stub.cjs (38), detect-node (6) | ~100 |
| src/setup/ | placeholder Vue entry — still a vite build input | ~70 |
| scripts/ | extract-bb-wasm 109, check-rp-id 72, e2e/agent.sh 96, e2e/resolve-ports 130, e2e/docker-ci-like 127, e2e/probes/ (empty dir) | ~534 |
| tests/ | vitest.setup 123 + tests/e2e ~12.3k (20 smoke files, 48 network files, 8 fixtures ~3.7k, global-setup 718+46, lockfile 111) | ~13.0k |
| Root configs | 1 base vite + 2 browser wrappers, 4 vitest configs, 3 manifest configs | ~560 |

## 2. Entry points

- SW: manifest → src/wallet/index.ts (83): console hijack, onunhandledrejection→LoggerStore, onInstalled→onboarding tab, createWalletRuntime() (runtime.ts 217).
- Offscreen: index.html → offscreen/index.ts (81): PING/PONG, console hijack via LoggerServiceClient, benign-SW-disconnect demotion, accelerator stamp, createPxeOffscreen() from aztec-runtime.
- Content script: 22-line relay.
- Popup: popup/index.ts (98): console hijack, Vue+Pinia+router, initAppServiceContext, auth guards via getLastActiveProfileId.
- Onboarding: index.ts "mirrors popup/index.ts" (own docstring).
- Setup: bare Vue app, placeholder, still in vite build inputs (vite.config.ts:294-301).

## 3. Dependency notes

utils consumers: popup 51, components 15, wallet 4, onboarding 4, composables 3, stores 1. Both popup AND wallet: fee-estimation (tx/[id].vue + execution/service.ts), tx-enrichment (UI + app.store). Wallet-only: primary-method (re-exported to UI via tx-enrichment.ts:6), console-sniffer. ALL of src/utils is ALSO globally auto-imported (vite.config.ts:162) → dual-mode consumption.

## 4. Similarity candidates

1. **primary-method.ts ↔ tx-enrichment.ts** — tx-enrichment re-exports FEE_METHODS/pickPrimaryMethod; same symbols importable from two paths.
2. **Console hijack quadruplicated** — identical consoleMethods loop + onunhandledrejection in wallet/index.ts, popup/index.ts, offscreen/index.ts, onboarding/index.ts; console-sniffer installs aliases; vitest.setup re-implements the shim.
3. **amount.ts ↔ fee-estimation.ts** — two formatting vocabularies for one display concern.
4. **Activity-display trio** — journal-state.ts (352, incl. sanitizeJournalSubtitle + buildJournalTerminalCardProps), card-subtitle.ts (35), activity-rows.ts (76); string.sanitizeString overlaps sanitizeJournalSubtitle in intent.
5. **chrome.storage one-key helpers** — lastActiveProfile.ts duplicates setSentinel/checkSentinel pattern in core.ts:141-149.
6. **general.js** — untyped JS (debounce, isPrefersDarkScheme, ensurePermissions) + hand-maintained .d.ts; debounce stranded outside wallet-core utils home.
7. Error helpers NOT duplicated (all use wallet-core getErrorData). trimAddress/isValidHex have no wallet-core counterpart.
8. **Mixed import style** — some "@/utils/amount.js" (suffixed), some bare, most auto-import.
9. **resolvePackageFile copied verbatim** vite.config.ts:8-17 ↔ vitest.config.ts:13-22 ("Keep in sync").
10. **e2e fixtures**: extension.ts carries generic DOM helpers overlapping helpers.ts; password "TestPassword123!" constant in helpers.ts:20 but repeated literal in extension.ts:170,808.

## 5. Build/config sprawl

- Vite ×3: base 324 lines (aliases incl. 2 artifact resolvers, 6 inline plugins, 4 HTML inputs); chrome/firefox wrappers (23 each) **mutate imported base config in place** (plugins?.push(crx), set outDir).
- Vitest ×4: unit (jsdom, also runs 5 sibling packages' tests), e2e smoke, e2e network, e2e all. Duplicated: "@" alias (all 4), define block (×2), resolvePackageFile + artifact aliases (×2), pool/forks/isolate/retry + comments (both e2e), server.deps.inline (×2).
- Manifest ×3: base 62 + thin chrome 8 + firefox 29.
- **VITE_* spread (5 vars, 5 files)**: ACCELERATOR_REQUIRED (accelerator/config), ALLOW_IFRAME_DAPPS (wallet-sdk/background:66), LOCAL_NETWORK_RPC_URL (network/service:64), FEE_MULTIPLIER (fee-strategy:65-68), DISABLE_HMR (global-setup:403). Propagation enforced post-build by grep assertions in agent.sh.

## 6. Test harness shape

smoke (~20 files, no chain) + network/ (~48 files; global-setup 718 spawns anvil+aztec+playground+faucet, port packs, lockfile orphan-kill). fixtures/ 8 files ~3,660: extension.ts 1,249 (launch/onboard/register/connect + test.extend + DOM helpers), helpers.ts 1,046 (~45 UI flow helpers), aztec.ts 473, popups.ts 381, passkey 157, playground 148, private-fpc-bridge 126, dappSession 76.

## 7. Generated/tracked exclusions

dist/, storybook-static/, .e2e-state/, wallet_data_*/; tracked-but-generated: src/types/auto-imports.d.ts, components.d.ts, .eslintrc-auto-import.json.

## 8. Change hotspots (3 months)

```
8 tests/e2e/network/tx-sendTx-default.test.ts   7 tests/e2e/fixtures/extension.ts
5 scripts/e2e/agent.sh                          4 e2e README, onboarding-tab.test
4 network/{tx-sendTx-multicall,multi-account-from,concurrent-sendtx,cancel-mid-prove}
4 fixtures/popups.ts                            3 several network tests + global-setup + fixtures/aztec
3 src/utils/tx-enrichment.ts (only src/utils hotspot)
```

## 9. Size outliers

1,249 fixtures/extension.ts · 1,046 fixtures/helpers.ts · 718 global-setup.ts · 673 import-paths.test.ts · 498 journal-state.test.ts · 473 fixtures/aztec.ts · 442 passkey-backup.test.ts · 392 amount.test.ts · 381 fixtures/popups.ts · 352 journal-state.ts · 300 contacts-sender.test.ts · 278 amount.ts · 277 files.ts · 253 onboarding-tab.test.ts. Root config outlier: vite.config.ts 324.
