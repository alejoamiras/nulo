# Repo map: packages/wallet-core

Pure, `chrome.*`-free foundation package; every other `@nulo/*` package depends on it. ~5940 non-test LOC across 9 subpath exports.

## 1. Module inventory

| Subpath | Path | Purpose | LOC |
|---|---|---|---|
| root | `src/index.ts` | Empty barrel. | 15 |
| `ports` | `src/ports/` | I/O boundary interfaces (`BrowserApi`, `StoragePort`, `RuntimePort`, `WindowPort`, `AlarmsPort`, `ClockPort`, `BackgroundTickerPort`) standing in for `chrome.*`. | ~311 |
| `storage` | `src/storage/` | `EntityStorage<T>` (rows keyed `${root}@${id}`) + `ValueStorage<T>` over a `MinimalStorageArea`; `MemoryStorageArea`; `prefixedEntries`. | ~354 |
| `migration` | `src/migration/` | Storage-migration engine: `Migration`/`defineMigration`, `StagingArea` (read-your-writes buffer), `Migrator` (crash-safe journal, fail-closed retry). | ~654 |
| `base` | `src/base/` | `ServiceCollection` (phase-ordered startup) + `topologicalPhases` + `ServiceSpec`/`IService`. | ~199 |
| `utils` | `src/utils/` | `Lock`, `ReadWriteGuard`, `KeyedLock`; `EventHandler`; `AlarmDispatcher`; encoding/serialization/error-json/errors; `random.ts` (CSPRNG hex); `mnemonic.ts` (BIP-39, ~2050 lines wordlist, ~130 logic). | ~3039 |
| `logger` | `src/logger/interfaces.ts` | `ILogger`/`ILoggerStore`, `LogLevel`, `Log`. | ~50 |
| `jobs` | `src/jobs/` | `JobStage` FSM (`fsm.ts`), `JobError`/`normalizeError` hostile-throw-safe envelope (`error.ts`), types. | ~349 |
| `activity` | `src/activity/` | Causal-ordering reducer for the activity feed: `ActivityScope`, `SourceState`/`ActivityMutation`/`ActivitySnapshot`, `applyMutation`/`applySnapshot`/`resetScope` (pure). | ~467 |
| `testing` | `src/testing/` | `FakeBrowserApi` (wraps `@webext-core/fake-browser`), `MockClock`, `FakeBackgroundTicker`, `createListenerBag`. Test-only. | ~502 |

## 2. Entrypoints (public exports)

Library; no listeners/RPC/jobs of its own. `package.json` exports (`:6-16`):

