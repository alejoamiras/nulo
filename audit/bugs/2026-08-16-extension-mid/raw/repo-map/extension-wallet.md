# Non-UI Half of `apps/extension` — Structural Map

Scope covered: `apps/extension/src/wallet/**`, background/offscreen entry code, `src/utils/**`, manifest + vite build entrypoints. Note: **`src/wallet-sdk/**` does not exist as a top-level directory** — the wallet-sdk protocol handler actually lives at `apps/extension/src/wallet/services/wallet-sdk/` (background.ts, content-script-validator.ts, queued-journal.ts, session-baton.ts, error-envelope.ts); that's what I mapped for that scope item.

## 1. Module inventory

**`src/wallet/services/*`** (29 service dirs, non-test LOC):

| Service | Purpose | LOC |
|---|---|---|
| `account/` | Per-(profile,chain) account rows, composite-key identity, contracts | 552 |
| `account-integrity/coordinator.ts` | Address-freeze runtime guard; blocks a profile when derived address diverges from stored | 328 (190 coordinator) |
| `account-state/` | Backup/restore of account-side PXE state (senders, contracts, artifacts) | 623 |
| `activity-protocol/coordinator.ts` | Durable activity-feed incarnation/counter/tombstone bookkeeping | 326 (256 coordinator) |
| `auth-registry/` | Authwit rows + per-account enable flags | 591 |
| `backup/` | Backup-import migration engine (registry, row-map DSL, migrator) — see README.md | 921 |
| `config/` | RPC-facing wrapper over `ConfigStore` | 139 |
| `constants/`, `crypto/` | Explorer URL table; key-vector test fixtures | small |
| `contact/` | Address-book rows | 397 |
| `dapp-interaction/` | Popup-approval orchestration (discovery/tx/capability prompts) via `WindowManager` | 831 |
| `dapp-session/` | Per-(origin,chainId) session rows, MAC-verified storage, capability grants | 883 |
| `execution/` | Tx build→simulate→prove→submit pipeline, fee strategies, estimate reuse/cancel | 8242 (by far the largest surface) |
| `fpc/` | Fee-paying-contract rows + handlers (default sponsored / private) | 725 |
| `incoming-transfer/` | Private+public incoming-note detection, polling schedulers, trust-state FSM | 2788 |
| `logger/`, `log-viewer/` | RPC facade over `LoggerStore`; ring-buffer read/clear | 62 / 69 |
| `network/` | Network/endpoint rows, active-network pointer, `AztecNode` connection cache | 1359 |
| `note/` | Decrypted-note listing/decoding | 391 |
| `operation-journal/` | Durable FSM journal for in-flight ops (`chrome.storage.local`), + `gc.ts`/`reaper.ts` | 1404 |
| `passkey/` | WebAuthn passkey ceremony via popup window | 406 |
| `price/` | CoinGecko price cache + alarm-driven refresh | 697 |
| `profile/` | Profile CRUD, `SessionManager` (unlock/lock/TTL), passkey-recovery, tombstones | 3248 (largest domain surface) |
| `profile-deletion/coordinator.ts` | Cross-service awaited purge, started last | 161 (134 coordinator) |
| `pxe/` | `PxeServiceClient` (offscreen bootstrap) + `shallow-port` | 166 |
| `task/` | In-memory ephemeral task/progress tracking | 457 |
| `token/` | Token rows, function descriptors, default-token seeding | 2108 |
| `token-balance/` | Balance rows + background job queue + projector | 1034 |
| `transaction/` | Local tx rows, dropped-tx detection/retry | 791 |
| `wallet-sdk/` | `@aztec/wallet-sdk` `BackgroundConnectionHandler` wiring — see §2 | 1241 |
| `window-manager/` | `chrome.windows`-backed await-a-popup-result primitive | 193 |

**Storage layer**: `src/wallet/storage/index.ts` — a one-line re-export barrel (`EntityStorage`, `ValueStorage` live in `@nulo/wallet-core/storage`; constructed per-service against a `StorageArea` port from `browserApi`).

**Migrations registry**: `src/wallet/storage/migrations/index.ts` — `BASELINE_VERSION=1`, `realMigrations: Migration[] = []` (empty — no shipped migrations yet), `migrations` (live-boot array, real + e2e fixture), `backupMigrations` (real + backup-declarative fixture), plus `SCHEMA_BLOCKED_KEY`/`SCHEMA_DEGRADED_KEY` status constants read by the boot path. `template.ts` documents the authoring contract (prefer `defineRowMapMigration` — backup-safe declarative DSL — over imperative `defineMigration`, which blocks backup import).

