# Security Map: packages/wallet-core

## Module inventory

| Subdir | Path | Purpose | Language | LOC |
|--------|------|---------|----------|-----|
| `base` | `/src/base/` | `ServiceCollection` + `ServiceSpec` typed service contract; topological phase-ordered startup respecting dependency DAG. | TypeScript | 176 |
| `jobs` | `/src/jobs/` | Phase 2 durable-job FSM: pure transition-rules (queued→pending→simulating→proving→submitting→succeeded/failed/cancelled); no state ownership. | TypeScript | 293 |
| `logger` | `/src/logger/` | `ILogger` interface + `LogLevel` enum; concrete chrome-backed `LoggerStore` lives in `@nulo/extension`. | TypeScript | 50 |
| `ports` | `/src/ports/` | Nine I/O boundary abstractions: `BrowserApi`, `StoragePort`, `RuntimePort`, `WindowPort`, `AlarmsPort`, `ClockPort`, `BackgroundTickerPort`, plus types. | TypeScript | 285 |
| `storage` | `/src/storage/` | `ValueStorage<T>` (single-record KV); `EntityStorage<T>` (indexed rows, `${root}@${id}` key encoding with per-row parse-error recovery). | TypeScript | 178 |
| `testing` | `/src/testing/` | Test doubles: `FakeBrowserApi`, `MockClock`, `FakeBackgroundTicker`. `FakeNodeFactory` excluded (Aztec-typed, lives in `aztec-runtime`). | TypeScript | 470 |
| `utils` | `/src/utils/` | Core primitives: `Lock` (FIFO queue, 5-min force-release), `ReadWriteGuard` (multi-reader/single-writer, force-drain at 5-min), `EventHandler<T>` (sync callbacks), random, mnemonic, serialization, arrays, queue, sleep, errors. | TypeScript | 2625 |

**Total: 7 subdirs, 43 files (34 .ts + 9 .test.ts + 1 package.json), ~5500 LOC production.**

## Entrypoints (public API)

### Main barrel (`src/index.ts`)
Intentionally empty — consumers import via subpaths to enable tree-shaking.

### Subpath exports (6 public surfaces):
1. **`@nulo/wallet-core/ports`** — all I/O abstractions
2. **`@nulo/wallet-core/utils`** — `Lock`, `ReadWriteGuard`, `EventHandler`, array/error/random/serialization/sleep utilities
3. **`@nulo/wallet-core/storage`** — `ValueStorage<T>`, `EntityStorage<T>`, `MinimalStorageArea`
4. **`@nulo/wallet-core/base`** — `ServiceCollection`, `ServiceSpec<Methods, Events>`, `IService`, topology errors
5. **`@nulo/wallet-core/logger`** — `ILogger`, `LogLevel` enum
6. **`@nulo/wallet-core/testing`** — `FakeBrowserApi`, `MockClock`, `FakeBackgroundTicker`
7. **`@nulo/wallet-core/jobs`** — `JobStage`, `JobProgress`, `JobError`, `canTransition()`, `assertCanTransition()`

### Service lifecycle contract (`IService`)
- `name: string` — unique service identifier
- `dependencies?: readonly string[]` — topologically-ordered startup dependency list
- `start(services: ServiceCollection): Promise<void>` — single startup entry point

### EventHandler surface
Sync, fire-and-forget event primitives; callbacks run in sequence:
- `add(callback): void`, `remove(callback): void`, `invoke(payload): void` (catches + suppresses per-listener exceptions)

### Lock primitive (`Lock`)
- `enter(): Promise<void>` — acquire (FIFO-queued if contended; logs wait time)
- `leave(): void` — release (idempotent, clears force-release timer)
- **MAX_HOLD_MS = 5 min** — force-releases if holder never calls `leave()`, logs error
- Used by `ProfileService` to serialize auth operations; each service instance gets its own lock

