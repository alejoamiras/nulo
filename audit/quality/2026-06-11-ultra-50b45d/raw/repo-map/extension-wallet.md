# Wallet-Services Layer Map — `packages/extension/src/wallet`

Mapper: Fable Explore subagent. `W = packages/extension/src/wallet`. Totals: ~38,600 LOC TS in scope (incl. tests), 24 service dirs, 21 RPC services registered in `W/runtime.ts`.

## 1. Service inventory (service/spec/client LOC + helpers)

| Service | Purpose | s/s/c | Helpers |
|---|---|---|---|
| account | Account CRUD, profile-scoped | 235/86/41 | contracts/ (nulo-account.test only) |
| account-state | PXE read facade: registered accounts/senders | 239/72/40 | — |
| auth-registry | Authwit registry + on-chain ops | 312/62/39 | — |
| config | RPC bridge over ConfigStore | 64/16/31 | — |
| contact | Contacts CRUD | 320/75/49 | — |
| dapp-interaction | dApp approval orchestration, windows, materialization | 511/109/43 | materialize.ts 147 |
| dapp-session | Session/capability storage; types re-exported from wallet-bridge | 339/79/86 | capability-meta.ts 200 |
| execution | Tx execution facade | **2302**/85/78 | 19 non-test files (see §5) |
| fpc | FPC registry + handler strategy | 521/77/41 | handlers/ (3 files) |
| incoming-transfer | PXE-note polling, trust state machine | 830/154/60 | repository.ts 122 |
| log-viewer / logger | log streaming / RPC log sink | 33/24 | — |
| network | Networks+endpoints aggregate, zod-validated | 781/280/117 | — |
| note | Private-note read/decode | 303/67/24 | — |
| operation-journal | Durable op journal, FSM under named Lock | 416/363/127 | gc.ts 149, reaper.ts 214 |
| passkey | WebAuthn popup prompts | 126/78/24 | check-rp-id.ts 171 |
| profile | Profiles + master-secret crypto + sessions | **1053**/289/158 | repository 108, session-manager 578, passkey-recovery-coordinator 128 |
| pxe | client-only shim over aztec-runtime | –/–/24 | (tests for aztec-runtime parked here) |
| task | Task tracking | 246/137/25 | wrapped-task 48 |
| token | Token registry + contract call builders | 573/204/66 | functions/ (9 files) |
| token-balance | Balance projection pipeline | 273/48/29 | job-queue 174, projector 234, repository 51 |
| transaction | Local tx records | 325/151/25 | — |
| wallet-sdk | initWalletSdkHandler wiring (not a Service) | background.ts 734 | content-script-validator 109, error-envelope 54, nulo-schema-patch 55, queued-journal 178, session-baton 39 |
| window-manager | chrome.windows lifecycle (not a Service) | window-manager.ts ~268 | — |

Non-service: W/base (re-export), W/storage (re-export + migrate.ts 100), W/config, W/logger, W/utils (caip 87, offscreen 233, fn 120, onboarding-tab 89, create-passkey-profile 57, auth-registry 55, fee-juice 23), W/runtime.ts 217, W/index.ts 83.

## 2. Public surface

All 21 RPC services have used clients. Client instantiation counts outside src/wallet: Logger 23, Profile 15, Token 14, Config 14, Task 11 … Note 1. Constructed ad hoc in ~50 Vue components.
`PxeServiceClient` created independently in **8 services'** init() (token:57, note:46, transaction:52, network:163, fpc:60, execution:342, token-balance:67, account-state:36).

Event subscriptions (all EventHandler.add in init()): network→profile.onActiveProfileChanged/onProfileDeleted; account/contact/token/fpc/dapp-session→profile.onProfileDeleted; task→onActiveProfileChanged; incoming-transfer→token.onTokenAdded+transaction.onTransactionAdded+profile×2; token-balance→profile/account/token×3/transaction; execution→transaction.onTransactionUpdated+fpc×2; operation-journal→network.registerChainPurgeSubscriber; wallet-sdk→profile.onActiveProfileChanged; config/loggerStore/session-manager→ConfigStore.onUpdate.

## 3. Dependency graph

Resolution by services.get(X.name) in init(); only contact + incoming-transfer (8 deps) declare `dependencies` for topological ordering — everyone else lands in phase 0 and relies on ensureInitialized() 30s-poll fallback (extension-messaging/background/service.ts:187-199).

execution → **10 services** + pxe (service.ts:342-352). Cycle-ish pairs resolved by late lookup: execution↔auth-registry, token-balance→execution, execution↔dapp-interaction.

Package imports (non-test): wallet-bridge — 6 files (mostly type re-export shims); aztec-runtime — 12 files; wallet-core — pervasive (59 utils imports); extension-messaging — 42 background + 7 errors + 4 zod.

