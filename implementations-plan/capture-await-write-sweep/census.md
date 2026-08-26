# Census manifest — capture-await-write-sweep

All 280 production files in scope with async-write score + one-phrase basis (the audit trail for every enumeration exclusion). Scores: 0 = pure types/constants/pure fns · 1 = few awaits or read-only · 2 = async writes to shared state · 3 = hot concurrency zone. Score ≥2 (122 files) = full pass-1 enumeration (slices in recon.md §5). Score 0/1 files are NOT trusted blindly: the pass-3 shape screen re-verifies every one (two known mis-scores were found by the plan audit and promoted — marked ⬆ below).

Excluded from census by rule: `*.test.ts`, `*.stories.ts`, `*.d.ts`, and the two test-only helpers `wallet/services/composition-harness.ts`, `wallet/services/pxe/shallow-port.fake.ts` (doc'd "imported ONLY by test files").

## apps/extension/src/wallet/services/** (168 files)

| path (under services/) | LOC | score | basis |
|---|---|---|---|
| account/client.ts | 38 | 1 | thin RPC client |
| account/imported-keys-repository.ts | 67 | 2 | repository writes |
| account/service.ts | 798 | 3 | account create/restore (94 awaits) |
| account/spec.ts | 243 | 0 | RPC contract types |
| account-integrity/blocked-repository.ts | 82 | 2 | repository writes |
| account-integrity/coordinator.ts | 192 | 3 | coordinator (15 awaits) |
| account-integrity/types.ts | 63 | 0 | pure types |
| account-state/client.ts | 31 | 1 | thin RPC client |
| account-state/normalize.ts | 184 | 0 | pure normalize |
| account-state/service.ts | 345 | 3 | restore writer (29 awaits) |
| account-state/spec.ts | 72 | 0 | pure types |
| activity-protocol/coordinator.ts | 247 | 3 | coordinator (26 awaits) |
| activity-protocol/spec.ts | 70 | 0 | pure types |
| auth-registry/client.ts | 40 | 1 | thin RPC client |
| auth-registry/service.ts | 524 | 3 | service (62 awaits) |
| auth-registry/spec.ts | 102 | 0 | pure types |
| backup/backup-migration-registry.ts | 404 | 0 | pure data transforms |
| backup/backup-migrator.ts | 168 | 2 | migration orchestrator |
| backup/row-map-migration.ts | 359 | 1 | pure declarative transform |
| config/client.ts | 31 | 1 | thin RPC client |
| config/service.ts | 92 | 2 | config value writes |
| config/spec.ts | 16 | 0 | pure types |
| contact/client.ts | 34 | 1 | thin RPC client |
| contact/service.ts | 297 | 3 | CRUD service (43 awaits) |
| contact/spec.ts | 91 | 0 | pure types |
| dapp-interaction/client.ts | 29 | 1 | thin RPC client |
| dapp-interaction/materialize.ts | 122 | 1 | pure materializer |
| dapp-interaction/service.ts | 556 | 3 | orchestrator (Lock, cross-service) |
| dapp-interaction/spec.ts | 124 | 0 | pure types |
| dapp-session/capability-meta.ts | 215 | 0 | pure UI metadata |
| dapp-session/client.ts | 39 | 1 | thin RPC client |
| dapp-session/integrity.ts | 68 | 2 | MAC sign/verify |
| dapp-session/mac-storage.ts | 111 | 2 | MAC storage wrapper |
| dapp-session/service.ts | 384 | 3 | service (49 awaits) |
| dapp-session/spec.ts | 124 | 0 | pure types |
| execution/authwit-discoverer.ts | 246 | 2 | discovery (12 awaits) |
| execution/claim-helper.ts | 242 | 2 | race-aware claim helper |
| execution/client.ts | 29 | 1 | thin RPC client |
| execution/coerce-amount.ts | 43 | 0 | pure conversion |
| execution/contract-resolver.ts | 203 | 2 | resolver (10 awaits) |
| execution/dapp-send-executor.ts | 836 | 3 | send executor (39 awaits) |
| execution/discovery-aware-estimator.ts | 128 | 2 | estimator |
| execution/discovery-probe.ts | 97 | 2 | fold-safety probe |
| execution/estimate-cancel-registry.ts | 278 | 3 | admission/cancel registry |
| execution/estimate-reuse-shared.ts | 64 | 3 | TTL single-shot cache |
| execution/execution-coordinator.ts | 210 | 3 | coordinator |
| execution/execution-lane.ts | 433 | 3 | lane/queue |
| execution/execution-mutex.ts | 195 | 3 | bespoke FIFO mutex |
| execution/fast-path.ts | 230 | 2 | fast path |
| execution/fee/build-fee-strategies.ts | 25 | 0 | pure factory selection |
| execution/fee/embedded-fpc-cap.ts | 82 | 1 | pure cap computation |
| execution/fee/embedded-strategy.ts | 54 | 1 | compute-only strategy |
| execution/fee/fee-juice-strategy.ts | 66 | 1 | compute-only strategy |
| execution/fee/fee-juice-with-claim-strategy.ts | 45 | 1 | compute-only strategy |
| execution/fee/fee-strategy.ts | 339 | 1 | strategy interface/base |
| execution/fee/fpc-strategy.ts | 286 | 2 | two-pass FPC strategy + cache |
| execution/gas-balance-reader.ts | 230 | 2 | balance reader (epoch-stamped) |
| execution/helpers/batched-view-simulation.ts | 589 | 3 | "four concurrency arms" |
| execution/helpers/block-header-anchor.ts | 33 | 1 | small helper |
| execution/helpers/get-view-simulation-deps.ts | 46 | 1 | DI wiring helper |
| execution/mark-failed-unless-cancelled.ts | 41 | 3 | microtask-timing-pinned disposition |
| execution/models/index.ts | 79 | 0 | pure types |
| execution/operation-estimate-reuse.ts | 180 | 2 | reuse cache |
| execution/operation-fingerprint.ts | 186 | 0 | pure fingerprint hashing |
| execution/operation-planner.ts | 277 | 2 | planner |
| execution/rpc-cancel.ts | 86 | 1 | pure sentinel→error mapping |
| execution/service.ts | 929 | 3 | facade service (78 awaits) |
| execution/spec.ts | 108 | 0 | pure types |
| execution/transfer-estimate-reuse.ts | 235 | 2 | reuse cache |
| execution/transfer-executor.ts | 355 | 3 | executor |
| execution/tx-fee-details.ts | 34 | 0 | pure formatting |
| execution/tx-request-builder.ts | 539 | 2 | tx assembly (37 awaits) |
| execution/utils/fee-detection.ts | 20 | 0 | pure detection |
| execution/view-executor.ts | 399 | 1 | stateless read-only RPC family |
| fpc/client.ts | 32 | 1 | thin RPC client |
| fpc/fpc.ts | 28 | 0 | pure helper |
| fpc/handlers/default-sponsored-fpc-handler.ts | 37 | 1 | handler |
| fpc/handlers/index.ts | 28 | 0 | re-export |
| fpc/handlers/private-fpc-handler.ts | 45 | 1 | handler |
| fpc/service.ts | 473 | 3 | service (67 awaits) |
| fpc/spec.ts | 95 | 0 | pure types |
| id-allocators.ts | 66 | 3 | TOCTOU-prone id allocation |
| incoming-transfer/client.ts | 47 | 1 | thin RPC client |
| incoming-transfer/public-event-indexer.ts | 147 | 2 | event indexer |
| incoming-transfer/repository.ts | 201 | 3 | repository (20 awaits) |
| incoming-transfer/service.ts | 2039 | 3 | largest by awaits (186) |
| incoming-transfer/spec.ts | 397 | 0 | pure types + key helpers |
| log-viewer/client.ts | 23 | 1 | thin RPC client |
| log-viewer/service.ts | 34 | 1 | thin wrapper |
| log-viewer/spec.ts | 12 | 0 | pure types |
| logger/client.ts | 23 | 1 | thin RPC client |
| logger/service.ts | 25 | 1 | thin wrapper over LoggerStore |
| logger/spec.ts | 14 | 0 | pure types |
| network/client.ts | 135 | 1 | thin RPC client (no local state) |
| network/service.ts | 978 | 3 | service (118 awaits) |
| network/spec.ts | 365 | 0 | pure types + helpers |
| note/client.ts | 20 | 1 | thin RPC client |
| note/service.ts | 304 | 2 | note decode + classId memo |
| note/spec.ts | 67 | 0 | pure types |
| operation-journal/client.ts | 127 | 1 | thin RPC client |
| operation-journal/gc.ts | 147 | 2 | garbage collection |
| operation-journal/reaper.ts | 242 | 2 | stale-op reaper |
| operation-journal/service.ts | 573 | 3 | journal FSM service (48 awaits) |
| operation-journal/spec.ts | 377 | 0 | pure types |
| passkey/check-rp-id.ts | 171 | 0 | pure validator |
| passkey/client.ts | 24 | 1 | thin RPC client |
| passkey/service.ts | 136 | 2 | ceremony orchestration |
| passkey/spec.ts | 81 | 0 | pure types |
| price/client.ts | 25 | 1 | thin RPC client |
| price/convert.ts | 123 | 0 | pure math |
| price/price-map.ts | 98 | 0 | pure lookup |
| price/service.ts | 446 | 3 | service (39 awaits) |
| price/spec.ts | 50 | 0 | pure types |
| profile/client.ts ⬆ | 156 | 1→2 | PROMOTED (plan audit): `subscribeActiveProfile` documented snapshot→subscribe lost-event window |
| profile/passkey-recovery-coordinator.ts | 140 | 3 | recovery coordinator |
| profile/profile-deletion-state.ts | 77 | 3 | epoch fence primitive |
| profile/repository.ts | 108 | 2 | repository |
| profile/require-active-profile.ts | 33 | 1 | guard helper |
| profile/restore-pending-repository.ts | 121 | 3 | restore-pending repository |
| profile/service.ts | 2590 | 3 | largest file (253 awaits) |
| profile/session-manager.ts | 851 | 3 | session/lock manager |
| profile/spec.ts | 391 | 0 | pure types + helper |
| profile/tombstone-repository.ts | 112 | 2 | deletion-marker repository |
| profile-deletion/coordinator.ts | 139 | 3 | deletion coordinator |
| profile-deletion/types.ts | 27 | 0 | pure types |
| purge-rows.ts | 97 | 3 | shared purge primitive |
| pxe/client.ts | 51 | 1 | thin RPC client (extension-side) |
| pxe/shallow-port.ts | 36 | 1 | port/proxy wrapper |
| require-owned-row.ts | 17 | 1 | ownership guard (pure check) |
| restore-fence.ts | 44 | 3 | the namesake fence primitive |
| restore-rows.ts | 35 | 3 | shared restore-write loop |
| task/client.ts | 25 | 1 | thin RPC client |
| task/service.ts | 254 | 2 | in-memory task Map |
| task/spec.ts | 143 | 0 | pure types |
| task/wrapped-task.ts | 55 | 1 | thin wrapper |
| token/client.ts | 33 | 1 | thin RPC client |
| token/default-tokens.ts | 78 | 0 | pure data |
| token/functions/descriptors.ts | 437 | 0 | static descriptor data |
| token/functions/index.ts | 3 | 0 | re-export |
| token/functions/runtime.ts | 96 | 0 | pure class generator |
| token/functions/types.ts | 68 | 0 | pure types |
| token/seeder.ts | 359 | 3 | default-token seeder |
| token/service.ts | 720 | 3 | service (74 awaits) |
| token/spec.ts | 234 | 0 | pure types |
| token/utils.ts | 27 | 0 | pure utility |
| token-balance/balance-job-queue.ts | 317 | 3 | job queue |
| token-balance/balance-projector.ts | 245 | 2 | batched projector |
| token-balance/balance-repository.ts | 82 | 2 | repository |
| token-balance/client.ts | 33 | 1 | thin RPC client |
| token-balance/service.ts | 428 | 3 | service (36 awaits) |
| token-balance/spec.ts | 94 | 0 | pure types |
| transaction/client.ts | 33 | 1 | thin RPC client |
| transaction/service.ts | 608 | 3 | service (34 awaits) |
| transaction/spec.ts | 228 | 0 | pure types |
| wallet-sdk/background.ts | 841 | 3 | background message router |
| wallet-sdk/content-message-relay.ts | 127 | 3 | cold-wake relay (FIFO buffer) |
| wallet-sdk/content-script-validator.ts | 114 | 0 | pure envelope validator |
| wallet-sdk/discovery-approval.ts | 68 | 3 | discovery-window freshness re-check |
| wallet-sdk/error-envelope.ts | 106 | 0 | pure error formatting |
| wallet-sdk/pending-verification.ts | 35 | 2 | marker store |
| wallet-sdk/profile-switch-teardown.ts | 145 | 3 | switch teardown + epoch |
| wallet-sdk/queued-journal.ts | 266 | 3 | queued-journal creation lock |
| wallet-sdk/queued-wait-vouching.ts | 37 | 3 | vouching ordering |
| wallet-sdk/session-baton.ts | 39 | 3 | per-session FIFO baton |
| wallet-sdk/session-established.ts | 175 | 3 | verify path |
| wallet-sdk/tab-lifecycle.ts | 83 | 2 | tab-teardown wiring |
| wallet-sdk/to-json-safe.ts | 43 | 0 | pure serialization |
| window-manager/window-manager.ts | 193 | 2 | popup handle registry |

## packages/wallet-core/src/** (49 files)

| path (under src/) | LOC | score | basis |
|---|---|---|---|
| activity/causal.ts | 267 | 1 | pure causal reducer |
| activity/index.ts | 3 | 0 | re-export |
| activity/model.ts | 126 | 0 | pure types |
| activity/scope.ts | 59 | 0 | pure types |
| base/index.ts | 94 | 3 | startup orchestrator |
| base/topology.ts | 105 | 1 | pure topological sort |
| index.ts | 15 | 0 | re-export |
| jobs/error.ts | 72 | 1 | pure error normalization |
| jobs/fsm.ts | 106 | 0 | pure rule table |
| jobs/index.ts | 15 | 0 | re-export |
| jobs/types.ts | 156 | 0 | pure types |
| logger/index.ts | 1 | 0 | re-export |
| logger/interfaces.ts | 49 | 0 | pure interfaces |
| migration/index.ts | 25 | 0 | re-export |
| migration/migrator.ts | 456 | 3 | crash-safe engine (40 awaits) |
| migration/staging.ts | 70 | 2 | write-staging overlay |
| migration/types.ts | 105 | 0 | pure types |
| ports/alarms-port.ts | 36 | 0 | pure interface |
| ports/background-ticker-port.ts | 40 | 0 | pure interface |
| ports/browser-api.ts | 18 | 0 | pure interface |
| ports/clock-port.ts | 24 | 0 | pure interface |
| ports/index.ts | 20 | 0 | re-export |
| ports/runtime-port.ts | 68 | 0 | pure interface |
| ports/storage-port.ts | 44 | 0 | pure interface |
| ports/types.ts | 6 | 0 | pure types |
| ports/window-port.ts | 29 | 0 | pure interface |
| storage/entity_storage.ts | 250 | 3 | base CRUD engine (no CAS) |
| storage/index.ts | 3 | 0 | re-export |
| storage/memory-storage-area.ts | 31 | 1 | in-memory backing store |
| storage/value-storage.ts | 44 | 2 | single-value wrapper |
| testing/fake-background-ticker.ts | 66 | 1 | test double |
| testing/fake-browser-api.ts | 296 | 1 | test double |
| testing/index.ts | 12 | 0 | re-export |
| testing/mock-clock.ts | 96 | 1 | test double |
| utils/alarm-dispatcher.ts | 64 | 2 | chrome.alarms wrapper |
| utils/arrays.ts | 53 | 0 | pure utility |
| utils/encoding.ts | 39 | 0 | pure utility |
| utils/error-json.ts | 24 | 0 | pure utility |
| utils/errors.ts | 29 | 0 | pure utility |
| utils/event-handler.ts | 62 | 2 | pub/sub dispatcher (sync fan-out) |
| utils/index.ts | 13 | 0 | re-export |
| utils/keyed-lock.ts | 72 | 3 | per-key Lock wrapper |
| utils/lock.ts | 163 | 3 | canonical Lock primitive |
| utils/mnemonic.ts | 2182 | 0 | BIP39 wordlist + pure helpers |
| utils/queue.ts | 50 | 2 | keyed Queue structure |
| utils/random.ts | 15 | 0 | pure utility |
| utils/rw-guard.ts | 203 | 3 | reader/writer guard |
| utils/serialization.ts | 57 | 0 | pure utility |
| utils/sleep.ts | 1 | 0 | pure utility |

## packages/aztec-runtime/src/** (36 files)

| path (under src/) | LOC | score | basis |
|---|---|---|---|
| account/account-export.ts | 152 | 2 | export/import envelope |
| account/address-freeze.ts | 92 | 0 | frozen regime record |
| account/fee-options.ts | 90 | 1 | pure gas translator |
| account/frozen-artifact.ts | 25 | 0 | static reference |
| account/index.ts | 55 | 0 | re-export |
| account/instantiation-descriptor.ts | 87 | 0 | pure descriptor |
| account/nulo-account.ts | 245 | 1 | account contract adapter |
| adapters/aztec-node-factory-adapter.ts | 69 | 1 | node factory |
| adapters/index.ts | 1 | 0 | re-export |
| index.ts | 1 | 0 | re-export |
| offscreen/entry.ts | 47 | 2 | offscreen bootstrap |
| ports/index.ts | 1 | 0 | re-export |
| ports/node-factory-port.ts | 35 | 0 | pure interface |
| pxe/artifact-catalog.ts | 108 | 2 | memoized catalog |
| pxe/artifact-class-id.ts | 71 | 0 | pure verification |
| pxe/artifact-registry.ts | 213 | 2 | memoized registry cache |
| pxe/async-memo.ts | 63 | 3 | memoization primitive |
| pxe/chain-coordinates.ts | 37 | 1 | pure coordinate codec |
| pxe/chain-runtime.ts | 390 | 3 | per-chain runtime lifecycle |
| pxe/client.ts ⬆ | 360 | 1→3 | PROMOTED (plan audit): `request()` :124-194 — mutable providers, generation capture, provision retry |
| pxe/descriptors.ts | 112 | 0 | static descriptor table |
| pxe/effective-class.ts | 42 | 1 | pure resolution seam |
| pxe/index.ts | 34 | 0 | re-export |
| pxe/ipxe.ts | 52 | 0 | pure interface |
| pxe/known-artifacts.ts | 40 | 1 | static loader |
| pxe/lifecycle-coordinator.ts | 45 | 3 | purge-epoch fence |
| pxe/note-schemas.ts | 90 | 2 | memoized lookups |
| pxe/opfs-store.ts | 302 | 3 | encrypted OPFS store |
| pxe/proxy.ts | 66 | 1 | network-pinned proxy |
| pxe/public-events.ts | 410 | 3 | public-event indexer |
| pxe/schemas.ts | 42 | 0 | pure schema types |
| pxe/service.ts | 923 | 3 | PXE service (68 awaits) |
| pxe/spec.ts | 120 | 0 | pure types |
| utils/chain-identity.ts | 71 | 1 | pure identity assertion |
| utils/fetch.ts | 108 | 1 | timeout-wrapped fetch |
| utils/index.ts | 3 | 0 | re-export |

## apps/extension/src/composables/** (33 files; 18 qualify as service-writers)

Score ≥2 qualifiers: completeImportWithRecovery (68·3), importChainSync (111·3), importPreflight (82·3), internal/fee-estimation-engine (185·3), runFence (22·3), useDappApprovalWindow (141·2), useEntityCrud (136·3), useFeeEstimation (91·2), useFeeEstimationMap (101·2), useFullBackupImport (1045·3), useIncomingTransfers (152·3), useProfileBootstrap (195·3), useProfileCreateFlow (139·3), useProfileImportFlow (358·3), usePrices (99·2). Score 1: fullscreenPopupSetting (45 — read-only config sub), unlockWait (62 — pure wait), waitForProfileActive (48 — pure wait).

Excluded as pure UI (doc'd bases): useDappInteractionPayload (type-only import), usePasskeyCeremony ("NO service client subscription"), useProfileNameField (C0), usePopupEntity ("does NOT own any service client"), useFormState, useSecretClipboardCopy, useSecretCountdown, useDappHostname, ticker, outside.js, toast.js(+d.ts), syncedRef.js(+d.ts — writes via raw storage facade, NOT a service client; init-read-late echo shape recorded in the triage table).

## Storage + entrypoints (9 files)

| path | LOC | score | basis |
|---|---|---|---|
| wallet/storage/index.ts | 9 | 0 | re-export barrel |
| wallet/storage/migrations/index.ts | 133 | 3 | boot-gate status decode |
| wallet/storage/migrations/template.ts | 88 | 0 | authoring template (realMigrations empty) |
| wallet/index.ts | 111 | 3 | MV3 SW entrypoint |
| wallet/runtime.ts | 520 | 3 | composition root |
| wallet/single-flight-start.ts | 27 | 3 | boot single-flight memo |
| offscreen/index.ts | 122 | 3 | offscreen entrypoint |
| wallet/utils/offscreen.ts | 404 | 3 | offscreen lifecycle (SW side) |
| utils/background-liveness.ts | 95 | 3 | liveness/heartbeat wait |

## Carve-outs (parent-skimmed, in the triage table as parent-slice rows)

`wallet/config/{index,config,store}.ts` — store.ts has `set()` under lock but `apply()` (load/reset) writing UNLOCKED (parent finding CFG-1); `wallet/logger/{index,utils,store}.ts` — store.ts `rehydrate()` id re-max after await (LOG-1, diagnostic-only); `wallet/base/index.ts` — pure re-export.

## Scope-adjacent screen (documented addition per the plan audit)

`packages/extension-messaging/src/**` — pass-3 shape screen; hits get their own table section.
