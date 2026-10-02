# Repo map: apps/extension/src/{wallet,offscreen,presto,core,content-script}

Paths are relative to `apps/extension/src/`. LOC = non-test lines (`git ls-files`, tests excluded): ~45.4k across 234 files.
Snapshot of dev @ 910a4def. Mapped from file listing, import greps and header reads (not line-by-line reading).

## 1. Module inventory

### Files > 800 LOC (production)
| File | LOC |
|---|---|
| wallet/services/profile/service.ts | 2797 |
| wallet/services/incoming-transfer/service.ts | 2464 |
| wallet/services/wallet-sdk/background.ts | 1262 |
| wallet/services/execution/service.ts | 1121 |
| wallet/services/execution/dapp-send-executor.ts | 1107 |
| wallet/services/network/service.ts | 1026 |
| wallet/services/profile/session-manager.ts | 973 |
| wallet/services/token/service.ts | 912 |
| wallet/services/account/service.ts | 858 |
(next tier 650-730: token-balance/service 727, dapp-interaction/service 723, token/seeder 722, wallet/runtime.ts 684, operation-journal/service 675, auth-registry/service 666, execution/helpers/batched-view-simulation 657)

### Per directory (LOC non-test; tests = count of *.test.ts)
- wallet/runtime.ts 684: composition root `createWalletRuntime(deps)`; builds `ServiceCollection`, wires PXE providers (`wirePxeProviders`, `providePxeStoreKey`), migrator, `armPostStartWork`, `stopRuntime`. No unit test file of its own (covered by composition tests).
- wallet/index.ts 116: MV3 SW shell: onInstalled, openPopup message, alarms dispatch, relay registration.
- wallet/single-flight-start.ts 26, wallet/base (5): `ServiceCollection`, `Restored` type.
- wallet/config 193 (config store), wallet/constants 58 (explorers), wallet/logger 503 (LoggerStore, console forwarding, `trim()` redaction walker in utils.ts), wallet/storage 239 (+ migrations/ index, template), wallet/utils 965 (offscreen lifecycle 352, caip, passkey helpers, fee-juice, raw-row, onboarding-tab; 10 tests). wallet/crypto is empty.
- services shared helpers (root of services/): purge-rows.ts 97 (`purgeRows`, raw second-pass purge, `canonicalNumericStorageId`), restore-rows.ts 35 (`restoreRows`), id-allocators.ts 75 (`nextNumericId`, `nextRandomId`), require-owned-row.ts 17, restore-fence.ts 44, composition-harness.ts 13.
- services/profile 4843: profile CRUD, lock/unlock, session manager (TTL alarm, `chrome.storage.session` mirror), passkey recovery coordinator, tombstone + restore-pending + deletion-state repositories. 11 tests.
- services/execution 10074 (largest): tx lifecycle. service.ts (RPC surface), execution-coordinator (sole `node.sendTx`, legal guard), executors (transfer 430, dapp-send 1107, view 409), tx-request-builder 616, execution-lane 501, execution-mutex, operation-planner, estimate reuse (operation-/transfer-/shared), authwit-discoverer, discovery-probe/-aware-estimator, sponsor-funding, claim-helper, call-decoder, contract-resolver, fee/ (strategies), helpers/ (batched-view-simulation 657, block-header-anchor). 49 tests, incl. characterization/composition/pins.
- services/incoming-transfer 3596: note scan / arrival detection: service 2464, public-event-indexer, scan-episodes, scan-health, arrival-state, repository. 8 tests.
- services/wallet-sdk 3404: dApp-facing handler (background.ts 1262) plus admission/verification (verify-admission 397), session baton/established/stale, content-message-relay, tab-lifecycle, queued journal/vouching, error-envelope, to-json-safe, content-script-validator. 22 tests.
- services/token 2757: token registry, seeder (722), default-tokens, functions/ (descriptors 438, runtime), utils. 9 tests.
- services/token-balance 1843: balance repo/projector/identity, job queue 431, reconcile-pairs, service 727. 9 tests.
- services/operation-journal 1748: durable tx operation log + gc.ts, reaper.ts (alarm-driven), send-check.ts, spec 393. 7 tests.
- services/network 1524: networks/nodes CRUD, chain identity, purge events. 2 tests.
- services/account 1208: accounts, imported-keys repo, nulo-account contracts dir (test only). 6 tests.
- services/backup 1074: backup-migration-registry 477, row-map-migration 372, backup-migrator (no service.ts/spec: library-style, called by profile/export flows). 4 tests.
- services/dapp-interaction 1063, dapp-session 999 (MAC storage, integrity, capability-meta), account-state 854, transaction 877 (+receipt-status), auth-registry 850, fpc 756 (+handlers/ default-sponsored, private), price 746 (CoinGecko), contact 437, passkey 418, account-integrity 326, activity-protocol 317, window-manager 287, note 343, task 459 (+wrapped-task), config 158, legal 135, profile-deletion 172, pxe 208 (client-side PXE providers + shallow-port.fake), log-viewer 71, logger 101.
- offscreen 120: index.ts (PONG gating, console/unhandled-rejection capture, `createPxeOffscreen` from @nulo/aztec-runtime). 0 tests.
- presto 48: client.ts/config.ts (Presto native prover endpoint config, `PRESTO_*` build stamps). 4 tests.
- core 480: `adapters/` (chrome-browser-api, clock-ticker, system-clock) implementing wallet-core ports. 2 tests.
- content-script 22: thin `ContentScriptConnectionHandler` relay from @aztec/wallet-sdk. No tests.

