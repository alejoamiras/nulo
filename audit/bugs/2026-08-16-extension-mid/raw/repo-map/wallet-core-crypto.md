# Module Map: `packages/wallet-core` and `packages/wallet-crypto`

Repo root `~/Projects/nulo`, Bun workspaces monorepo. Both packages ship no build step — `package.json` `exports` point straight at `./src/*.ts`, consumed source-to-source. Stack position (from each package's README, confirmed by grep — see §5): `wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`.

---

## PACKAGE 1: `packages/wallet-core` (`@nulo/wallet-core`)

### 1. Module inventory

| Path | Purpose | LOC (src, excl. tests) |
|---|---|---|
| `src/index.ts` | Intentionally-empty barrel; doc comment pointing consumers at subpath exports | 15 |
| `src/activity/causal.ts` | Pure causal reducer: decides whether an arriving mutation/snapshot changes per-`(source,scope)` state (`applyMutation`, `applySnapshot`, `resetScope`, `liveRecords`) | 267 |
| `src/activity/model.ts` | Type vocabulary for the causal protocol (`ActivityMutation`, `ActivitySnapshot`, `SourceState`, `ApplyDecision`, …) | 126 |
| `src/activity/scope.ts` | `ActivityScope` (profileId/networkId/chainId/accountAddress tuple) + `activityScopeKey()` canonical-key encoder | 59 |
| `src/activity/index.ts` | Barrel (`export *` of the 3 above) | 3 |
| `src/base/index.ts` | `ServiceCollection` (service registry + phased startup), `ServiceSpec`/`MethodsSpec`/`EventsSpec` typed-contract helpers, `IService` | 71 |
| `src/base/topology.ts` | Pure Kahn's-algorithm phase scheduler for service startup order; `DependencyCycleError`, `UnknownDependencyError` | 105 |
| `src/jobs/types.ts` | Durable-job vocabulary: `JobStage`, `JobProgress`, `JobError`, `KnownJobErrorKind` + a runtime drift-guard table | 154 |
| `src/jobs/fsm.ts` | Job-stage legal-transition table (`canTransition`, `assertCanTransition`), `IllegalTransitionError`, `JobCancelledSentinel` | 106 |
| `src/jobs/error.ts` | `normalizeError()` — hostile-input-safe error → `JobError` envelope builder | 72 |
| `src/jobs/index.ts` | Barrel | 15 |
| `src/logger/interfaces.ts` | `ILogger`/`ILoggerStore` interfaces, `LogLevel` enum, `Log` type, `consoleMethods` table | 49 |
| `src/logger/index.ts` | Barrel (`export *`) | 1 |
| `src/migration/migrator.ts` | `Migrator` — crash-safe, journaled, fail-closed storage-migration engine | 388 |
| `src/migration/staging.ts` | `StagingArea` — batches one migration's reads/writes with read-your-writes semantics | 70 |
| `src/migration/types.ts` | `Migration`, `MigrationArea`, `MigrationContext`, `MigrationResult`, `StorageRef`, `defineMigration()` | 100 |
| `src/migration/index.ts` | Barrel | 24 |
| `src/ports/*.ts` (8 files) | Pure interfaces naming I/O boundaries: `ClockPort`, `StoragePort`/`StorageArea`, `RuntimePort`, `WindowPort`, `AlarmsPort`, `BrowserApi` (composite), `BackgroundTickerPort`, `Unsubscribe` | ~285 total |
| `src/storage/entity_storage.ts` | `EntityStorage<T>` — indexed-entity KV wrapper over `MinimalStorageArea`, keys `${root}@${id}`; dual JSON-syntax-vs-codec-validation failure handling | 163 |
| `src/storage/value-storage.ts` | `ValueStorage<T>` — single-record KV wrapper, fail-closed (throws, never drops) on malformed value | 44 |
| `src/storage/memory-storage-area.ts` | `MemoryStorageArea` — in-memory `MinimalStorageArea` impl, used as migration scratch store and test fixture base | 31 |
| `src/storage/index.ts` | Barrel | 3 |
| `src/testing/fake-browser-api.ts` | `FakeBrowserApi` — full in-memory `BrowserApi`, wraps `@webext-core/fake-browser` + hand-rolled port/window/alarm fakes | 296 |
| `src/testing/mock-clock.ts` | `MockClock` — virtual-time `ClockPort` impl with `advance()`/`setNow()` | 96 |
| `src/testing/fake-background-ticker.ts` | `FakeBackgroundTicker` — manually-driven `BackgroundTickerPort` test double preserving prod's serialize/coalesce contract | 66 |
| `src/testing/index.ts` | Barrel | 12 |
| `src/utils/mnemonic.ts` | BIP39: 2048-word English wordlist (hardcoded array) + `getMnemonic`/`getEntropy` | 2160 (≈2048 is wordlist data) |
| `src/utils/lock.ts` | `Lock` — single-flight FIFO mutex with `MAX_HOLD_MS` force-release safety net | 109 |
| `src/utils/rw-guard.ts` | `ReadWriteGuard` — multi-reader/exclusive-writer guard, FIFO writer priority, per-token force-release | 203 |
| `src/utils/queue.ts` | `Queue<TKey,TValue>` — dedup-by-key FIFO with `priorityPass()` (move-to-front) | 50 |
| `src/utils/event-handler.ts` | `EventHandler<T>` — the pub/sub primitive services emit through | 29 |
| `src/utils/errors.ts` | `errorMessageFromUnknown`, `getErrorMessage`, `getErrorData` — hostile-input message extraction | 29 |
| `src/utils/error-json.ts` | `baseErrorJson()` — projects `name`/`message`/`stack` off an `Error` (non-enumerable fields `JSON.stringify` drops) | 24 |
| `src/utils/serialization.ts` | `jsonStringify`/`jsonSanitize` — Buffer/Map/Set/bigint/Error-aware JSON codec, ported from `@aztec/foundation/json-rpc` | 57 |
| `src/utils/encoding.ts` | `bytesToHex`, `toBase64`, `fromBase64` — Buffer-free byte/string codecs | 39 |
| `src/utils/arrays.ts` | `array_equals`, `array_max`, `hasIntersectionByKeys` | 53 |
| `src/utils/random.ts` | `getRandomHex()` via `crypto.getRandomValues` | 12 |
| `src/utils/sleep.ts` | `sleep(ms)` | 1 |
| `src/utils/index.ts` | Barrel (`export *`) | 11 |

### 2. Entrypoints / public exports

`package.json` `exports` map — 9 subpaths, no top-level export other than the doc-only empty barrel:
- `.` → `src/index.ts` (empty, doc-only)
- `./ports`, `./utils`, `./storage`, `./migration`, `./base`, `./logger` (→ `logger/interfaces.ts` directly, not `logger/index.ts`), `./jobs`, `./activity`, `./testing`

Intended consumers (confirmed via repo-wide grep): almost exclusively `apps/extension/src/**` (services, composables, stores, adapters — dozens of files) plus every downstream `@nulo` package (`aztec-runtime`, `extension-messaging`, `wallet-bridge`, `bridge-core`, `wallet-crypto`) that needs ports/utils/storage primitives. `wallet-core` itself imports **zero** other `@nulo/*` packages — confirmed by `grep '@nulo' packages/wallet-core/src` returning nothing outside test files. This is the acknowledged "foundation" package; biome's `noRestrictedImports` rule (`biome.json` lines ~172-198) hard-blocks `wallet-core/src/**` from importing `@nulo/wallet-crypto`, `@nulo/extension-messaging`, `@nulo/aztec-runtime`, `@nulo/wallet-bridge`, `@nulo/extension`, and `chrome-types`, and `noRestrictedGlobals` blocks the bare `chrome` global — this is lint-enforced, not just documented convention.

### 3. Coupling surfaces

This package is deliberately shallow — no non-test module has more than 4 `import` statements (`ports/browser-api.ts` and `jobs/error.ts` are the highest, each importing from 4 sibling files). There is no "god module." The closest things to grab-bags:
- `src/utils/index.ts` re-exports 10 unrelated modules (arrays, encoding, errors, event-handler, lock, mnemonic, queue, random, rw-guard, serialization, sleep) under one subpath — a classic utility barrel, but each underlying module stays single-purpose.
- `src/ports/browser-api.ts` is the one real aggregation point: it composes `AlarmsPort + RuntimePort + StoragePort + WindowPort` into `BrowserApi`, and `src/testing/fake-browser-api.ts` (296 LOC, the largest test-support file) mirrors that same aggregation for the fake.

No cross-package imports inside `wallet-core/src` (verified: 0 matches for `@nulo/` outside `.test.ts`/README).

### 4. State owners

| Module | State variable(s) | Guard |
|---|---|---|
| `utils/lock.ts` (`Lock`) | `queue: (()=>void)[]`, `locked: boolean`, `acquiredAt`, `forceReleaseTimer` | Self-guarding (this **is** the mutex); `forceReleaseTimer` is a `setTimeout` safety net capped at `MAX_READER_DRAIN_MS`-sibling `MAX_HOLD_MS = 5*60_000` |
| `utils/rw-guard.ts` (`ReadWriteGuard`) | `readerTokens: Map<symbol, number>` (token→start-time), `writeActive: boolean`, `writeWaiters`/`readWaiters: Deferred[]`, `forceReleaseTimer` | Self-guarding condition-variable discipline; per-token force-release at `MAX_READER_DRAIN_MS = 90*60_000` (comment documents this was raised from 35 min after a concurrency-audit finding) |
| `utils/queue.ts` (`Queue`) | `items: TValue[]`, `keys: Set<TKey>` | None — synchronous, single-threaded-JS-safe, no lock; caller must not interleave awaits across mutating calls |
| `utils/event-handler.ts` (`EventHandler`) | `#callbacks: Function[]` (private field) | None; `invoke()` wraps each callback in a **silent, unlogged** `catch {}` — see §10 |
| `base/index.ts` (`ServiceCollection`) | `services: Map<string, IService>` | None (registration-time `has()` check throws on duplicate; no concurrent-mutation guard, single-init-time use assumed) |
| `storage/memory-storage-area.ts` (`MemoryStorageArea`) | `data: Map<string, unknown>` (public `readonly` field, mutable Map) | None — test/scratch store only |
| `testing/mock-clock.ts` (`MockClock`) | `virtualNow: number`, `nextId`, `timers: Map<number, ScheduledTimer>` | None — single-threaded test driver |
| `testing/fake-background-ticker.ts` (`FakeBackgroundTicker`) | `subs: Subscription[]` (each with `running`/`pending`/`cancelled` flags) | Manual re-entrant coalescing logic in `runOnce()`, no lock (mirrors prod's own unguarded coalescing) |
| `testing/fake-browser-api.ts` | `PortRegistry.listeners`/`.ports`, `FakeWindowsAdapter.live: Set<number>`, `.nextId`, `FakeRuntimeAdapter.lastErrorSlot` | None — test double |
| `migration/staging.ts` (`StagingArea`) | `staged: Map<string, {op:"set",raw}|{op:"remove"}>` | None — scoped to one migration run, discarded after `diff()` |
| `migration/migrator.ts` (`Migrator`) | No in-memory mutable state of its own — all durable state lives in the injected `store` (external, caller-owned) under `nulo:schema:*` keys. The engine is stateless between calls. | N/A (state lives outside the module, in the persisted store) |

No module-level (file-scope) mutable singletons exist in `wallet-core` — every stateful thing is instance-scoped inside a class (verified via grep for module-level `Map`/`Set` construction; only hit was `jobs/types.ts`'s `TERMINAL_STAGES: ReadonlySet`, which is frozen data, not mutable state).

### 5. Dependency graph (one level deep, package-internal)

```
base/index.ts        → utils/event-handler.ts, base/topology.ts
jobs/error.ts         → utils/error-json.ts, utils/errors.ts, jobs/types.ts
jobs/fsm.ts            → jobs/types.ts
jobs/index.ts           → jobs/types.ts, jobs/fsm.ts, jobs/error.ts
logger/index.ts          → logger/interfaces.ts
migration/migrator.ts     → migration/types.ts, migration/staging.ts
migration/staging.ts       → migration/types.ts
migration/types.ts          → storage/entity_storage.ts (type-only: MinimalStorageArea)
storage/value-storage.ts     → storage/entity_storage.ts (type-only: MinimalStorageArea)
storage/memory-storage-area.ts → storage/entity_storage.ts (type-only)
utils/lock.ts                  → logger/interfaces.ts
utils/rw-guard.ts               → logger/interfaces.ts
utils/random.ts                  → utils/encoding.ts
ports/browser-api.ts              → ports/alarms-port.ts, runtime-port.ts, storage-port.ts, window-port.ts
ports/*-port.ts (most)             → ports/types.ts (Unsubscribe)
testing/fake-browser-api.ts         → ports/* (barrel), @webext-core/fake-browser (external)
testing/mock-clock.ts                → ports/clock-port.ts
testing/fake-background-ticker.ts     → ports/background-ticker-port.ts
activity/causal.ts                     → activity/model.ts
activity/scope.ts                       → (none internal)
activity/index.ts                        → activity/causal.ts, model.ts, scope.ts (barrel)
utils/serialization.ts                    → utils/error-json.ts
```

**No cycles found.** The graph is a strict DAG rooted at leaf modules (`utils/error-json.ts`, `logger/interfaces.ts`, `ports/types.ts`, `activity/model.ts`, `activity/scope.ts`, `storage/entity_storage.ts`) with no back-edges — consistent with the "foundation, depends on nothing" self-description.

### 6. Frameworks / primitives

- **Concurrency**: hand-rolled only — no `Promise.race`/AbortController usage in `wallet-core` itself; `Lock` (FIFO mutex) and `ReadWriteGuard` (multi-reader/exclusive-writer with a manual condition-variable-style wait-queue via a local `Deferred<T>` helper) are the two primitives everything downstream builds on. `base/index.ts` uses `Promise.all` per topological phase.
- **Validation**: none — `wallet-core` deliberately carries no zod (confirmed: not a dependency in `package.json`); `EntityStorage`/`ValueStorage`/`migration/types.ts` accept an optional `parse: (raw: unknown) => T` callback injected by the app layer instead.
- **Event emitters**: `utils/event-handler.ts`'s `EventHandler<T>` is the sole pub/sub primitive (not Node's `EventEmitter`, not a third-party lib).
- **Testing**: `vitest` (jsdom environment, `globals: true`), `fast-check` (property-based testing, used in `activity/causal.property.test.ts`), `@webext-core/fake-browser` (chrome-API fake, wrapped by `FakeBrowserApi`).

### 7. Test surfaces

Colocated `*.test.ts` beside each source file; package has its own `vitest.config.ts` (jsdom env) so it runs without Vue/Chrome-extension stubs. Rough density: `lock.test.ts` 411 LOC/22 cases for a 109-LOC source, `rw-guard.test.ts` 579 LOC/20 cases for 203 LOC, `migrator.test.ts` 642 LOC/50 cases for 388 LOC — the concurrency-critical and crash-recovery-critical modules are the most heavily tested, proportionally. `activity/` is tested via a single property-based file (`causal.property.test.ts`, 403 LOC / 1000 fc runs) covering both `causal.ts` and `scope.ts`'s `activityScopeKey`.

Modules with **no test file at all**: all barrels (`index.ts` files), all `ports/*.ts` (pure interfaces — expected), `logger/interfaces.ts` (pure types/enum — expected), `utils/serialization.ts`, `utils/arrays.ts`, `utils/random.ts`, `utils/sleep.ts`, `utils/queue.ts`, `utils/event-handler.ts`, `activity/model.ts` (pure types), `storage/memory-storage-area.ts` (exercised indirectly by `migrator.test.ts`/`entity_storage.test.ts` but has no direct unit test of its own `seed()`/`get()` semantics), `testing/fake-background-ticker.ts` (has real coalescing/re-entrancy logic in `runOnce()` but zero direct tests — it's only exercised transitively wherever consumers use it).

### 8. Generated / vendored / fixture code

- **`src/utils/mnemonic.ts`** — lines 1–2048 are the hardcoded BIP39 English wordlist (standard, not hand-authored prose but not marked as machine-generated either; effectively vendored data). Exclude the wordlist portion from line-level audit scrutiny; the actual logic (`getMnemonic`/`getEntropy`, ~110 LOC at the tail) is hand-written and should be audited normally.
- **`src/utils/serialization.ts`** — explicitly documented as "Copied (with Buffer handling) from `@aztec/foundation/json-rpc`" — treat as vendored, changes should be diffed against upstream intent rather than audited as original logic.
- **`src/testing/*`** — all three files are test infrastructure/fixtures by design (`FakeBrowserApi`, `MockClock`, `FakeBackgroundTicker`); bugs here matter (they can mask or fake real bugs) but they are not production code paths.
- **`src/storage/memory-storage-area.ts`** — doc comment states it's used as both a test fixture base *and* the real scratch store the backup-import migrator runs over — it's not purely a fixture, worth noting as dual-purpose.

### 9. Apparent duplication

- **`EntityStorage` vs `ValueStorage`** (`storage/entity_storage.ts`, `storage/value-storage.ts`) share ~80% structural shape (constructor signature, `MinimalStorageArea` dependency, optional `parse` codec) but diverge deliberately on failure policy: `EntityStorage.decodeRow` drops on JSON-syntax failure but keeps on codec-validation failure; `ValueStorage.get` throws on both. This is a documented, intentional divergence (comments explain why), not accidental duplication — but it's a real "two similar-looking classes with subtly different contracts" trap for a future maintainer/auditor to watch for.
- **`Lock` vs `ReadWriteGuard`** both implement a hand-rolled async wait-queue with a `Deferred`-style promise/resolve pattern and a force-release `setTimeout` safety net with near-identical rationale (comments in both explicitly cross-reference each other: "`Lock.MAX_HOLD_MS` mirrors `ReadWriteGuard.MAX_READER_DRAIN_MS`" per the README). `Lock` uses a plain callback array (`queue: (()=>void)[]`) while `ReadWriteGuard` uses the more general `Deferred<T>` helper — two different implementations of the same underlying "async mutex with timeout" concept, not sharing code. A downstream audit should check whether `Lock` could be reimplemented on top of `ReadWriteGuard`'s primitives (or vice versa) rather than maintaining two parallel force-release timer implementations.
- **`getErrorMessage`/`getErrorData` (utils/errors.ts) vs `errorMessageFromUnknown` (same file) vs `normalizeError` (jobs/error.ts)** — three different error-to-string/error-envelope strategies coexist in the same package, and the file-level comment in `utils/errors.ts` explicitly flags this as deliberate ("DELIBERATELY NOT routed through `errorMessageFromUnknown`... tracked for Q-01"). Not accidental, but a real multi-path error-normalization surface worth checking for drift.
- **`ActivityScopeReset` (activity/model.ts:59)** is exported but has **zero consumers anywhere in the repo** (confirmed via repo-wide grep — only its own declaration matches). Dead/speculative type, not wired to `resetScope()` (which takes a bare `ActivityIncarnation` instead).

### 10. Error-path hotspots

- **`migration/migrator.ts`** — 6 try/catch blocks; the entire module is a crash-recovery state machine (journal → backup → staged commit → checkpoint, with a resume-on-boot decision matrix). `Migrator.run()` wraps everything in an outer try/catch that **never rethrows** ("NEVER throws" per its own doc comment) — every failure mode funnels into a `MigrationResult` union instead. This is the single densest error-handling surface in the package and the highest-value target for a correctness audit given the "data-preserving" stakes.
- **`storage/entity_storage.ts`** — 4 try/catch, implements two deliberately-different failure policies (drop vs. keep) in `decodeRow()`; a bug here mixing up the two paths would either silently lose user data or silently hide corruption.
- **`jobs/error.ts`** — 4 try/catch, explicitly designed to defend against "hostile" thrown values (Proxy traps, hostile `toJSON()`, circular refs, BigInt) — outer try/catch wraps an inner try/catch (`trySerialize`), by design ("Outer guard: ANY part... typically a Proxy getter trap").
- **`utils/lock.ts`** — 2 try/catch, both explicitly "swallowed by design" (a throwing logger or `setTimeout` must never reject `enter()` while holding the lock) — the comments spell out a specific historical bug this pattern fixes ("before hardening, a post-acquisition logger throw rejected enter() with the lock held and NO timer armed: stranded forever").
- **`jobs/fsm.ts`** — 2 catch-adjacent constructs are really about a control-flow sentinel (`JobCancelledSentinel`) that must never cross an RPC boundary — worth checking every catch site downstream (in `apps/extension`) correctly distinguishes it from `JobError`.
- **`utils/event-handler.ts`** — `invoke()` has a genuinely **empty, silent `catch {}`** around each subscriber callback with no logging at all — unlike every other swallowed-catch in this package (which all carry an explanatory comment), this one has none. Worth flagging: a throwing subscriber is invisible.
- **`utils/rw-guard.ts`** — no try/catch per se, but a large, carefully-commented force-release timer mechanism (`startForceReleaseTimer`/`stopForceReleaseTimer`) that converts stuck-reader deadlocks into forced drains — the comments reference a specific past incident ("concurrency audit HIGH #3") where a too-short ceiling caused a real bug, making this a proven bug-history hotspot.

---

## PACKAGE 2: `packages/wallet-crypto` (`@nulo/wallet-crypto`)

### 1. Module inventory

| Path | Purpose | LOC (src, excl. tests) |
|---|---|---|
| `src/index.ts` | Public export barrel (explicit named re-exports, not `export *`) | 41 |
| `src/account-derivation.ts` | NULO-ACCOUNT-KDF v1: seed → Schnorr signing key → PXE secret key (`deriveSigningKeyFromSeed`, `deriveNuloAccountKeys`) | 38 |
| `src/constants.ts` | `PASSKEY_PRF_LABEL` — WebAuthn PRF domain separator, frozen by V8 vector | 10 |
| `src/encryption-key.ts` | `EncryptionKey` — PBKDF2-SHA256 (600k iterations) + AES-GCM, versioned ciphertext framing | 127 |
| `src/globals.d.ts` | Ambient `Buffer` global declaration (workaround for vite node-polyfills cross-workspace import limitation) | 21 |
| `src/passkey-credential.ts` | `PasskeyCredential` — WebAuthn PRF → HKDF → master secret (`Fr` reduce) | 86 |
| `src/password-secret-box.ts` | `PasswordSecretBox` — password-wrap around `EncryptionKey` with `ENCRYPTION_GUARD` round-trip check; `seal`/`sealWithPasshash`/`unseal`/`unsealWithPasshash`/`reseal` | 200 |
| `src/pxe-store-key.ts` | `derivePxeStoreKey()` — per-profile HKDF-SHA256 key for the offscreen PXE's SQLite-OPFS ChaCha20 store encryption | 34 |
| `src/secret-types.ts` | 7 branded nominal types (`Passhash`, `MasterSecretBytes`, `Base64Ciphertext`, `Base64MasterSecret`, `Base64CredentialId`, `Base64SecretPrf`, `HexUserHandle`) + `as*` mint functions (zero-runtime-cost identity casts) | 105 |
| `src/session-secret-box.ts` | `SessionSecretBox` — F-11 silent-restore bearer: wraps master secret under a fresh random token via HKDF→AES-GCM (replaces a prior password-equivalent-passhash bearer) | 135 |
| `src/zeroize.ts` | `zeroize()` — best-effort in-place byte-wipe helper for `Uint8Array`/`ArrayBuffer` | 49 |

### 2. Entrypoints / public exports

Single export path: `.` → `src/index.ts`. Named exports only (no barrel `export *`): `deriveNuloAccountKeys`, `deriveSigningKeyFromSeed`, `derivePxeStoreKey`, `PXE_STORE_KDF_LABEL`, `EncryptionKey`, `PasswordSecretBox` (+ `EncryptedProfileSecret`, `Sealed` types), `SessionSecretBox` (+ `SessionWrappedSecret`), `PasskeyCredential` (+ `PasskeyCredentialData`), `PASSKEY_PRF_LABEL`, `zeroize`, and all 7 branded types + their `as*` mint functions from `secret-types.ts`.

Intended consumers (confirmed via repo-wide grep): exclusively `apps/extension/src/wallet/services/{profile,passkey,account-integrity}/**`, `apps/extension/src/composables/{usePasskeyCeremony,useFullBackupImport}.ts`, `apps/extension/src/components/passkey/PasskeyCeremonyDialog.vue`, and one script (`apps/faucet/scripts/deploy.ts`). Notably **not** consumed by `aztec-runtime`, `extension-messaging`, `wallet-bridge`, or `bridge-core` directly — those depend on `wallet-core` but not `wallet-crypto` (confirmed by grep — no hits in those packages' `src/`). `apps/extension/src/wallet/crypto/key-vectors.test.ts` is called out in both this package's own header comment and its README as a load-bearing external contract test ("MUST pass byte-identically after any change here").

### 3. Coupling surfaces

Also shallow: highest import count is 5 (`account-derivation.ts`). No grab-bag module. The one real cross-cutting dependency is `@nulo/wallet-core/utils` (imported by `encryption-key.ts`, `passkey-credential.ts`, `password-secret-box.ts` for `bytesToHex`, `fromBase64`, `array_equals`, `toBase64`) — this is the package's **only** internal-to-monorepo cross-package import, confirmed one-directional (`wallet-core` never imports `wallet-crypto`; lint-enforced per `biome.json`). `@aztec/accounts`, `@aztec/constants`, `@aztec/foundation` are external dependencies used only by `account-derivation.ts` and `passkey-credential.ts` (for `Fr`).

### 4. State owners

| Module | State variable(s) | Guard |
|---|---|---|
| `passkey-credential.ts` (`PasskeyCredential`) | `private baseKey: CryptoKey`, `private salt: ArrayBuffer` (instance fields, not `readonly`, set once in the private constructor and never reassigned in the visible code path) | None — effectively immutable post-construction; no lock needed since nothing mutates concurrently |
| `encryption-key.ts` (`EncryptionKey`) | `private baseKey: CryptoKey` (set once via private constructor, never reassigned) | None — same immutable-after-construction pattern |
| `zeroize.ts` | No owned state — pure function that mutates its **caller-owned** buffer argument in place (documented as best-effort, not a true state owner) | N/A |

No module-level mutable singletons, no caches, no in-flight-request maps, no timers, no subscriptions in this package (confirmed: `grep` for module-level `Map`/`Set`/`WeakMap` construction returns zero matches). This is a purely functional/stateless-service package by design — every class instance is a short-lived key-material wrapper, not a long-lived stateful service. This is a meaningful structural finding for the audit: the concurrency/state-race risk classes relevant to `wallet-core` (lock starvation, force-release timing, cache staleness) essentially don't apply here; the risk profile is entirely about crypto-correctness, buffer-lifecycle/zeroization discipline, and error-path information leakage instead.

### 5. Dependency graph (one level deep, package-internal)

```
index.ts                → account-derivation.ts, pxe-store-key.ts, encryption-key.ts,
                           password-secret-box.ts, session-secret-box.ts, passkey-credential.ts,
                           constants.ts, zeroize.ts, secret-types.ts     (barrel, aggregates all)
encryption-key.ts         → secret-types.ts, zeroize.ts
password-secret-box.ts     → encryption-key.ts, secret-types.ts, zeroize.ts
session-secret-box.ts       → secret-types.ts, zeroize.ts
passkey-credential.ts        → secret-types.ts, zeroize.ts
account-derivation.ts          → (no internal deps — only @aztec/* externals)
pxe-store-key.ts                 → (no internal deps)
constants.ts                      → (no internal deps)
secret-types.ts                    → (no internal deps)
zeroize.ts                          → (no internal deps)
```

**No cycles.** Clean layered DAG: `secret-types.ts` + `zeroize.ts` are the two universal leaves everything else builds on. **Cross-package**: `wallet-crypto → wallet-core/utils` only, one direction, lint-enforced (`biome.json` blocks `wallet-crypto/src/**` from importing `@nulo/extension-messaging`, `@nulo/aztec-runtime`, `@nulo/wallet-bridge`, `@nulo/extension` — notably it does *not* need a rule blocking `@nulo/wallet-core` since that's the allowed direction).

### 6. Frameworks / primitives

- **Concurrency**: none — every operation here is a single async Web Crypto call chain (`crypto.subtle.deriveKey`/`deriveBits`/`encrypt`/`decrypt`/`digest`/`importKey`); no locks, no queues, nothing from `wallet-core/utils/lock.ts` or `rw-guard.ts` is used here. Concurrency safety is entirely the *caller's* (extension service layer's) responsibility.
- **Validation**: none — this package has no zod (confirmed in `package.json` dependencies) and no schema library; input validation is manual (`if (payload.length < 13) throw`, `if (wrapped?.v !== 1) return null`, length checks).
- **Event emitters**: none.
- **Crypto primitives in use**: Web Crypto API only (`PBKDF2`, `AES-GCM`, `HKDF`, `SHA-256`, `SHA-512` via `@aztec/foundation/crypto/sha512`'s `sha512ToGrumpkinScalar`), plus `@aztec/foundation`'s `Fr`/`GrumpkinScalar` curve types and `@aztec/accounts/utils`'s `deriveSecretKeyFromSigningKey`. No custom/hand-rolled crypto — every module's comments emphasize composing upstream primitives only ("no hand-rolled crypto, no improvised domain tags").
- **Branding pattern**: `secret-types.ts` implements a zero-runtime-cost nominal-typing scheme (`unique symbol` intersection types + identity-function "mint" helpers) specifically to prevent secret-type confusion at compile time (e.g. a credential id landing in a ciphertext slot) — this is a deliberate, documented type-system-level defense mechanism worth understanding before auditing call sites.

### 7. Test surfaces

Colocated `*.test.ts`, own `vitest.config.ts` (jsdom). Coverage by file: `account-derivation.test.ts` (31 LOC), `encryption-key.test.ts` (38 LOC), `password-secret-box.test.ts` (140 LOC / 17 cases), `session-secret-box.test.ts` (65 LOC), `zeroize.test.ts` (76 LOC). Total test LOC (556) is actually *less* than source LOC (695) for this package — lighter proportional coverage than `wallet-core`.

**Modules with no test file at all**:
- **`passkey-credential.ts`** (86 LOC, security-critical WebAuthn PRF→HKDF→master-secret chain) — **zero unit tests in-package.** The only coverage is indirect, via the extension-side `apps/extension/src/wallet/crypto/key-vectors.test.ts` integration test (outside this package's boundary) and consumer tests like `apps/extension/src/composables/usePasskeyCeremony.test.ts`. This is the most notable coverage gap in either package given the "changing this bricks every existing passkey wallet" stakes stated in its own comments.
- **`pxe-store-key.ts`** (34 LOC, derives the SQLite-OPFS encryption key) — no dedicated test file either; comment says it's "pinned by a key vector (`key-vectors.test.ts` V11)" — again, only covered externally.
- **`secret-types.ts`** — no test (trivial identity-function mints; low risk).
- **`constants.ts`**, **`globals.d.ts`** — no test (trivial/type-only; expected).

### 8. Generated / vendored / fixture code

None found — no wordlists, no vendored/copied-from-upstream files, no fixture data files in this package. (Contrast with `wallet-core`'s `mnemonic.ts` wordlist and `serialization.ts` vendored copy — `wallet-crypto` has nothing comparable.) `apps/extension/src/wallet/crypto/key-vectors.test.ts` (referenced but outside this package) is a fixture/vector file that audits should treat as ground truth, not touch.

### 9. Apparent duplication

- **`EncryptionKey.getPasshash`/`fromPasshash`/`fromPassword` pattern vs. `SessionSecretBox`'s inline HKDF derivation** — both implement a "derive key from IKM, encrypt/decrypt with AES-GCM" shape, but deliberately do NOT share code: `EncryptionKey` uses PBKDF2 (expensive, password-stretching), `SessionSecretBox` uses HKDF directly on a random token (cheap, no stretching needed). `SessionSecretBox`'s own header comment explicitly justifies *not* building on `EncryptionKey`: "NOT built on `PasswordSecretBox`/`EncryptionKey`: those run PBKDF2 (~600k rounds)... which is pointless for a random 256-bit token." Intentional non-duplication despite structural similarity — but the two independent AES-GCM encrypt/decrypt + iv-packing implementations (`EncryptionKey.encrypt`/`decrypt` vs. `SessionSecretBox.wrap`/`unwrap`'s inline `crypto.subtle.encrypt`/`decrypt`) are worth a side-by-side audit for framing-bug parity (both pack `iv || ciphertext`, but `EncryptionKey` prepends a 1-byte version tag while `SessionSecretBox` does not — a real, if intentional, format divergence).
- **`unsealInternal`'s `tryDecrypt` pattern (password-secret-box.ts) vs. `unwrap`'s inline try/catch (session-secret-box.ts)** — both implement "attempt AES-GCM decrypt, swallow failure, return null/undefined" as the wrong-credential signal, but as two separate hand-written implementations rather than a shared helper.
- No duplication observed between `wallet-crypto` and `wallet-core` beyond the intentional shared use of `wallet-core/utils`'s byte/base64 codecs (`bytesToHex`, `toBase64`, `fromBase64`, `array_equals`) — those are consumed, not reimplemented, which is the correct direction.

### 10. Error-path hotspots

- **`session-secret-box.ts`** — 4 try/catch/finally blocks in `wrap()`/`unwrap()`. `unwrap()` in particular has a carefully-structured nested try/finally specifically to guarantee `token`/`salt` buffers are zeroized on **every** exit path, including a partial-decode failure — the comment explicitly documents a prior bug this restructuring fixed ("previously returned from the decode catch before either buffer was wiped"). High-value target: any refactor here risks reintroducing that exact class of zeroization-skip bug.
- **`password-secret-box.ts`** — 2 explicit try/catch (`unseal`'s passhash-zeroize finally, `reseal`'s nested try/finally covering both `oldPasshash` and `secret` zeroization) plus the private `tryDecrypt()` helper that converts any Web Crypto failure into `undefined` — used to distinguish "wrong password" (returns `null`, not an exception) from "system-level bug" (propagates as a throw). The module's own header comment stresses this null-vs-throw distinction is deliberate and load-bearing for UI error mapping (`InvalidPasswordError` matching in `popup/pages/auth.vue`) — worth checking every call site correctly threads `null` vs. thrown.
- **Buffer/zeroize lifecycle in general** — every module in this package (`encryption-key.ts`, `password-secret-box.ts`, `session-secret-box.ts`, `passkey-credential.ts`) uses `try { ... } finally { zeroize(...) }` as its dominant control-flow pattern rather than plain try/catch for error handling per se — the "error path" concern here is less about exceptions and more about **secret-lifetime correctness**: does every exit path (including early `return null` for wrong-password) actually reach the `zeroize()` call? This is the single most audit-worthy pattern class across the whole package, and `zeroize.ts`'s own doc comment is explicit that the guarantee is "best-effort" only (GC timing, other live references/clones are explicitly out of scope).

---

## Cross-package summary

- **Dependency direction**: `wallet-crypto → wallet-core` only, one-way, lint-enforced both directions (wallet-core cannot import wallet-crypto; wallet-crypto cannot import extension-messaging/aztec-runtime/wallet-bridge/extension). **No cycle** between these two packages or with any other `@nulo/*` package.
- **Risk-profile split**: `wallet-core`'s bug-audit hotspots are concurrency/state-correctness (locks, guards, the migration journal's crash-resume matrix, the causal reducer's ordering invariants). `wallet-crypto`'s hotspots are buffer-lifecycle/zeroization-on-every-exit-path correctness and null-vs-throw error-signal discipline, not concurrency (it owns essentially no mutable state).
- **Weakest test coverage in either package**: `wallet-crypto/src/passkey-credential.ts` — zero in-package tests for a security-critical, "bricks every wallet if changed" derivation chain, covered only by an external extension-side vector test.