- `./ports`: `Unsubscribe` (`ports/types.ts:6`), `ClockPort`/`TimerHandle` (`clock-port.ts:10,8`), `StoragePort`/`StorageArea`/`StorageEntries`/`StorageChanges` (`storage-port.ts:41,18,13,16`), `RuntimePort`/`MessagePortLike`/`MessageSender`/`MessageListener` (`runtime-port.ts:31,13,22,29`), `WindowPort`… (`window-port.ts:39,8,12,31,24`), `AlarmsPort`… (`alarms-port.ts:27,12,21`), `BrowserApi` (`browser-api.ts:13`), `BackgroundTickerPort`/`TickerHandle` (`background-ticker-port.ts:32,37`).
- `./storage`: `EntityStorage`/`MinimalStorageArea` (`entity_storage.ts:20,14`), `MemoryStorageArea` (`memory-storage-area.ts:7`), `prefixedEntries` (`prefixed-entries.ts:3`), `ValueStorage` (`value-storage.ts:3`).
- `./migration`: `Migration` (`types.ts:53`), `MigrationArea` (`:31`), `MigrationContext` (`:48`), `MigrationFailure` (`:78`), `MigrationResult` (`:91`), `StorageRef` (`:18`), `defineMigration` (`types.ts:72`), `Migrator` (`migrator.ts:107`), `RESERVED_KEYS` (`:58`), `SCHEMA_ATTEMPTS_KEY` (`:48`), `SCHEMA_RESERVED_PREFIX` (`:52`), `SCHEMA_RUNNING_KEY` (`:43`), `SCHEMA_VERSION_KEY` (`:42`), `MigratorOptions` (`:97`).
- `./base`: `EventsMap`/`EventsSpec`/`MethodsMap`/`MethodsSpec`/`ServiceSpec`/`Restored` (`base/index.ts:5,7,12,14,18,20`), `IService` (`:22`), `DependencyCycleError`/`UnknownDependencyError`/`topologicalPhases`/`ServiceNode` (`topology.ts:21,32,54,15`), `ServiceCollection` (`base/index.ts:37`; `.start()` `:66`).
- `./logger`: `LogLevel` (`:12`), `LogContext` (`:19`), `Log` (`:21`), `ILogger` (`:30`), `ILoggerStore` (`:34`), `consoleMethods` (`:42`).
- `./jobs`: `KNOWN_JOB_ERROR_KINDS`, `NORMALIZED_RAW_MAX_CHARS`, `TERMINAL_STAGES`, `isTerminal`, `JobError`, `JobErrorKind`, `JobProgress`, `JobStage`, `KnownJobErrorKind` (`jobs/types.ts`); `IllegalTransitionError` (`fsm.ts:59`), `JobCancelledSentinel` (`:98`), `assertCanTransition` (`:77`), `canTransition` (`:54`); `normalizeError` (`error.ts:39`).
- `./activity`: `ActivityScope` (`scope.ts:11`), `ActivityScopeKey` (`:23`), `InvalidActivityScopeError` (`:26`), `activityScopeKey` (`:45`), `scopesEqual` (`:57`); model types (`model.ts:13-109`); `compareCounter`/`compareIncarnation`/`sameIncarnation`/`emptySourceState`/`applyMutation`/`applySnapshot`/`resetScope`/`liveRecords` (`causal.ts:26,33,38,42,112,182,268,277`).
- `./testing`: `MockClock` (`mock-clock.ts:25`), `FakeBrowserApi` (`fake-browser-api.ts:279`), `FakeBackgroundTicker` (`:18`), `createListenerBag` (`listener-bag.ts:12`).
- `./utils`: `AlarmDispatcher` (`alarm-dispatcher.ts:21`); `array_equals`/`array_max`/`hasIntersectionByKeys` (`arrays.ts:1,13,41`); `Deferred`/`deferred`; `bytesToHex`/`toBase64`/`fromBase64` (`encoding.ts:10,21,34`); `errorMessageFromUnknown`/`getErrorData`/`getErrorMessage` (`errors.ts:8,16,29`); `EventHandler` (`event-handler.ts:16`); `KeyedLock` (`keyed-lock.ts:33`); `Lock`/`LockTicket` (`lock.ts:17,15`); `getMnemonic`/`canonicalizeMnemonic`/`getEntropy` (`mnemonic.ts:2067,2109,2115`); `Queue`; `getRandomHex` (`random.ts:9`); `MAX_READER_DRAIN_MS`/`ReadWriteGuard` (`rw-guard.ts:17,46`); `jsonStringify`/`jsonSanitize` (`serialization.ts:26,56`); `sleep`. `baseErrorJson` (`error-json.ts:18`) NOT re-exported.

## 3. Trust boundaries

No I/O, no external calls, **no sender/origin/permission checks** — `MessageSender`/`MessagePortLike` (`runtime-port.ts:13,22`) are pass-through types. Every origin/permission check lives one layer up.