## 2. Entrypoints

### The service pattern (describe once)
Each `services/<name>/` has `spec.ts` (zod schemas + service/client interface + events, ~300-430 LOC on the big ones), `service.ts` (extends wallet-core `BaseService`-style class registered in `ServiceCollection`; constructed in runtime.ts lines ~471-536 as `new XService(logger, browserApi, ...)`), `client.ts` (`XServiceClient`, extension-messaging port client used by popup/offscreen/other contexts; retries/connect logic in some e.g. token/client, incoming-transfer/client, profile/client, operation-journal/client). Persistence via `EntityStorage`/`ValueStorage` (wallet-core/storage, `${root}@${id}` rows) over `chrome.storage.local`. Lifecycle purges (profile/chain/account teardown) via `purgeRows`; backup restore via `restoreRows`; ids via `nextNumericId`/`nextRandomId`.

### Background / SW
- wallet/index.ts: `chrome.runtime.onInstalled`, `chrome.runtime.onMessage` (openPopup), `chrome.alarms.onAlarm` (line ~96); content-message-relay.ts is the SINGLE onMessage listener for content traffic (cold wake).
- wallet/runtime.ts: `createWalletRuntime().start()` => migrations (Migrator), PXE key/generation/recovery providers, all services, `initWalletSdkHandler` (wallet-sdk/background.ts), `armPostStartWork`, single-flight start.
- Alarms: profile/session-manager (TTL lock alarm), operation-journal/reaper (1 min tick) + gc, price/service (refresh via wrapped alarms port).
- Tab/window events: wallet-sdk/tab-lifecycle (tabs.onRemoved/onUpdated), window-manager (windows.onRemoved), dapp-interaction + passkey (window-closed cleanup).
- Offscreen: wallet/utils/offscreen.ts (createDocument/ping/PONG/close, Firefox no-`chrome.offscreen` fallback), offscreen/index.ts (PXE host).
- Content script: content-script/content.ts (postMessage/MessagePort relay only).
- dApp ingress: wallet-sdk/background.ts (discovery, key-exchange verification, encrypted message dispatch, legal `assertCurrent`).