### ReadWriteGuard primitive (`ReadWriteGuard`)
- `read<T>(fn)`, `write<T>(fn)` — multi-reader / exclusive-writer with FIFO writer priority
- `enterWrite()` + `leaveWrite()` — manual write-hold for multi-await destructive ops
- **MAX_READER_DRAIN_MS = 5 min** — force-releases stuck readers
- Reentry deadlock possible (write from inside read callback) — undetectable without `AsyncLocalStorage`; force-release unsticks after 5 min

### ServiceCollection DI pattern
- `add(service)`, `get<T>(name)`, `start()` (topologically-ordered)

## Trust boundaries

`wallet-core` is **library-layer, not a trust boundary owner**. Key input validation surfaces:

### Input validation / decode surfaces
1. **`EntityStorage<T>.parseOrDelete(fullKey, raw)`** — per-row `JSON.parse` wrapping. Malformed rows logged (truncated to 200 chars) and silently deleted instead of poisoning the namespace. Caller layers schema validation.
2. **`EventHandler<T>.invoke(payload)`** — payload passed untrusted to all callbacks. Callbacks run sync; exceptions caught + suppressed per-callback.

### Operation-context types
None. Downstream packages own per-message origin context.

### Callback / event handler untrusted-code surface
- `EventHandler` callbacks are sync only — exceptions suppressed.
- `StorageArea.onChange(listener)` — listener fires async; if it throws, the error is unhandled (no try/catch for port callbacks).

### Crypto / random / time in security-critical paths
1. **Random (`random.ts`)** — `getRandomHex(length)` uses `self.crypto.getRandomValues` (CSPRNG). No seeding or entropy pooling.
2. **Time (`ClockPort`)** — abstracted so MockClock can control it in tests. Used by: Lock/ReadWriteGuard force-release timers; SessionManager TTL checks; job-stuck-proving detector. No clock-skew mitigation.
3. **No buffer zeroing at wallet-core level** — zeroing happens in wallet-crypto.

## Dependency graph

### What wallet-core imports
**Zero workspace dependencies** (enforced by biome `noRestrictedImports`). External: **none** — only `@webext-core/fake-browser` in devDeps for testing.

### Workspace packages that depend on wallet-core
- **`wallet-crypto`** — uses `EventHandler`, `Lock`, utils, `array_equals`
- **`extension-messaging`** — uses `ServiceSpec`, `EventHandler`; RPC wire framing
- **`aztec-runtime`** — uses `IService`, `ServiceSpec`, ports
- **`wallet-bridge`** — uses `ServiceSpec`, `EventHandler`, ports
- **`extension`** — uses all subpaths

## Frameworks in use
Minimal — TypeScript, Vitest, jsdom, @webext-core/fake-browser (dev). No external validators.

## Test surfaces

**10 test files, ~1200 LOC test code:**

| Test file | Coverage |
|-----------|----------|
| `base/topology.test.ts` | Topological phase ordering, cycle detection |
| `jobs/fsm.test.ts` | 7-stage FSM legal transitions, illegal rejection |
| `jobs/error.test.ts` | `JobError` shape, `NORMALIZED_RAW_MAX_CHARS` truncation |
| `utils/lock.test.ts` | FIFO ordering, contended acquire, force-release after 5-min |
| `utils/rw-guard.test.ts` | Read/write interleaving, writer FIFO priority, stuck-reader force-release |
| `utils/mnemonic.test.ts` | BIP39 mnemonic generation, vector validation |
| `storage/entity_storage.test.ts` | CRUD, key prefix encoding, malformed-row recovery |
| `storage/value-storage.test.ts` | Single-record KV |
| `testing/fake-browser-api.test.ts` | FakeBrowserApi fakes |
| `testing/mock-clock.test.ts` | Virtual time advancement |

## Generated / vendored / dev-only paths to exclude
- `dist/`, `node_modules/`, `*.test.ts`, `vitest.config.ts`, `tsconfig.json`, `src/testing/` (dev-only export)