Where untrusted data enters wallet-core logic:
- **Persisted storage rows** treated as untrusted: `EntityStorage.decodeRow` (`entity_storage.ts:97-144`) wraps `JSON.parse` in try/catch, keeps-but-hides on failure (`:126-129`, `:140-142`); `requireIdMatch` (`:154-173`) forgery check — row whose embedded `id` disagrees with its key suffix is hidden (comment `:151-152`: stops "an attacker transplant[ing] another profile's ENTIRE record"); `ValueStorage.get` (`value-storage.ts:28-35`) THROWS on malformed; `StagingArea` (`migration/staging.ts:14-21`) THROWS on malformed (fail-closed, `types.ts:26-30`); `Migrator.isValidBackup`/`isValidRef` (`migrator.ts:74-95`) validate the journal backup before trusting it for `restore()` (`:24-26`).
- **Imported full-backup content** — the backup-import migrator (`apps/extension/src/wallet/services/backup/`) runs the REAL `Migrator` over attacker-controlled rows (`row-map-migration.ts:17-19`). `Migrator`/`StagingArea` are on that boundary without knowing it.
- **User-typed mnemonic** — `getEntropy` (`mnemonic.ts:2115-2182`) validates words (`:2130`) and checksum (`:2169`), zeroes buffers on exit (`:2179-2180`); `canonicalizeMnemonic` (`:2109-2113`) NFKD/lowercase/collapse.
- **`getRandomHex`** (`random.ts:9-15`) — `globalThis.crypto.getRandomValues`; used by `apps/extension/src/wallet/services/id-allocators.ts` and `packages/extension-messaging/src/offscreen/client.ts`.

Secrets: none owned; opaque encrypted blobs pass through `EntityStorage` (comment `entity_storage.ts:102-104`); only shape/length logged (`describeKey`, `:75-78`).

Storage writes: `EntityStorage.set`/`delete` (`entity_storage.ts:188-194`), `ValueStorage.set`/`delete` (`value-storage.ts:37-43`), `StagingArea` buffered writes committed by `Migrator.applyOne` (`migrator.ts:240-241`). No direct `chrome.storage.*`.

## 4. Dependency graph

Internal: `base/index.ts` → `utils/event-handler`, `utils/errors`, `base/topology`; `utils/keyed-lock.ts` → `logger/interfaces`, `utils/lock`; `utils/rw-guard.ts` → `logger`, `utils/deferred`; `utils/alarm-dispatcher.ts` → `ports`; `utils/random.ts` → `utils/encoding`; `utils/serialization.ts` → `utils/error-json`; `migration/staging.ts` → `migration/types`, `utils/errors`; `migration/migrator.ts` → `types`, `staging`, `utils/errors`; `storage/value-storage.ts` → `entity_storage` (type); `storage/entity_storage.ts` → `prefixed-entries`; `jobs/error.ts` → `utils/error-json`, `utils/errors`, `jobs/types`; `activity/causal.ts` → `activity/model`; `ports/browser-api.ts` → the four port files.

Consumers: `packages/wallet-crypto` (8 files, `utils`), `packages/extension-messaging` (`base`, `ports`, `utils`, `jobs`), `packages/aztec-runtime` (12 files: `ports`, `utils`, `storage`), `packages/wallet-bridge` (`dispatcher.ts`, `discovery-queue.ts`), `apps/extension/src/**` (~180+ files).

Handoff edges:
- **Port → real adapter**: `BrowserApi` (`ports/browser-api.ts:13`) implemented by `apps/extension/src/core/adapters/chrome-browser-api.ts` (`ChromeStorageAreaAdapter` etc.) and `FakeBrowserApi` for tests.
- **Migration engine → registry → boot gate**: `Migrator` (`migrator.ts:107`) instantiated at `apps/extension/src/wallet/runtime.ts:338`, fed `realMigrations` from `apps/extension/src/wallet/storage/migrations/index.ts:24` (**empty array**) plus the e2e fixture spread. Runs as the FIRST storage action (`ARCHITECTURE.md:116`).
- **`defineMigration` → `defineRowMapMigration`**: the backup-safe DSL (`apps/extension/src/wallet/services/backup/row-map-migration.ts:22`) compiles down to a plain `Migration`.
- **Service registration → `ServiceCollection.start()`** (`base/index.ts:40,66`) in `apps/extension/src/wallet/index.ts`; `topologicalPhases` (`topology.ts:54`).
- **`EventHandler` emit → subscriber**: every service exposes `EventHandler<T>` events.
- **`activity/causal.ts` reducer → `activity-protocol/coordinator.ts`** (extension).

## 5. Frameworks / libs

Zero runtime dependencies. Dev: `@webext-core/fake-browser ^1.5.2`, `fast-check ^4.9.0`, `jsdom`, `typescript`, `vitest`, `@types/node`. Crypto-adjacent: `crypto.subtle.digest` SHA-256 (`mnemonic.ts:2072,2164`), `crypto.getRandomValues` (`random.ts:13`). No zod (`entity_storage.ts:38`, `value-storage.ts:20-21`).