## 3. Trust boundaries
- Secrets/session: profile/session-manager.ts holds the Session (master-key derived material) mirrored to `chrome.storage.session` (key `nulo:core:session`); zeroize discipline with `@nulo/wallet-crypto`; `providePxeStoreKey` derives PXE store key in runtime.ts; account/imported-keys-repository (ImportedKeysDek); passkey/ (WebAuthn PRF), passkey-recovery-coordinator; dapp-session/mac-storage + integrity (per-dApp session MAC); account-integrity coordinator (address re-derivation mismatch => blocking state).
- dApp/user-input sinks: wallet-sdk/{background, verify-admission, content-script-validator, pending-verification, session-established, stale-session, to-json-safe, error-envelope}; dapp-interaction (approval windows, payload rendering); execution/{dapp-send-executor, call-decoder, tx-request-builder, contract-resolver, authwit-discoverer}; auth-registry; token/functions (user-supplied token metadata via `metadata.fetch()`), contact, backup import (backup-migration-registry / row-map-migration treat blobs as hostile).
- External calls: Aztec node via network/service (node clients), PXE via pxe/client (offscreen), CoinGecko `https://api.coingecko.com/api/v3` in price/service.ts (only direct `fetch`, injectable `fetchFn`), Presto local prover (presto/config; plaintext 127.0.0.1 in CI, HTTPS in prod).
- Storage writes: chrome.storage.local via EntityStorage/ValueStorage in nearly every service; raw `chrome.storage` direct use in config/store, logger/store, account-integrity/coordinator, contact/service, dapp-session/integrity, backup-migration-registry, operation-journal/{spec,gc}. Persisted-shape changes are migration-governed (wallet/storage/migrations is empty: pre-production).
- Logging: `console.*` hijacked into LoggerStore; `trim()` redaction by key name (wallet/logger/utils.ts).
- Broadcast guard: ExecutionCoordinator.sendTxTask is the only `node.sendTx`; legal guard pinned by call-sites test.

## 4. Dependency graph (service -> services, one level, from import greps)
- account -> account-integrity, logger, network, profile
- account-integrity -> account, profile  (CYCLE account <-> account-integrity)
- account-state -> logger, network, pxe
- auth-registry -> account, execution, logger, network, profile, task, transaction
- backup -> account, account-state, auth-registry, config, contact, fpc, network, profile, token, token-balance, transaction (fan-in hub, no inbound cycle)
- contact -> profile; dapp-session -> profile; price -> config, profile; note -> network, pxe; task -> execution, profile, transaction; transaction -> account, network, profile, task
- dapp-interaction -> account, dapp-session, execution, fpc, network, operation-journal, profile, token, transaction, window-manager
- execution -> account, auth-registry, contact, dapp-interaction, fpc, legal, network, operation-journal, profile, pxe, task, token, transaction
- fpc -> execution, network, profile, pxe, spec
- incoming-transfer -> account, config, network, note, operation-journal, price, profile, pxe, task, token, token-balance, transaction
- operation-journal -> network, profile, token-balance, transaction
- profile -> account-integrity, passkey, profile-deletion
- profile-deletion -> account, auth-registry, contact, dapp-session, fpc, incoming-transfer, network, operation-journal, profile, pxe, token, token-balance, transaction (hub)
- token -> account, execution, network, operation-journal, profile, pxe, task
- token-balance -> account, execution, network, profile, pxe, task, token, transaction
- wallet-sdk -> account, dapp-interaction, dapp-session, execution, legal, network, operation-journal, profile, token, window-manager
- Cycles (import-level, some likely type-only/lazy; verify before judging):
  - profile -> profile-deletion -> profile; profile -> account-integrity -> profile; account <-> account-integrity
  - execution <-> dapp-interaction; execution <-> fpc; execution <-> task <-> transaction; execution <-> token <-> task; token <-> token-balance <-> execution; auth-registry <-> execution
  - Likely mostly `import type` or client/spec imports; a dep-cruiser run on non-type edges would confirm.
- Outside: `@/e2e/*` (proof gate, restore gate, token seeds) imported by runtime.ts (test hooks in prod module graph, guarded by build flags).