**Backup**: `src/wallet/services/backup/` — `backup-migration-registry.ts` (394 LOC, slice descriptors + normalize/denormalize), `row-map-migration.ts` (359 LOC, the `rename/drop/retype/remapValues/addDefault` DSL, WeakSet-branded + frozen), `backup-migrator.ts` (168 LOC, `migrateBackupData`: checksum → compat-epoch → schema-range → normalize → in-memory `Migrator` run → denormalize).

**Utils** (`src/wallet/utils/`): `auth-registry.ts`, `caip.ts` (CAIP chain/account parsing), `create-passkey-profile.ts`, `fee-juice.ts`, `fn.ts`, `offscreen.ts` (offscreen lifecycle — see §4), `onboarding-tab.ts`, `passkey-ceremony.ts`, `passkey-label.ts`, `serialization.ts`. Barrel `index.ts` re-exports `@nulo/wallet-core/utils` + `auth-registry`/`caip`/`fee-juice` only — `offscreen.ts` and other chrome-bound helpers are deliberately excluded from the barrel and must be imported by submodule path.

**Utils** (`src/utils/`, popup-adjacent but non-UI logic): `storage.ts` (migration-aware `chrome.storage.local` facade — see §3), `activity-rows.ts`, `amount.ts`, `card-subtitle.ts`, `chain-ids.ts`, `clipboard.ts`, `confirmation-policies.ts`, `console-sniffer.ts`, `contacts-export-format.ts`, `fee-estimation.ts`, `files.ts`, `full-backup-helpers.ts`, `guarded-network-activation.ts`, `incoming-dust.ts`, `in-flight-send.ts`, `journal-state.ts`, `lastActiveProfile.ts`, `primary-method.ts`, `received-display.ts`, `restore-error.ts`, `string.ts`, `transfer-intent.ts`, `tx-enrichment.ts`. Barrel `index.ts` re-exports only `files` + `string` — everything else is imported by explicit submodule path (grab-bag, no central re-export).

## 2. Entrypoints

- **Background service worker**: manifest declares `background.service_worker: "src/wallet/index.ts"` (`apps/extension/manifest/manifest.config.ts`). `src/wallet/index.ts` is a thin MV3 shell: registers `chrome.runtime.onInstalled`/`onMessage` synchronously at module scope (MV3 requirement — late listeners miss the historic event), wires console-hijack + `onunhandledrejection` into `LoggerStore`, constructs `ConfigStore`/`LoggerStore`/`RealChromeBrowserApi`/`SystemClock`, then calls `createWalletRuntime(deps).start()`.
- **Composition root**: `src/wallet/runtime.ts` — `createWalletRuntime()` runs the boot sequence: set uninstall URL → run `Migrator` against `browserApi.storage.local` (before `config.load()`) → on blocked/failed status persist `SCHEMA_BLOCKED_KEY`/`SCHEMA_DEGRADED_KEY` → parallel `config.load()` + `BarretenbergSync.initSingleton()` → construct + `services.add(...)` all 20+ services in `ServiceCollection` → `services.start()` (topological phases) → resume pending profile deletions → start `JournalReaper` + `JournalGC` → `initWalletSdkHandler(services, logger)` → first liveness write → `heartbeatHandle = clock.setInterval(...)` every `HEARTBEAT_INTERVAL_MS = 10_000`.
- **Offscreen entry**: manifest permission `offscreen`; document created by `src/wallet/utils/offscreen.ts`; entry file `src/offscreen/index.ts` — registers a `PING`/`PONG` health-check listener first (before any init), an F-10 Firefox-only `OFFSCREEN_ADOPT_INSTANCE` stale-window self-close listener, console/rejection hijack into `LoggerServiceClient`, then `await createPxeOffscreen({ profiles, logger, factory })` (from `@nulo/aztec-runtime/offscreen/entry`) and finally `chrome.runtime.sendMessage(OFFSCREEN_READY_MESSAGE)`.
- **Message-handler registrations**: `initWalletSdkHandler` in `src/wallet/services/wallet-sdk/background.ts` builds a `BackgroundConnectionHandler` (from `@aztec/wallet-sdk/extension/handlers`) whose `addContentListener` wraps `chrome.runtime.onMessage.addListener` with subframe rejection (`isSubframeSender`) + `validateContentScriptMessage`. Also registers `chrome.tabs.onRemoved` (terminate sessions for closed tab) and `chrome.tabs.onUpdated` (terminate sessions on cross-origin SPA-safe navigation). Individual RPC services register via `@nulo/extension-messaging`'s `Service`/`defineRpcMethods` (background/offscreen split, see §6).
- **Alarm/timer entrypoints**: `chrome.alarms.onAlarm` for `PRICE_REFRESH_ALARM_NAME` is registered **synchronously at module scope** in `src/wallet/index.ts` (documented MV3 requirement — a listener added inside `runtime.start()` would miss a wake-triggering alarm fire). Other alarm consumers: `SessionManager`'s `SESSION_TTL_ALARM_NAME` (proactive auto-lock), `JournalReaper`'s `JOURNAL_REAPER_ALARM_NAME` (1-min periodic sweep), `JournalGC`.