## 6. Test surfaces

4101 test LOC. Well covered: `migrator.test.ts` (840), `rw-guard` (579), `lock` (556), `entity_storage.test.ts` (361), `causal.property.test.ts` (403, fast-check), `base`/`topology` pins. Thin/absent: `utils/arrays.ts`, `deferred.ts`, `queue.ts`, **`serialization.ts` (`jsonStringify`/`jsonSanitize`, on the wire path for Error/Buffer/Map/Set/bigint — zero direct tests)**, `sleep.ts`, `activity/scope.ts`, `activity/model.ts`; `value-storage.test.ts` only 114 lines; `memory-storage-area.ts`, `prefixed-entries.ts` no dedicated tests.

## 7. Generated / vendored / fixture / test-only

- `src/testing/**` — test-only; zero production import sites of `@nulo/wallet-core/testing`.
- `mnemonic.ts` `bip39Words` (lines 1-2050) — embedded wordlist, production-wired.
- e2e migration fixture at `apps/extension/src/e2e/migration-fixture.ts:22` (gated `VITE_NULO_E2E_MIGRATION_FIXTURE=1`, tree-shaken + grep-guarded).
- `realMigrations` is empty (`apps/extension/src/wallet/storage/migrations/index.ts:24`).

## 8. Security-relevant invariants (quoted)

- README `:44`: "No `chrome.*` imports. Enforced via biome `noRestrictedGlobals`." — `biome.json:240-298` (`deniedGlobals.chrome` `:291-296`; `noRestrictedImports` bans higher layers `:249-289`). Verified: only comments mention `chrome.`.
- README `:45`: "No I/O. No `fetch`, no DB access, no clock."
- README `:46`: "`EntityStorage` row keys are `${root}@${id}` — not `:${id}`. Migration scripts and prefix wipes depend on this exact encoding." — `entity_storage.ts:176,182,189,193`, `prefixed-entries.ts:3-9`.
- `entity_storage.ts:82-95` (B-23): "Both failure modes KEEP the row … the read path NEVER deletes by id … the storage API has no atomic compare-and-delete."
- `entity_storage.ts:146-153`: "Serving such a row under the requested id would let an attacker transplant another profile's ENTIRE record" → `requireKeyIdentityMatch`/`keyIdentityMode` (`:154-173`) — **opt-in per storage root; which roots enable it is an `apps/extension` codec question.**
- `migrator.ts:285-298` (`guardCommit`): "an undeclared write is not in the backup and therefore cannot be restored — reject it fail-closed. The engine's own namespace is never writable from a migration." `:49-52` `SCHEMA_RESERVED_PREFIX`.
- `migrator.ts:24-26`: "PRESENT-but-invalid backup ⇒ tampering/corruption … fail closed to `needs-recovery`" — `:317-321`, `:336-342`, `:326-335`.
- `types.ts:70-74`: `breaking` defaults to `true`.
- `staging.ts:4-8`: malformed rows throw (fail-closed).
- `lock.ts:8-15`: `LockTicket` "Runtime-unforgeable (per-grant symbol identity) AND type-branded". README `:47`: long holds need `maxHoldMs: null`.
- `rw-guard.ts:4-8`: force-release "a DEBUGGABILITY backstop … NOT a mechanism for a writer to force past live work."
- `jobs/error.ts:6-13`: hostile `toJSON()`, Proxy traps, quota bombs → capped try/catch serialization (`:39-63`).
- README `:48`: phase 0 = no-deps first; cycles/unknown deps throw at startup (`topology.ts:21-52`).
- README `:49`: `ServiceSpec` is the universal contract.
- `activity/model.ts:44-46`: "A consumer MUST also verify the envelope agrees with the embedded record's own scope fields" — punted to `activity-protocol/coordinator.ts`.
- `activity/causal.ts:172-181`: **KNOWN GAP** — "a COLD slice accepts whichever snapshot arrives first … A delayed snapshot from a retired incarnation therefore establishes that retired one … Close this when the coordinator is wired into production."