## 4. Similarity candidates (copy-paste patterns)

1. **backup()/restore() loop** — 9 services with near-identical accumulate-Restored-with-restoreError loops: token:523/532, transaction:279/302, contact:286/290, config:39/43, network:604/614, fpc:463/470, auth-registry:262/285, account:204/213, profile:826/830.
2. **onProfileDeleted purge subscriber** — same shape in 6 services: account:194, contact:256, dapp-session:325, fpc:447, network:671, token:515.
3. **Active-profile guard** — getActiveProfile + unauthorized branch ×17 in network alone (170-762), ×8 contact, plus transaction/fpc/token; literal "Unauthorized" in 4 places.
4. **Lock acquisition** — per-service new Lock() + enter/leave per mutator: profile 21, network 13, dapp-session 12, fpc 7, token 5, contact 5, auth-registry 5; named locks only in newer code.
5. **EntityStorage browserApi-fallback ternary** duplicated: contact:38-39, operation-journal:85-87, profile/repository:44-45 (+ValueStorage variant session-manager:131-132); 8 other services hard-code chrome.storage.local.
6. **Added/Updated/Deleted event triples** in 11 services.
7. **PxeServiceClient per-service instantiation** ×8.
8. **ensureInitialized() preamble** at top of nearly every RPC method (network 17×, profile 24×, …).

## 5. execution/ deep-dive (8,643 LOC incl. tests)

Facade service.ts (2302). Extracted: operation-planner 257, contract-resolver 135, authwit-discoverer 260, tx-request-builder 487, execution-coordinator 100, claim-helper 166, execution-mutex 195, fast-path 230, rpc-cancel 74, coerce-amount 43, fee/ (fee-strategy 202, fpc-strategy 91, embedded-fpc-cap 82, embedded 57, fjwc 48, fj 40), helpers/ (batched-view-simulation 591, get-view-simulation-deps 48, block-header-anchor 33), models/index 79 (wallet-bridge re-exports), spec 85, client 78.

Facade state (252-335): 11 service refs + 6 collaborators; gasBalanceCache + single-flight map; estimateReuseCache (type inline at :154-190); activeControllers; executionMutex + waiters + heartbeat; origin/lane caps. Module-level free functions fingerprintBaseFee/fingerprintFeeSettings/getEstimatedFee/getGasDetails/pickActionMethod at :141-247.

Methods >100 lines: executeTransfer :405-618 (~214), executeOperations :914-1032 (~119, 22-kind dispatcher), executeAztecSendTx :1860-2021 (~162), executeNoFromSendTx :2022-2206 (~185). Borderline: tryConsumeTransferEstimate ~98, estimateTransferFee ~99, executeSendTransaction ~91, #computeGasBalances ~75, executeAztecSimulateTx ~82.

**No service.test.ts for the facade**; tested via 12 extracted-helper test files + fingerprints.test + feesettings-invariant.test.

## 6. House conventions

spec/service/client triple; Service base handles port fan-out, jsonSanitize fallback, WalletError round-trip, default backup/restore, ensureInitialized (500ms poll, 30s timeout). Events: EventHandler fields double as events map. Error prefixes: only network has ERR_* constants. Zod in spec: only network + operation-journal. Locks from wallet-core. Storage keys nulo:core:* frozen.

## 7. Test surfaces

Well-covered: incoming-transfer (scenarios 2004), profile (integration 858, session-manager 841), network (904), operation-journal, token-balance helpers, execution helpers (12 files), dapp-interaction, task, note, account-state, contact, window-manager, wallet-sdk helpers, passkey, pxe.
**Zero tests**: auth-registry, fpc, token service (+functions/), transaction, dapp-session service, config service, log-viewer, logger, account service.
**Untested large facades**: execution/service.ts (2302), wallet-sdk/background.ts (734), token-balance/service.ts, fpc/service.ts.

## 8. Change hotspots (3 months)

```
9 execution/service.ts            6 wallet-sdk/background.ts
6 operation-journal/service.ts    5 dapp-interaction/{spec,service}.ts
4 operation-journal/spec.ts       4 execution/fast-path.ts
3 token triple, balance-projector, profile/service, oj/client,
  execution/models, batched-view-simulation, materialize, config/config
```

## 9. Size outliers

2302 execution/service.ts · 2004 incoming-transfer scenarios test · 1053 profile/service.ts · 904 network test · 858 profile integration test · 841 session-manager test · 830 incoming-transfer/service.ts · 808 bvs test · 781 network/service.ts · 734 wallet-sdk/background.ts · 591 batched-view-simulation.ts · 578 session-manager.ts · 573 token/service.ts · 565 oj test · 521 fpc/service.ts. Then dapp-interaction 511, tx-request-builder 487, operation-journal 416.
