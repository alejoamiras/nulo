# Repo Map — `packages/wallet-core`

Phase-1 map for `/harden quality` (ultra). Lens: **typing quality** + **dedup**.

`@nulo/wallet-core` is the bottom layer of the stack
(`wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`).
Pure ports, types, concurrency primitives, storage wrappers, the job FSM, the
base-service contract, and in-memory test fakes. **Aztec-free and `chrome.*`-free**
(enforced by biome `noRestrictedGlobals`); no I/O, no real clock. 37 source files,
~4067 LOC (2160 of which is `mnemonic.ts`'s static bip39 table), 11 colocated test
files (~1449 LOC).

---

## 1. Module inventory (purpose + rough LOC)

### `src/` root
| File | Purpose | LOC |
|---|---|---|
| `index.ts` | Intentionally-empty barrel (`export {}`); docs point consumers at subpaths. **No bare importers exist** (dead no-op). | 15 |

### `ports/` — I/O boundary interfaces (the package's reason to exist)
| File | Purpose | LOC |
|---|---|---|
| `index.ts` | Type-only barrel re-exporting all port types. | 20 |
| `types.ts` | `Unsubscribe = () => void`. Shared primitive. | 6 |
| `browser-api.ts` | `BrowserApi` = composite of storage/runtime/windows/alarms. Swapped as one unit at the composition root. | 18 |
| `storage-port.ts` | `StoragePort` (local/session) + `StorageArea` + `StorageEntries`/`StorageChanges` (`Record<string, unknown>`). Mirrors `chrome.storage`. | 44 |
| `runtime-port.ts` | `RuntimePort` (messaging, long-lived ports, getURL, onInstalled, lastError, offscreen `getContexts?`) + `MessagePortLike`/`MessageSender`/`MessageListener`. | 68 |
| `window-port.ts` | `WindowPort` + `CreatedWindow`/`CreateWindowOptions`. | 29 |
| `alarms-port.ts` | `AlarmsPort` (MV3-suspension-surviving timers) + `AlarmCreateOptions`/`AlarmEvent`. | 36 |
| `clock-port.ts` | `ClockPort` (now/sleep/set+clear Timeout+Interval). `TimerHandle = unknown`. | 24 |
| `background-ticker-port.ts` | `BackgroundTickerPort`/`TickerHandle` — serialized, coalescing, at-most-one-in-flight periodic work. Heavy doc-comment contract. | 40 |

### `storage/` — typed wrappers over a `StorageArea`
| File | Purpose | LOC |
|---|---|---|
| `index.ts` | Barrel: `EntityStorage`, `MinimalStorageArea`, `ValueStorage`. | 2 |
| `entity_storage.ts` | `EntityStorage<T>` — indexed rows keyed `${root}@${id}`; `parseOrDelete` drops malformed rows (logs + deletes). Defines `MinimalStorageArea`. | 114 |
| `value-storage.ts` | `ValueStorage<T>` — single JSON record at `root`. | 33 |

### `utils/` — pure helpers
| File | Purpose | LOC |
|---|---|---|
| `index.ts` | `export *` barrel of all utils. | 10 |
| `lock.ts` | `Lock` — single-flight per-service mutex, `MAX_HOLD_MS = 5min` force-release. | 69 |
| `rw-guard.ts` | `ReadWriteGuard` — parallel reads / exclusive writes, FIFO writer priority, `MAX_READER_DRAIN_MS` force-release, manual `enterWrite`/`leaveWrite`. | 155 |
| `event-handler.ts` | `EventHandler<T>` / `IEventHandler<T>` — the emit primitive every service uses; `invoke` swallows callback throws. | 29 |
| `queue.ts` | `Queue<TKey,TValue>` — dedup-by-key FIFO + `priorityPass`. | 50 |
| `serialization.ts` | `jsonStringify`/`jsonSanitize` — Buffer/Map/Set/bigint/Error-aware. **Vendored copy of `@aztec/foundation/json-rpc`.** Naked `declare const Buffer`. | 57 |
| `error-json.ts` | `baseErrorJson(err)` — projects non-enumerable name/message/stack. **Shared dedup hub** for the two JSON Error replacers. | 24 |
| `errors.ts` | `getErrorMessage`/`getErrorData` — `unknown → string` via double cast. | 3 |
| `mnemonic.ts` | bip39 word table + `getMnemonic`/`getEntropy` (SHA-256 checksum, bit-twiddling). 2050 lines = the static table. | 2160 |
| `random.ts` | `getRandomHex(len)` via `self.crypto.getRandomValues`; Buffer-free hex. | 16 |
| `arrays.ts` | `array_equals`, `array_max`, `hasIntersectionByKeys` (+ private `safeStringify`). | 53 |
| `sleep.ts` | `sleep(ms)` (real `setTimeout` — the one wall-clock helper). | 1 |

### `base/` — service contract + startup ordering
| File | Purpose | LOC |
|---|---|---|
| `index.ts` | `ServiceCollection`, `ServiceSpec<Methods,Events>`, `MethodsMap`/`EventsMap`/`MethodsSpec`/`EventsSpec`, `IService`, `Restored<T>`. The universal service-spec contract. | 71 |
| `topology.ts` | `topologicalPhases()` (Kahn, layered) + `DependencyCycleError`/`UnknownDependencyError`/`ServiceNode`. Pure. | 105 |

### `jobs/` — durable-job FSM + error envelope
| File | Purpose | LOC |
|---|---|---|
| `index.ts` | Barrel. | 12 |
| `types.ts` | `JobStage` (8-state union), `JobProgress` (discriminated by stage), `JobError`, `TERMINAL_STAGES`/`isTerminal`, `NORMALIZED_RAW_MAX_CHARS`. | 98 |
| `fsm.ts` | `LEGAL_TRANSITIONS` table + `canTransition`/`assertCanTransition`, `IllegalTransitionError`, `JobCancelledSentinel`. Pure rules; no state ownership. | 106 |
| `error.ts` | `normalizeError(raw, kind)` — never-throws → `JobError`; `extractMessage`/`trySerialize`/`jsonReplacer`. | 79 |

### `logger/` — logging interfaces only
| File | Purpose | LOC |
|---|---|---|
| `index.ts` | `export * from interfaces`. | 1 |
| `interfaces.ts` | `LogLevel` enum, `LogContext`, `Log`, `ILogger`, `ILoggerStore`, `consoleMethods` table. Concrete `LoggerStore` lives in `@nulo/extension`. | 49 |

### `testing/` — in-memory fakes (exported test doubles)
| File | Purpose | LOC |
|---|---|---|
| `index.ts` | Barrel: `MockClock`, `FakeBrowserApi`, `FakeBackgroundTicker`. | 12 |
| `fake-browser-api.ts` | `FakeBrowserApi` wrapping `@webext-core/fake-browser` + hand-rolled runtime port broker, windows, alarms adapters. Normalizes polyfill `{key:undefined}` → chrome `{}`. | 296 |
| `mock-clock.ts` | `MockClock` — virtual time, `advance`/`setNow`/`pendingCount`. | 96 |
| `fake-background-ticker.ts` | `FakeBackgroundTicker` — manual `tick()`, mirrors prod serialize/coalesce. | 66 |

---

## 2. Public exports (the surface siblings consume)

Subpath exports (`package.json#exports`) and their import counts across siblings:

| Subpath | Importers | Key exports |
|---|---|---|
| `@nulo/wallet-core/utils` | **106** | `EventHandler`/`IEventHandler`, `Lock`, `ReadWriteGuard`, `Queue`, `jsonStringify`/`jsonSanitize`, `baseErrorJson`, `getErrorMessage`/`getErrorData`, `getRandomHex`, `getMnemonic`/`getEntropy`, `array_*`/`hasIntersectionByKeys`, `sleep` |
| `@nulo/wallet-core/ports` | 29 | `BrowserApi`, `StoragePort`/`StorageArea`/`StorageEntries`/`StorageChanges`, `RuntimePort`/`MessagePortLike`/`MessageSender`/`MessageListener`, `WindowPort`/`CreatedWindow`/`CreateWindowOptions`, `AlarmsPort`/`AlarmCreateOptions`/`AlarmEvent`, `ClockPort`/`TimerHandle`, `BackgroundTickerPort`/`TickerHandle`, `Unsubscribe` |
| `@nulo/wallet-core/logger` | 28 | `LogLevel`, `LogContext`, `Log`, `ILogger`, `ILoggerStore`, `consoleMethods` |
| `@nulo/wallet-core/jobs` | 28 | `JobStage`/`JobProgress`/`JobError`, `TERMINAL_STAGES`/`isTerminal`, `canTransition`/`assertCanTransition`, `IllegalTransitionError`, `JobCancelledSentinel`, `normalizeError`, `NORMALIZED_RAW_MAX_CHARS` |
| `@nulo/wallet-core/testing` | 23 | `MockClock`, `FakeBrowserApi`, `FakeBackgroundTicker` |
| `@nulo/wallet-core/base` | 15 | `ServiceCollection`, `ServiceSpec`, `MethodsMap`/`EventsMap`/`MethodsSpec`/`EventsSpec`, `IService`, `Restored`, `topologicalPhases`, `DependencyCycleError`/`UnknownDependencyError`/`ServiceNode` |
| `@nulo/wallet-core/storage` | 3 | `EntityStorage`, `ValueStorage`, `MinimalStorageArea` |
| `@nulo/wallet-core` (root) | **0** | empty barrel — dead export path |

Note: the extension's `@/wallet/utils` barrel does `export * from "@nulo/wallet-core/utils"`, so a large share of the 106 `utils` consumers reach core transitively (clean re-export, **not** a duplicate).

---

## 3. State owners / concurrency primitives

This package owns the wallet's concurrency + persistence primitives. Everything
above it builds on these; they are the highest-blast-radius code in the repo.

- **`Lock`** (`utils/lock.ts`) — single-flight mutex, `enter()/leave()`, `MAX_HOLD_MS = 5min` force-release timer (turns a deadlock into a loud log + recovery). Optional `name`/`logger`.
- **`ReadWriteGuard`** (`utils/rw-guard.ts`) — readers/writers, FIFO writer priority (no writer starvation), baton-pass handoff in `releaseWrite`, `MAX_READER_DRAIN_MS = 5min` force-release. Documented reentry deadlock (write-within-read) — caller-must-not-nest contract; MV3 lacks `AsyncLocalStorage` so no static detection.
- **`Queue`** (`utils/queue.ts`) — dedup-by-key FIFO with `priorityPass`/`peek`.
- **`EventHandler<T>`** (`utils/event-handler.ts`) — the universal emit primitive; `invoke` try/catch-swallows callback errors (one bad listener can't break the loop).
- **`ServiceCollection` + `topologicalPhases`** (`base/`) — startup-ordering owner. Phases run sequentially, services within a phase in parallel. Cycles/unknown deps throw named errors up front, not as `ensureInitialized` timeouts.
- **`EntityStorage<T>` / `ValueStorage<T>`** (`storage/`) — the persistence wrappers. Row keys `${root}@${id}` (migration scripts depend on the exact encoding). `parseOrDelete` is the corruption-recovery policy (log + drop bad row).
- **Job FSM** (`jobs/fsm.ts`) — the legal-transition table for durable jobs; pure, no state. Journal service in `@nulo/extension` owns the records.
- **`MockClock` / `FakeBackgroundTicker`** (`testing/`) — deterministic time/tick control for everything above.

Invariant pairing: `Lock.MAX_HOLD_MS` ≡ `ReadWriteGuard.MAX_READER_DRAIN_MS` (both `5 * 60_000`) — duplicated literal, see hotspots §9.

---

## 4. Internal dep graph (shallow, mostly leaf modules)

```
utils/event-handler ──────────────► logger/interfaces ──► utils/lock
                                            └────────────► utils/rw-guard
                            base/index ──► utils/event-handler
                            base/index ──► base/topology
utils/error-json (baseErrorJson) ──► utils/serialization      (shared hub)
                                  └─► jobs/error ──► jobs/types
jobs/fsm ──► jobs/types
testing/mock-clock ──► ports
testing/fake-background-ticker ──► ports/background-ticker-port
testing/fake-browser-api ──► ports
```

`utils/error-json` is the only real fan-in hub (2 consumers share `baseErrorJson` — a *good*, intentional dedup). Most modules are leaves with zero intra-package deps (`mnemonic`, `random`, `arrays`, `queue`, `sleep`, `errors`, all `ports/*` except the composite, `value-storage`, `entity_storage`).

---

## 5. Libs / dependencies

- **Runtime deps:** none (no `dependencies` block). Foundational by design.
- **devDependencies:** `@webext-core/fake-browser@^1.5.2` (used only by `testing/fake-browser-api.ts`), `vitest@^4.1.9`, `jsdom@^29.1.1`, `@types/node@^24.13.2`, `typescript@^6.0.3`.
- **Vendored:** `utils/serialization.ts` is a hand-copied port of `@aztec/foundation/json-rpc` (kept local so core stays Aztec-free) — drift risk vs upstream.
- **Globals relied on (no import):** `self.crypto.subtle`/`getRandomValues` (mnemonic, random), `setTimeout` (sleep, lock, rw-guard), `console.error` (entity_storage), naked `declare const Buffer` (serialization).
- **tsconfig:** `strict`, `types: ["node"]`, `lib: ESNext+DOM+WebWorker`, `moduleResolution: Bundler`, `isolatedModules`. Note: README claims `"types": []` but tsconfig actually has `["node"]` (doc drift).
- **vitest.config:** `globals: true`, `environment: jsdom`, `@` alias to `src`.

---

## 6. Test surfaces + exported testing fakes

11 colocated `*.test.ts` (~1449 LOC). Coverage is concentrated on the concurrency
+ storage + FSM primitives (the right places):

| Test | LOC | Covers |
|---|---|---|
| `utils/rw-guard.test.ts` | 409 | Heaviest — reader/writer ordering, FIFO priority, force-release, manual hold. |
| `utils/lock.test.ts` | 167 | Mutex queueing, force-release. |
| `storage/entity_storage.test.ts` | 144 | Row keys, getAll/getKeys/getValues, `parseOrDelete` corruption path. |
| `utils/mnemonic.test.ts` | 121 | bip39 round-trip, checksum, invalid-word/length. |
| `testing/mock-clock.test.ts` | 113 | Virtual-time advance, intervals, pending count. |
| `testing/fake-browser-api.test.ts` | 113 | Storage/runtime-port/windows/alarms fake behavior. |
| `jobs/fsm.test.ts` | 106 | Legal/illegal transitions, terminal stages. |
| `base/topology.test.ts` | 82 | Phases, cycle + unknown-dep errors. |
| `storage/value-storage.test.ts` | 77 | get/set/delete. |
| `jobs/error.test.ts` | 77 | normalizeError hostile-input/cap/bigint. |
| `utils/error-json.test.ts` | 40 | baseErrorJson projection. |

**Exported fakes** (`@nulo/wallet-core/testing`, 23 importers across the repo — the standard test substrate):
- `FakeBrowserApi` — in-memory `BrowserApi`; real-ish storage (persists, fires onChanged), hand-rolled long-lived-port broker, windows/alarms. Normalizes polyfill `{key:undefined}` → `{}` (otherwise `key in res` existence checks loop forever).
- `MockClock` — virtual `ClockPort`.
- `FakeBackgroundTicker` — manual-`tick()` `BackgroundTickerPort`, mirrors prod serialize/coalesce.

**Untested source** (acceptable — trivial or type-only): all `ports/*` (interfaces), `logger/interfaces.ts`, `utils/{arrays,queue,event-handler,random,serialization,errors,sleep}.ts`, `fake-background-ticker.ts`, `base/index.ts` (`ServiceCollection`). `Queue` and `arrays.hasIntersectionByKeys` carry real logic but have no tests.

---

## 7. Generated / fixture paths to EXCLUDE (Phase 2)

- `packages/wallet-core/node_modules/**`
- The 2050-line static **bip39 word table** in `utils/mnemonic.ts` (lines ~1–2050) — data, not logic; audit only `getMnemonic`/`getEntropy` (lines ~2052–2160).
- No build output (`tsc --noEmit`), no generated `.d.ts`, no codegen in this package.

---

## 8. Proposed Phase-2 clusters

Five bounded units (full file coverage; stable `wallet-core/<subdomain>` names):

### `wallet-core/concurrency`
Sync + eventing primitives — highest blast radius.
- `src/utils/lock.ts` (+ `lock.test.ts`)
- `src/utils/rw-guard.ts` (+ `rw-guard.test.ts`)
- `src/utils/queue.ts`
- `src/utils/event-handler.ts`

### `wallet-core/storage`
Persistence wrappers + their boundary type.
- `src/storage/entity_storage.ts` (+ `entity_storage.test.ts`)
- `src/storage/value-storage.ts` (+ `value-storage.test.ts`)
- `src/storage/index.ts`

### `wallet-core/jobs-and-errors`
Durable-job FSM + error/JSON-wire serialization (bound together by `baseErrorJson` and the two error-message extractors — see §9 dedup).
- `src/jobs/types.ts`, `src/jobs/fsm.ts`, `src/jobs/error.ts`, `src/jobs/index.ts` (+ `fsm.test.ts`, `error.test.ts`)
- `src/utils/error-json.ts` (+ `error-json.test.ts`)
- `src/utils/errors.ts`
- `src/utils/serialization.ts`

### `wallet-core/base-service`
Service contract + startup ordering.
- `src/base/index.ts` (`ServiceCollection`, `ServiceSpec`, `IService`)
- `src/base/topology.ts` (+ `topology.test.ts`)

### `wallet-core/ports-testing`
I/O boundary interfaces + their fakes + logger contract + leftover pure helpers.
- `src/ports/*.ts` (all 9)
- `src/logger/interfaces.ts`, `src/logger/index.ts`
- `src/testing/*.ts` (+ `fake-browser-api.test.ts`, `mock-clock.test.ts`)
- `src/index.ts` (the empty barrel)
- **Low-priority riders** (tiny, well-isolated pure helpers — fold here or skip): `src/utils/mnemonic.ts` (+ test), `src/utils/random.ts`, `src/utils/arrays.ts`, `src/utils/sleep.ts`, `src/utils/index.ts`.

---

## 9. Typing + dedup hotspot candidates

### Typing (foundational package — loose types here propagate everywhere)

1. **`EntityStorage<T>` / `ValueStorage<T>` return unvalidated `T`** (`entity_storage.ts:49` `JSON.parse(raw as string) as T`; `value-storage.ts:21`). The trust boundary claims `T` but does **zero runtime validation** — every persisted entity in the wallet is read back as an unchecked cast. No zod at this seam. **HIGH** value: it's the read path for all storage, and `parseOrDelete` only guards `JSON.parse` syntax, not shape. (Cluster: `wallet-core/storage`.)
2. **`JobError.kind: string`** (`jobs/types.ts:82`) — stringly-typed. The real category set (`user_rejected | popup_bound | sw_restart_post_prove | stale_on_resume | stuck_proving | network | simulation | prover | unknown`) lives only in a doc comment. Persisted **and** wire-crossing. Should be `KnownJobErrorKind | (string & {})` (open union keeps forward-compat while typing the known set). **HIGH** (cluster: `wallet-core/jobs-and-errors`).
3. **`MethodsMap = Record<string, (...params: any[]) => unknown>`** (`base/index.ts:11`) — the sole `any` in the public surface (biome-ignored, variance-justified). It backs `ServiceSpec`, consumed by every `Service`/`ServiceClient` in the repo. Justified, but verify it isn't silently widening param inference at any call site. **MODERATE** (cluster: `wallet-core/base-service`).
4. **`ClockPort.TimerHandle = unknown`** (`clock-port.ts:8`) forces `handle as number` casts in `MockClock` (`mock-clock.ts:51,61`). An opaque handle that every adapter must re-narrow — branded type or generic `TimerHandle` would remove the casts. **LOW-MODERATE** (cluster: `wallet-core/ports-testing`).
5. **`utils/errors.ts` double-cast on `unknown`** — `(error as Error)?.message ?? (error as string)`. The `as string` fallback is unsound (a non-Error, non-string value is returned as if `string`). **MODERATE**, and it overlaps semantically with `jobs/error.ts:extractMessage` (see dedup #1).
6. **`MinimalStorageArea` vs `StorageArea`** — a second, hand-rolled storage interface (`entity_storage.ts:12`) overlapping `storage-port.ts:StorageArea`. Can't be a clean `Pick<StorageArea, ...>` because `get` signatures diverge (`MinimalStorageArea.get` omits `null`). Structural near-dup at a boundary. **LOW** (cluster: `wallet-core/storage`).
7. **`serialization.ts` replacer + `value as Error & {code,details}`** (`:43`) and `.type`/`.data` access on the implicit-`any` replacer param — standard JSON-boundary looseness, but worth a glance given it's the wire format. **LOW** (cluster: `wallet-core/jobs-and-errors`).

### Dedup

1. **Two error→message extractors.** `utils/errors.ts` (`getErrorMessage`/`getErrorData`) vs `jobs/error.ts` (`extractMessage`) implement overlapping `unknown → human string` logic. Consolidate — the package already models the right pattern with `baseErrorJson` (shared by `serialization.ts` + `jobs/error.ts`). **MODERATE** (both live in `wallet-core/jobs-and-errors`).
2. **`MAX_HOLD_MS` ≡ `MAX_READER_DRAIN_MS`** — the same `5 * 60_000` literal duplicated in `lock.ts:4` and `rw-guard.ts:6`. README pins them as an intentional invariant pair, but they're two independent constants that can silently drift. Extract a shared `FORCE_RELEASE_MS`. **LOW** (cluster: `wallet-core/concurrency`).
3. **Vendored `serialization.ts`** is a copy of `@aztec/foundation/json-rpc` (`:25` comment). Unavoidable (core must stay Aztec-free) but flag as an upstream-drift watch item. **LOW**.
4. **Empty root barrel** `src/index.ts` (`export {}`) — zero `from "@nulo/wallet-core"` importers repo-wide. Dead export path; either delete or document. **TRIVIAL**.

### Cross-package dedup — positive finding (non-issue)

Grep across all sibling packages found **no** duplicate definitions of `EventHandler`, `Lock`, `ReadWriteGuard`, `Queue`, `jsonStringify`/`jsonSanitize`, the bip39 table, or `getRandomHex`. `getRandomHex` has ~15 call sites across extension services, all importing core (directly or via the `@/wallet/utils` re-export barrel). The foundational dedup story is healthy — the candidates above are all **intra-package**.