## 5. Frameworks / libs
@aztec/* (stdlib subpaths tx/abi/aztec-address/gas/contract/interfaces, foundation/curves/bn254, entrypoints, aztec.js wallet/authorization, bb.js BarretenbergSync, wallet-sdk handlers/base-wallet/types, constants); zod (24 imports); workspace: @nulo/wallet-core (utils 69, ports 41, jobs 20, logger, migration, storage, activity), @nulo/extension-messaging (background 46, errors 28, zod), @nulo/wallet-bridge (41), @nulo/wallet-crypto, @nulo/aztec-runtime (pxe, account, utils, fee-juice, offscreen), @nulo/legal. Chrome MV3 APIs (alarms, offscreen, windows, tabs, storage, action). No vue here; no fetch library (native fetch once).

## 6. Test surfaces
Colocated `*.test.ts` (approx 200 files in these dirs). Heaviest: execution 49, wallet-sdk 22, profile 11, utils 10, token/token-balance 9, incoming-transfer 8. Variants: `*.composition.test.ts` (real graph vs fakes; rules in apps/extension/tests/COMPOSITION-TESTS.md), `*.characterization.test.ts`, `*.pins.test.ts`, `*.real.test.ts` (authwit-discoverer, env-gated), structural/property tests in execution/fee (strategies-structural 904 LOC test, fee-structural-parity, clamp-properties). No tests at all: offscreen, content-script, wallet/index.ts, runtime.ts (composition-only), single-flight-start, id-allocators/purge-rows/restore-rows (direct file absent; possibly tested via consumers), backup/row-map-migration has tests. Network suite: apps/extension/tests/e2e (out of scope). Under-tested by count: network (2 tests for 1524 LOC), transaction (2 / 877), fpc (2 / 756), auth-registry (1 / 850), contact (1), activity-protocol (1).

## 7. Generated / vendored / fixtures to exclude
- `wallet/services/token/functions/__snapshots__/` (vitest snapshots)
- Test-support non-test-named files: services/composition-harness.ts, pxe/shallow-port.fake.ts, token/seeder.harness.ts, wallet-sdk/queued-journal.fixtures.ts, wallet-sdk/test-ports.ts
- `wallet/services/account/contracts/` holds only a test; frozen artifact lives in packages/aztec-runtime (out of area)
- Forked-from-Azguard headers (Apache-2.0) e.g. offscreen/index.ts: provenance, not vendored code
- e2e hooks from `@/e2e/*` (not in area)

## 8. Similarity candidates (for dedup audit)
1. **Fee strategies** (services/execution/fee/): `fee-juice-strategy.ts` (76), `fee-juice-with-claim-strategy.ts` (50), `embedded-strategy.ts` (54), `fpc-strategy.ts` (308). Each `buildAndEstimate` repeats the `suggestGasLimits(built.txRequest, ctx.op.fee)` + first/second sim shape (fpc-strategy.ts has it 4x, fee-juice-strategy 2x). Shared helpers already in fee-strategy.ts (`probedFirstSimOpts`, `finalizeGasLimits`, `admissionCap`, `assertCustomGasLimitsWithinCap`). A dedicated structural-parity test exists, suggesting the duplication is known and pinned.
2. **Executors** (services/execution/): `transfer-executor.ts` (430), `dapp-send-executor.ts` (1107), `view-executor.ts` (409), plus `execution-coordinator.ts`/`execution-lane.ts`/`mark-failed-unless-cancelled.ts`. Journal begin/mark-failed/cancel-window, estimate-reuse and lane/mutex boilerplate likely repeated. Also three estimate-reuse files: `operation-estimate-reuse.ts`, `transfer-estimate-reuse.ts`, `estimate-reuse-shared.ts`; fingerprinting in `operation-fingerprint.ts` vs `fingerprints` test.
3. **Purge/restore listeners per service**: purgeRows adopters account, contact, auth-registry, dapp-session, fpc, operation-journal, token, transaction (+ network, token-balance, which use purge-rows imports). Each re-implements `ensureInitialized` + lock + filter + post-loop cleanup + raw second-pass; `restore()` in account, auth-registry, config, account-state, contact, transaction, token-balance, token, profile. Compare `restore`, `onProfileDeleted/onChainPurged`-style handlers across these service.ts files.
4. **Spec boilerplate**: 27 spec.ts files declare zod schemas, service interfaces, event lists in same shape; client.ts files duplicate connect/retry logic (token/client, incoming-transfer/client, operation-journal/client, profile/client).
5. **Repository classes**: profile/{repository, tombstone-repository, restore-pending-repository, profile-deletion-state}, incoming-transfer/repository, token-balance/balance-repository, account/imported-keys-repository: same CRUD-over-EntityStorage/ValueStorage shape.
6. **Id allocation**: `nextNumericId` (token, token-balance) vs `nextRandomId` (contact, fpc, network); check for remaining inline `getRandomHex ... while contains` loops.
7. **Queues/jobs/retries**: token-balance/balance-job-queue.ts (431), task/service.ts + wrapped-task, operation-journal/{gc,reaper}, incoming-transfer/scan-episodes, execution/execution-lane + execution-mutex, single-flight-start.ts, runtime armPostStartWork; ~30 files use setTimeout/retry/backoff (wallet-sdk/verify-admission, pending-verification, session-established; incoming-transfer/client, token/client, price/service, network/service, auth-registry/service).
8. **Alarm wrappers**: price/service.ts lines ~436-444 wraps chrome.alarms; session-manager, reaper and gc each have their own alarm wiring (comments in reaper.ts:123, gc.ts:83 about listener stacking), likely one port could serve.
9. **Codecs / JSON-safety**: wallet-sdk/to-json-safe.ts, error-envelope.ts, execution/coerce-amount.ts, call-decoder.ts, token/functions/descriptors.ts (438), backup/row-map-migration.ts vs backup-migration-registry.ts, logger/utils.ts `trim()`; BigInt/Fr/AztecAddress serialization likely reimplemented.
10. **FPC handlers**: fpc/handlers/{default-sponsored,private}-fpc-handler.ts + execution/fee/fpc-strategy `sponsorOf` + execution/sponsor-funding.ts.
11. **Amount/fee-juice utils**: wallet/utils/fee-juice.ts + fee-juice-balance.ts vs execution/gas-balance-reader.ts vs token-balance reads.
12. **Batched sim**: execution/helpers/batched-view-simulation.ts (657) vs view-executor.ts / get-view-simulation-deps.ts.

## 9. For the later bugs audit
### State owners (mutable / persisted / locks / caches)
- profile/session-manager.ts (Session in memory + chrome.storage.session; TTL alarm; zeroize); profile/service.ts (2797 LOC; lock/unlock/restore/deletion flows; tombstone/restore-pending/deletion-state persisted).
- execution/execution-mutex.ts (19 lock/inflight markers), execution-lane.ts (15), estimate-cancel-registry.ts, preview-snapshots.ts, operation-estimate-reuse caches, execution-coordinator (broadcast guard ordering: `legal.assertCurrent` then `assertLive`, nothing awaited between).
- network/service.ts (18 map/set/inflight markers: node clients, chain identity), incoming-transfer/service.ts (18: scan episodes, arrival state), token-balance/service.ts (14) + balance-job-queue, token/seeder.ts (13), operation-journal/service.ts (12) + gc + reaper, transaction (9), dapp-session (9, MAC + session baton), auth-registry (9), fpc (8), account (8), price (7: price map cache, alarm), contact (7), wallet-sdk/{session-baton, pending-verification, verify-admission, tab-lifecycle, queued-wait-vouching} (per-tab/per-session maps; SW restart and stale-session races).
- logger/store.ts (ring buffer, persistence only with developerMode), wallet/config/store.ts, wallet/utils/offscreen.ts (offscreen document generation/ping state; Chrome vs Firefox divergence), offscreen/index.ts (`servicesReady` flag), single-flight-start.ts.
### Error-path-heavy modules
profile/service.ts + session-manager.ts (restore/reset/recovery, integrity states), backup/* (hostile blob parsing, migration failures), execution/dapp-send-executor.ts + transfer-executor.ts + execution-coordinator (cancel windows, mark-failed-unless-cancelled, prove-phase), operation-journal (reaper/gc races, send-check), incoming-transfer/service.ts + public-event-indexer (scan health, retries), wallet-sdk/background.ts + verify-admission + stale-session + error-envelope (dApp-facing error mapping, URL scrubbing), account-integrity/coordinator (mismatch handling), network/service.ts (node failure, chain-id mismatch), token-balance/reconcile-pairs, price/service (network failure / stale), wallet/utils/offscreen.ts (timeouts, listener cleanup), purge-rows raw second pass (`F-B23`) and restore-rows (best-effort, per-row restoreError).