## 3. Coupling surfaces

- **Highest fan-out service files** (imports from other `@/wallet/services/*`): `execution/service.ts` (15: network, pxe, account, contact, profile, auth-registry, token, fpc, transaction, operation-journal, dapp-interaction, task…), `incoming-transfer/service.ts` (14), `token/service.ts` (13), `profile-deletion/coordinator.ts` (13 — imports every service it purges), `auth-registry/service.ts` (11), `token-balance/service.ts` (10).
- **Storage facade**: `src/utils/storage.ts` — the *only* sanctioned path for popup/onboarding/stores/composables to touch `chrome.storage.local` (migration-barrier-aware: `migrationIdle()` blocks until `SCHEMA_RUNNING_KEY` clears). Enforced by a static-scan test, `src/utils/storage-facade-ban.test.ts`, with an explicit allowlist (`utils/storage.ts`, `core/adapters/chrome-browser-api.ts`, `wallet/` SW context, `MigrationBarrier.vue`, `AccountIntegrityBarrier.vue`, `e2e/`) and denylist (service **clients**, which run in UI pages, and migrations, which must use the engine's staged `ctx`).
- **Utils grab-bags**: `src/utils/index.ts` re-exports only `files`+`string` (22 other files imported by path); `src/wallet/utils/index.ts` re-exports `@nulo/wallet-core/utils` + `auth-registry`/`caip`/`fee-juice` only (chrome-bound `offscreen.ts` deliberately excluded).
- **Cross-package `@nulo/*` imports**, tallied across `src/wallet` + `src/utils`: `@nulo/wallet-core` (228 — base/ports/storage/utils/logger/migration/jobs, used almost everywhere), `@nulo/extension-messaging` (76 — the messaging layer, §6), `@nulo/aztec-runtime` (53 — PXE/offscreen entry, node adapters), `@nulo/wallet-bridge` (37 — `WalletSdkDispatcher`, `DiscoveryQueue`, capability/session types), `@nulo/wallet-crypto` (26 — HKDF, session secret box, passkey types), `@nulo/bridge-core` (5, only in `execution/operation-estimate-reuse.ts`, `execution/fee/{fpc,fee}-strategy.ts`, `execution/transfer-estimate-reuse.ts`), `@nulo/wallet-sdk-schema-patch` (2, `wallet-sdk/background.ts` — must be first import, patches `WalletSchema` before wallet-sdk reads it).
- **Repeated cross-service helper imports** (see §9): `purge-rows.ts`, `restore-rows.ts`, `require-owned-row.ts`, `id-allocators.ts` are imported by most row-owning services (`account`, `token`, `network`, `dapp-session`, etc.) — a shared-ritual layer, not duplication.

## 4. State owners

This is the substantive finding of the map — every service below **owns mutable process state** with an explicit guard.

| Owner | State variable(s) | Guard |
|---|---|---|
| `profile/session-manager.ts` (`SessionManager`) | `activeSession?: ActiveSession` (holds the raw `Fr` master secret, never persisted), `sessionTtl`, `strictSecurityMode` | No internal lock — caller (`ProfileService`) runs under its own `lock`; alarm-driven close/refresh/applyTtlChange are all serialized via an injected `runExclusive` callback (= the facade lock) to prevent TTL-bypass races between a refresh writeback and an alarm-driven close |
| `profile/service.ts` (`ProfileService`) | `pendingRestoreSecrets: Map<string, MasterSecretBytes>` | `private readonly lock = new Lock()` |
| `profile/profile-deletion-state.ts` | `reserved: Set<string>`, `epochs: Map<string, number>` | Set/Map membership checks, no separate lock — epoch bump invalidates stale in-flight captures |
| `account/service.ts` | `tupleLocks: Map<string, Promise<unknown>>` | `restoreLock = new Lock()` + per-tuple promise chaining |
| `activity-protocol/coordinator.ts` | `scopeLocks: Map<string, Lock>`, `sourceLocks: Map<string, Lock>` | Per-key `wallet-core` `Lock` instances, lazily created |
| `auth-registry/service.ts`, `contact/service.ts`, `token/service.ts`, `dapp-interaction/service.ts`, `dapp-session/service.ts`, `transaction/service.ts` | row mutation sections | Each holds `private readonly lock = new Lock()` (the shared `@nulo/wallet-core` mutex — see below) |
| `fpc/service.ts` | `protocolAddresses: Map<number, ProtocolAddresses>` | `lock = new Lock("fpc", this.logger)` (named, logs wait/hold times) |
| `dapp-interaction/service.ts` | `storage: Map<string, DappInteraction>` (in-memory, ephemeral popup-approval state) | `lock = new Lock()` |
| `execution/execution-mutex.ts` (`ExecutionMutex`) | `tails: Map<string,Promise<void>>` (FIFO chain per `(profileId,chainId)` lane), `laneDepth`/`originDepth: Map<string,number>` (backpressure) | Bespoke — explicitly **not** `wallet-core`'s `Lock` because that force-releases after 5 min and a legitimate BB.wasm prove can exceed that; abortable via `AbortSignal` without breaking FIFO for queued successors |
| `execution/estimate-cancel-registry.ts` | `active/pending/settled: Map<string, …>` | in-flight estimate/cancel bookkeeping, keyed by op id |
| `execution/execution-lane.ts` | `activeControllers: Map<string, AbortController>`, `executionWaiters: Set<string>` | AbortController-per-key cancellation |
| `execution/gas-balance-reader.ts`, `execution/transfer-estimate-reuse.ts`, `execution/operation-estimate-reuse.ts` | `cache: Map<string, {...,fetchedAt}>` | TTL-style read caches, no lock (read-mostly) |
| `network/service.ts` | `nodes: Map<number, AztecNode>` (live connection cache), `transientNodes: Map<string,{node,failures}>`, `deletingNetworks: Set<string>` | No lock on the caches themselves; `deletingNetworks` is a delete-in-progress fence |
| `token-balance/service.ts` | `tokens: Map<number, Token>` (mirror cache), `invalidatedBalanceIds: Set<number>` (TOCTOU delete fence) | Fence checked synchronously before every write, per `balance-job-queue.ts` doc comment |
| `token-balance/balance-job-queue.ts` | `queue: Queue<number,TokenBalanceRaw>` (dedup by id), `pendingTasks: Map<number,string>`, `tickerHandle?: TickerHandle` | Two-layer dedup (queue priorityPass + pendingTasks map); `TICK_INTERVAL_MS=1000`, drains until empty per tick, batches of 12 |
| `incoming-transfer/service.ts` | `schedulers`/`publicSchedulers: Map<string, setInterval handle>`, `watchedContracts: Map<string,Set<string>>`, `polling`/`publicPolling: Set<string>`, `publicWatched: Map`, `classGateCache: Map`, `feeCache: Map<string,string>`, `syncState: Map<string,IncomingSyncSnapshot>` | Largest per-service state surface in the fleet; polling in-flight guarded by the `polling`/`publicPolling` sets |
| `transaction/service.ts` | `pending: Map<string,Tx>`, `droppedStreaks: Map<string,number>`, `droppedWatch: Map<string,Tx>`, `droppedNextCheckAt: Map<string,number>` | `lock = new Lock()` for row mutation; dropped-tx detection is a streak counter + backoff-scheduled recheck map |
| `profile-deletion/coordinator.ts` | `inflight: Map<string, Promise<void>>` | Single-flight per profile id (resume-vs-live-delete collision guard) |
| `window-manager/window-manager.ts` | `handles: Map<string, Handle<unknown>>` | Random `handleId` (collision-checked against the map), each handle carries its own `TimerHandle` + `unsubOnRemoved` |
| `task/service.ts` | `tasks: Map<string, Task>` | Ephemeral, no persistence, `TASK_RETENTION_PERIOD_MS = 3600000` |
| `wallet-sdk/background.ts` (`initWalletSdkHandler`) | `pendingVerification: Set<string>`, `pendingDiscoveryPromises: Map<string,Promise<void>>`, `sessionQueues: Map<string,Promise<void>>` (FIFO batons), `decryptQueues: Map<string,Promise<void>>` (monkey-patched `handleEncryptedMessage` serialization), `discoveryQueue: DiscoveryQueue` | All keyed by `(origin,chainId)` or `sessionId`; `DISCOVERY_PENDING_GLOBAL_CAP=32`, `DISCOVERY_PENDING_PER_ORIGIN_CAP=4` backpressure caps |
| `wallet-sdk/queued-journal.ts` | `queuedCreationLock` (module-level) | `export const queuedCreationLock = new Lock("wallet-sdk-bg:queued-creation")` — closes a burst-bypass race on the per-session/global queued-record caps (`MAX_QUEUED_PER_SESSION=8`, `MAX_QUEUED_GLOBAL=32`) |
| `wallet-sdk/session-baton.ts` | per-call `SessionBaton` (`baton: Promise<void>`, idempotent `releaseFifo`) | Not a singleton — factory used per message, stored transiently in `sessionQueues` |
| `pxe/client.ts` | module-level `storeKeyProvider`, `generationProvider` (both `let`, process-wide singletons) | Registered once at boot (`runtime.ts`) against `ProfileService`; re-checked for generation drift after the async HKDF derive (closes a deletion-during-derive resurrection window, #281 D4) |
| `wallet/utils/offscreen.ts` | `offscreenPromise`, `ensureInFlight` (single-flight gate for the whole ensure sequence), `passSeq` (monotonic create-pass fence), `firefoxOffscreenWindowId`, `_firefoxInstanceToken`, `_offscreenUrl` — all module-level `let` | `ensureOffscreenRunning()` self-gates via `ensureInFlight`; `passSeq` invalidates a zombie continuation from a timed-out pass so it can't tear down a newer pass's live document |
| `config/store.ts` (`ConfigStore`) | `config: Config` (in-memory mirror) | `lock = new Lock()` |
| `logger/store.ts` (`LoggerStore`) | `logs: CircularBufferIterable<Log>`, `nextId`, `flushTimer?` | Ring buffer sized 1000 (10,000 in debug mode) |
| `operation-journal/reaper.ts` (`JournalReaper`) | alarm-driven, no in-process map — reads/writes journal rows directly | Per-stage grace windows (`pending`≈instant, `simulating`10 min, `proving`35 min, `submitting`5 min); boot sweep is unconditional, periodic tick (1 min) respects grace windows |
| `operation-journal/gc.ts` (`JournalGC`) | terminal-record retention bound per (profile,account) | alarm-driven, disjoint from reaper |

**wallet-core `Lock` usage** (`packages/wallet-core/src/utils/lock.ts`): FIFO queue-based mutex with a **5-minute force-release safety net** (`MAX_HOLD_MS`) so a holder that forgets `leave()` doesn't deadlock the SW forever; `withLock(fn)` guarantees `leave()` fires on every exit path. Used directly (`new Lock()`) in: `account/service.ts` (×2: `restoreLock` + implicit), `auth-registry/service.ts`, `contact/service.ts`, `dapp-interaction/service.ts`, `dapp-session/service.ts`, `fpc/service.ts`, `network/service.ts` (imported via `@/wallet/utils`), `profile/service.ts`, `token/service.ts`, `transaction/service.ts`, `wallet-sdk/queued-journal.ts`, `activity-protocol/coordinator.ts` (per-key `Map<string, Lock>`), `config/store.ts`. `execution/execution-mutex.ts` explicitly rejects this primitive (documented in its header) because the 5-min force-release would let a second dApp tx start against PXE mid-proof.

## 5. Dependency graph (one level deep)

Sampled fan-out from imports of `@/wallet/services/*` inside each `service.ts`/`coordinator.ts`:

```
ProfileService        → PasskeyService                              (root of the DAG — nothing imports it back)
PasskeyService         → WindowManager (collaborator, not a Service)
NetworkService         → ProfileService, PxeServiceClient
AccountService          → ProfileService, NetworkService
DappSessionService      → ProfileService
TokenService            → ProfileService, NetworkService, AccountService, OperationJournalService, PxeServiceClient(shallow-port), TaskService, ExecutionService(contract-resolver)
DappInteractionService  → ProfileService, NetworkService, AccountService, DappSessionService, ExecutionService, OperationJournalService, TransactionService
ExecutionService        → NetworkService, PxeServiceClient, AccountService, ContactService, ProfileService, AuthRegistryService, TokenService, FpcService, TransactionService, OperationJournalService, TaskService
IncomingTransferService → ProfileService, NetworkService, AccountService, TokenService, TransactionService, OperationJournalService (declared dependencies list)
AccountIntegrityCoordinator → ProfileService, AccountService  (declared dependencies)
ProfileDeletionCoordinator  → ProfileService, AccountService, TokenService, NetworkService, TransactionService, AuthRegistryService, TokenBalanceService, IncomingTransferService, ContactService, DappSessionService, FpcService, OperationJournalService  (declared dependencies — started LAST)
```

**Cycles**: none observed in the sampled edges. `ProfileService` sits at the root (only downstream dependency is `PasskeyService`, which has none); everything else layers on top of `ProfileService`/`NetworkService`/`AccountService` in a strict DAG, consistent with `ServiceCollection.start()`'s topological-phase requirement (declared `dependencies` arrays throw `DependencyCycleError`/`UnknownDependencyError` up front — `packages/wallet-core/src/base/topology.ts`). `ProfileDeletionCoordinator` and `AccountIntegrityCoordinator` are terminal nodes (registered last in `runtime.ts`, depend on nearly everything, nothing depends on them).

## 6. Frameworks / primitives

- **Messaging layer**: `@nulo/extension-messaging` (`packages/extension-messaging/src`) — `background/{client,service}.ts` + `offscreen/{client,service}.ts` split, `core/rpc-methods.ts` (`defineRpcMethods`), `core/sender-auth.ts`, `core/decode.ts`, zod-validated params (`validateParams` from `@nulo/extension-messaging/zod`). Every service pairs a `service.ts` (RPC method implementations, extends `Service`) with a `client.ts` (the RPC-calling proxy used from popup/onboarding contexts) and a `spec.ts` (shared method/event/schema contract) — a consistent 3-file ritual (see §9).
- **`chrome.*` surface actually used** (tallied, non-test): `chrome.storage.local` (29), `chrome.storage.session` (28), `chrome.runtime.onMessage` (18), `chrome.runtime.getURL` (10), `chrome.tabs.create` (9), `chrome.runtime.sendMessage` (7), `chrome.alarms.*` (create/onAlarm/clear/get — session TTL, price refresh, journal reaper/gc), `chrome.windows.*` (create/remove/update/onRemoved — popup approvals), `chrome.offscreen.{createDocument,closeDocument}`, `chrome.action.openPopup`, `chrome.runtime.{onInstalled,onConnect,getContexts,setUninstallURL}`.
- **Port abstraction**: `src/core/adapters/chrome-browser-api.ts` — `RealChromeBrowserApi implements BrowserApi` (from `@nulo/wallet-core/ports`), wrapping `chrome.{storage,runtime,windows,alarms}` behind `StoragePort`/`RuntimePort`/`WindowPort`/`AlarmsPort`. Tests substitute `FakeBrowserApi` (`src/core/testing/`). This is the seam that lets `runtime.ts` be constructed and driven in tests without a real Chrome environment.
- **PXE/aztec surfaces**: `PxeServiceClient` (`src/wallet/services/pxe/client.ts`) subclasses `PxeServiceClientBase` from `@nulo/aztec-runtime/pxe`, adding `onReady()` → `ensureOffscreenRunning()`. Offscreen bootstraps via `createPxeOffscreen()` from `@nulo/aztec-runtime/offscreen/entry` with a `ProductionPxeFactory` (proverless/required/default proving modes gated by `E2E_PROVERLESS`/`ACCELERATOR_REQUIRED` build flags). `BarretenbergSync.initSingleton()` (from `@aztec/bb.js`) runs in `runtime.ts` parallel to `config.load()`. Wallet-sdk protocol: `@aztec/wallet-sdk/extension/handlers` (`BackgroundConnectionHandler`), dispatched via `@nulo/wallet-bridge`'s `WalletSdkDispatcher`/`DiscoveryQueue`.
- **Manifest/build entrypoints**: `apps/extension/manifest/manifest.config.ts` — `background.service_worker: "src/wallet/index.ts"` (type module), `content_scripts` → `src/content-script/content.ts` (`run_at: document_start`, `all_frames: true`), permissions `["alarms","offscreen","storage","sidePanel","unlimitedStorage","downloads"]`. `vite.config.ts` build `rollupOptions.input` = `{offscreen, popup, setup, onboarding}` HTML entries (background/content-script entries are handled by the `@crxjs/vite-plugin` `crx({manifest})` plugin in `vite.chrome.config.mts`/`vite.firefox.config.mts`, not listed as raw rollup inputs).

## 7. Test surfaces

- Colocated `*.test.ts` under `src/wallet`: 128 files vs 181 non-test `.ts` files.
- **Composition tests** (`*.composition.test.ts`, using the shared `services/composition-harness.ts`'s `svc()` stub-builder): `dapp-session/service.composition.test.ts`, `execution/service.composition.test.ts`, `token/service.composition.test.ts`. (`apps/extension/tests/COMPOSITION-TESTS.md` documents the pattern — file not read here, out of scope as a doc.)
- **Services with zero colocated test files**: `fpc/` (725 LOC, 0 tests), `logger/` (62 LOC, 0 tests), `log-viewer/` (69 LOC, 0 tests).
- **Thin test coverage relative to size**: `network/` (1359 LOC, 1 test file), `contact/` (397 LOC, 1 test), `passkey/` (406 LOC, 1 test), `window-manager/` (193 LOC, 1 test), `profile-deletion/` (161 LOC, 1 test).
- **Heaviest test investment**: `execution/` (36 test files against 8242 LOC — includes `service.characterization.test.ts`, `service.composition.test.ts`, `service.pxe-seam.test.ts`, plus per-strategy/helper unit tests), `profile/` (9 test files), `incoming-transfer/` (5), `dapp-session/` (5).
- `src/utils/`: 21 test files vs 26 non-test files — near 1:1, notably `storage-facade-ban.test.ts` (a repo-wide static scan, not a unit test of a single module).

## 8. Generated / vendored / fixture code (exclude from analysis)

- `apps/extension/src/types/auto-imports.d.ts` (552 lines, `unplugin-auto-import` output, `@ts-nocheck`).
- `apps/extension/src/types/components.d.ts` (88 lines, `unplugin-vue-components` output, `@ts-nocheck`).
- `apps/extension/src/types/.eslintrc-auto-import.json`, `vite-env.d.ts`, `console.d.ts` — build-tool scaffolding, not hand-authored logic.
- `apps/extension/src/wallet/services/token/functions/__snapshots__/token-functions.characterization.test.ts.snap` — vitest snapshot fixture.
- `apps/extension/src/e2e/*` (`migration-fixture.ts`, `backup-migration-fixture.ts`, `chrome-storage-proof-gate.ts`, `chrome-storage-incoming-poll-gate.ts`, `config.ts`) — build-stamp-gated e2e instrumentation. Technically imported by production code paths (`runtime.ts`, `storage/migrations/index.ts`) but tree-shaken out of prod bundles via static-false constants (`E2E_PROVERLESS`, `E2E_MIGRATION_FIXTURE`), enforced by a negative-grep CI check (`_build-extension.yml`). Not itself part of the requested scope but worth flagging as adjacent.
- `apps/extension/tsconfig.tsbuildinfo` — TS incremental build cache, not source.
- `tests/e2e/**` — explicitly excluded per the task scope (not walked).

## 9. Apparent duplication (near-copy service patterns)

- **Per-service 3-file ritual**: every `EntityStorage`-backed service repeats `service.ts` (implementation) + `client.ts` (RPC proxy) + `spec.ts` (Methods/Events/Zod schema/`SERVICE_NAME` constant/`STORAGE_ROOT` constant). This is consistent enough to be a convention rather than copy-paste drift, but it's the dominant repeated shape across all 29 service dirs.
- **Extracted anti-duplication helpers** (a tell that the duplication *was* real and got centralized): `services/purge-rows.ts` (`purgeRows` — centralizes the delete-then-emit loop every lifecycle-purge listener hand-rolled), `services/restore-rows.ts` (`restoreRows` — centralizes the try/write/catch→`Restored<T>` loop every service's `restore()` hand-rolled), `services/id-allocators.ts` (`nextNumericId`/`nextRandomId` — the two id-allocation strategies every entity store hand-rolled), `services/require-owned-row.ts` (ownership-check-before-mutate ritual). All four are explicitly documented (in their own header comments) as extractions from repeated hand-rolled code across `account`, `token`, `network`, `contact`, `fpc`, `dapp-session`, etc.
- **Lock-per-service ritual**: 11+ services independently instantiate `private readonly lock = new Lock()` for row-mutation serialization — a consistent but repeated pattern (not extracted into a shared base class).
- **Alarm-consumer ritual**: `SessionManager`, `PriceService`, `JournalReaper`, `JournalGC` each independently implement create/clear/onAlarm wiring against `AlarmsPort` with their own named alarm constant (`SESSION_TTL_ALARM_NAME`, `PRICE_REFRESH_ALARM_NAME`, `JOURNAL_REAPER_ALARM_NAME`) — no shared "alarm-backed periodic task" base, each hand-rolls its own scheduling/cancellation/error-swallow logic.
- **Cache-with-fetchedAt ritual**: `execution/gas-balance-reader.ts`, `execution/transfer-estimate-reuse.ts`, `execution/operation-estimate-reuse.ts` each hand-roll a `Map<string, {result, fetchedAt}>` TTL cache independently rather than sharing one cache primitive.

## 10. Error-path hotspots

Ranked by `catch` occurrence count (non-test `.ts` under each service dir):

1. **`execution/`** — 69 `catch` sites across 8242 LOC. Home of `ExecutionMutexAbortError`/`ExecutionMutexCapacityError` (custom error classes for abort/backpressure), `fee-strategy-clamp` tests, `mark-failed-unless-cancelled.ts`, `rpc-cancel.ts`. The single largest concentration of retry/cancel/timeout logic in the non-UI codebase.
2. **`incoming-transfer/`** — 47 `catch` sites; also the only service dir (besides execution) that shows up in the retry/reconnect/disconnect grep (`public-event-indexer.ts`, `service.ts`). Polling schedulers (`schedulers`/`publicSchedulers` maps) imply persistent retry loops per contract-watch.
3. **`profile/`** — 40 `catch` sites, concentrated in `session-manager.ts` (every public method wraps its body in try/catch, logs-and-swallows by design — documented as intentional: "a broken chrome.storage write at unlock time still leaves the in-memory secret usable") and `service.ts`/`client.ts` (also flagged by the retry/reconnect grep).
4. **`wallet-sdk/`** — 20 `catch` sites; `background.ts` wraps `handleDiscovery` and `handleWalletMessage` bodies in top-level try/catch that map to structured EIP-1193-aligned error envelopes (`error-envelope.ts`), plus a queued-journal failure-recovery path (unclaimed `queued` record → `transitionOperation({stage:"failed"})`).
5. **`operation-journal/`** — 14 `catch` sites; the dedicated **integrity/recovery flow** for the whole extension: `reaper.ts` (stuck-stage detection with per-stage grace windows, boot sweep + 1-min alarm tick) and `gc.ts` (terminal-record retention).
6. **`offscreen/is-benign-sw-disconnect.ts`** — not catch-heavy by count, but purpose-built **disconnect classification**: filters the "Client disconnected" cascade that fires ~14× per SW boot when background-port RPCs reject en masse, demoting it from Error to Debug so real errors aren't buried.
7. **`network/`** — 10 `catch` sites; `transientNodes: Map<string,{node,failures}>` tracks per-node failure counts (retry/backoff bookkeeping for `AztecNode` connections), also flagged by the retry grep.
8. **`wallet/utils/offscreen.ts`** — the offscreen lifecycle manager is the extension's other major **reconnect/recovery** surface: zombie-document detection (`isOffscreenHealthy` ping/pong with `HEALTH_CHECK_TIMEOUT_MS`), close-and-retry on two transient Chrome error shapes ("single offscreen document", "closed before fully loading"), a monotonic `passSeq` fence to prevent a timed-out pass's zombie continuation from tearing down a newer pass's live document, and a `Promise.race([creating, ready])` guard so a hung `createDocument` can't wedge every future caller.