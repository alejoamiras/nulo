# M3.1 — Extract `@nulo/wallet-core` (~1 week)

## Context & prerequisite

M2 is fully complete (0.12.4). The monorepo has 3 packages today:
- `packages/extension` — all source code
- `packages/playground` — scaffold
- `packages/landing` — scaffold

M3 begins here. Extraction order is prescribed by the architecture plan:
**wallet-core first** because every subsequent package depends on it and it has zero Chrome/Vue/Aztec dependencies.

## What goes in `@nulo/wallet-core`

Pure TypeScript — no Chrome APIs, no Vue, no Aztec packages, no WASM.

| Source tree (current location) | Moves to |
|---|---|
| `src/core/ports/` — ClockPort, StoragePort, WindowPort, AlarmPort, RuntimePort, NodeFactoryPort, BackgroundTickerPort, BrowserApi, types | `packages/wallet-core/src/ports/` |
| `src/core/testing/` — FakeBrowserApi, MockClock, FakeNodeFactory, FakeBackgroundTicker + their tests | `packages/wallet-core/src/testing/` |
| `src/wallet/utils/` — **safe subset only** (see table below) | `packages/wallet-core/src/utils/` |
| `src/wallet/storage/entity_storage.ts`, `value-storage.ts` (injected ctor only — see below) | `packages/wallet-core/src/storage/` |
| `src/wallet/base/index.ts` — ServiceCollection, IService, MethodsMap, EventsMap, topological phases | `packages/wallet-core/src/base/` |
| `src/wallet/base/topology.ts` | `packages/wallet-core/src/base/` |
| `src/wallet/logger/` — **pure interfaces only** (see below) | `packages/wallet-core/src/logger/` |

### Utils safe list (wallet/utils/)

Only these files are pure enough to move to wallet-core:

| File | Status |
|---|---|
| `arrays.ts` | ✅ move |
| `errors.ts` | ✅ move (pure) |
| `event-handler.ts` | ✅ move |
| `lock.ts` | ✅ move |
| `mnemonic.ts` | ✅ move (BIP39 wordlist is inlined — no external dep) |
| `queue.ts` | ✅ move |
| `random.ts` | ✅ move |
| `rw-guard.ts` | ✅ move |
| `serialization.ts` | ✅ move |
| `sleep.ts` | ✅ move |
| `fn.ts` | ❌ stays in extension → moves to `@nulo/aztec-runtime` in M3.4 (Aztec deps: `@aztec/foundation`, `@aztec/stdlib`, `@/wallet/services/account/contracts`, `@/wallet/services/pxe/proxy`) |
| `fetch.ts` | ❌ stays in extension → `@nulo/aztec-runtime` in M3.4 (`@aztec/foundation/*`) |
| `auth-registry.ts` | ❌ stays in extension → `@nulo/aztec-runtime` in M3.4 (Aztec deps) |
| `fee-juice.ts` | ❌ stays in extension (Aztec deps + extension internal imports) |
| `schemas.ts` | ❌ stays in extension → `@nulo/aztec-runtime` in M3.4 (Aztec deps) |
| `caip.ts` | ❌ stays in extension (imports from `@/wallet/services/dapp-interaction/spec`) |
| `offscreen.ts` | ❌ stays in extension (`chrome.runtime`, `chrome.offscreen`) |

### Storage files

**NOT moving to wallet-core:**
- `simple_storage.ts` — uses `chrome.storage.StorageArea` as a direct typed field, no injected-port alternative. Stays in `@nulo/extension`.
- `StorageType` enum — stays in `@nulo/extension` to avoid chrome dep leak.

**Moving to wallet-core (purified):**
- `entity_storage.ts` — remove the `StorageType | StorageArea` union ctor. Keep ONLY the injected `StorageArea` ctor. The `chrome.storage.*` branch is removed.
- `value-storage.ts` — same purification.

Callers using the legacy `StorageType.*` form must be migrated (see section 5 below).

### Base files

**NOT moving in M3.1:**
- `src/wallet/base/utils.ts` — wrapParams/unwrapParams. Stays in extension during M3.1, moves to `@nulo/extension-messaging` in M3.3. **Do not move this in M3.1.**
- `src/wallet/base/background/` — Service/ServiceClient base classes → M3.3
- `src/wallet/base/offscreen/` — same → M3.3
- `src/wallet/base/errors.ts` — WalletError → M3.3
- `src/wallet/base/zod-helpers.ts` — Zod helpers → M3.3
- `src/wallet/base/messages.ts` — RPC message types → M3.3

### Logger files

`src/wallet/logger/index.ts` line 3 is `export * from "./store"` — `LoggerStore` uses `chrome.storage.session` directly. The whole `index.ts` cannot move as-is.

**Fix**: Create `packages/wallet-core/src/logger/interfaces.ts` with only the pure parts extracted from `logger/index.ts`:
```ts
// packages/wallet-core/src/logger/interfaces.ts
import type { EventHandler } from "../utils/event-handler"

export enum LogLevel { Debug = 0, Info = 1, Warn = 2, Error = 3 }
export type LogContext = "sw" | "offscreen" | "popup" | "content"
export type Log = { id: number; timestamp: number; source: string; level: LogLevel; context?: LogContext; data: unknown[] }
export interface ILogger { log(source: string, level: LogLevel, ...data: unknown[]): void }
export interface ILoggerStore extends ILogger { onLog: EventHandler<Log>; get(count: number, fromId?: number): Log[]; clear(): void }
export const consoleMethods: [string, LogLevel][] = [
  ["trace", LogLevel.Debug], ["debug", LogLevel.Debug], ["log", LogLevel.Info],
  ["info", LogLevel.Info], ["warn", LogLevel.Warn], ["error", LogLevel.Error],
]
```

Extension's `src/wallet/logger/index.ts` is updated to re-export from wallet-core:
```ts
// extension's logger/index.ts (after M3.1)
export * from "@nulo/wallet-core/logger"
export * from "./store"
export * from "./utils"
```

`store.ts` and `utils.ts` stay in extension.

**NOT in wallet-core:**
- `src/core/adapters/` — Chrome adapter implementations → remain in `@nulo/extension`
- `src/wallet/config/` — reaches chrome.storage → remains in extension

## New package scaffold

### `packages/wallet-core/package.json`
```json
{
  "name": "@nulo/wallet-core",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./ports": "./src/ports/index.ts",
    "./testing": "./src/testing/index.ts",
    "./storage": "./src/storage/index.ts",
    "./utils": "./src/utils/index.ts",
    "./base": "./src/base/index.ts",
    "./logger": "./src/logger/interfaces.ts"
  },
  "devDependencies": {
    "vitest": "^3.2.4",
    "jsdom": "^26.1.0"
  }
}
```

### `packages/wallet-core/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "lib": ["ESNext", "DOM", "WebWorker"],
    "types": [],
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

`"types": []` — no chrome-types. Any accidental `chrome.*` usage in wallet-core fails `tsc --noEmit`. This is the primary boundary enforcement mechanism.

### `packages/wallet-core/vitest.config.ts`
```ts
import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
  },
})
```

### `packages/wallet-core/src/index.ts`
```ts
export * from "./ports/index.js"
export * from "./base/index.js"
export * from "./storage/index.js"
export * from "./utils/index.js"
export * from "./logger/interfaces.js"
// testing NOT re-exported from root
```

## Changes in `@nulo/extension`

### 1. Update `package.json`
```json
{
  "dependencies": {
    "@nulo/wallet-core": "workspace:*"
  }
}
```

### 2. Update `tsconfig.json`
```json
{
  "compilerOptions": {
    "paths": {
      "@nulo/wallet-core": ["../../wallet-core/src/index.ts"],
      "@nulo/wallet-core/*": ["../../wallet-core/src/*"]
    }
  }
}
```

### 3. Update `vitest.config.ts`

Add alias AND define block (fixes `__VERSION__ is not defined` in tests):
```ts
resolve: {
  alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    "@nulo/wallet-core": fileURLToPath(new URL("../wallet-core/src/index.ts", import.meta.url)),
  },
},
define: {
  __VERSION__: '"0.0.0-test"',
  __SENTINEL__: '"test"',
  __AZTEC_VERSION__: '"0.0.0-test"',
  __NAME__: '"test"',
  __DISPLAY_NAME__: '"test"',
},
```

### 4. Import migrations in extension source files

| Old import | New import |
|---|---|
| `from "@/core/ports"` | `from "@nulo/wallet-core/ports"` |
| `from "@/core/ports/clock-port"` | `from "@nulo/wallet-core/ports"` |
| `from "@/core/testing"` | `from "@nulo/wallet-core/testing"` |
| `from "@/wallet/utils/arrays"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils/errors"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils/event-handler"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils/lock"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils/mnemonic"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils/queue"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils/random"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils/rw-guard"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils/serialization"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils/sleep"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils"` (barrel — only if importing moved symbols) | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/storage"` | `from "@nulo/wallet-core/storage"` |
| `from "@/wallet/base"` (ServiceCollection, IService, etc.) | `from "@nulo/wallet-core/base"` |
| `from "@/wallet/logger"` (ILogger, LogLevel, etc.) | `from "@nulo/wallet-core/logger"` |

Note: `from "@/wallet/utils"` barrel imports that reference ONLY moved files → `@nulo/wallet-core/utils`. Imports of `fn.ts`, `offscreen.ts`, `caip.ts`, `fetch.ts`, `auth-registry.ts`, `schemas.ts`, `fee-juice.ts` keep their `@/wallet/utils/...` paths.

Estimate: ~60-80 files. Use find+sed for mechanical renames, typecheck to catch stragglers.

### 5. StorageType migration (Option A — remove legacy ctor)

Remove the `StorageType | StorageArea` union from `EntityStorage` and `ValueStorage`. The `StorageType` enum stays in `@nulo/extension`'s storage/index.ts but is NOT exported from wallet-core.

All callers using `StorageType.*` must pass the explicit `StorageArea`:

| Caller | Old | New |
|---|---|---|
| `src/wallet/services/auth-registry/service.ts` | `StorageType.Local` | `browserApi.storage.local` |
| `src/wallet/services/account/service.ts` | `StorageType.Local` | `browserApi.storage.local` |
| `src/wallet/services/contact/service.ts` | `StorageType.Local` | `browserApi.storage.local` |
| `src/wallet/services/dapp-session/service.ts` | `StorageType.Local` | `browserApi.storage.local` |
| `src/wallet/services/fpc/service.ts` | `StorageType.Local` | `browserApi.storage.local` |
| `src/wallet/services/network/service.ts` | `StorageType.Local` | `browserApi.storage.local` |
| `src/wallet/services/token/service.ts` | `StorageType.Local` | `browserApi.storage.local` |
| `src/wallet/services/transaction/service.ts` | `StorageType.Local` | `browserApi.storage.local` |
| `src/wallet/services/profile/repository.ts` | `StorageType.Local` | `browserApi.storage.local` |
| `src/wallet/services/profile/session-manager.ts` | `StorageType.Session` | `browserApi.storage.session` |
| `src/wallet/services/operation-journal/service.ts` | `StorageType.Session` | `browserApi.storage.session` |
| `src/wallet/services/token-balance/balance-repository.ts` | `StorageType.Local` | `browserApi.storage.local` |
| `src/wallet/config/store.ts` | `StorageType.Local` | `browserApi.storage.local` (pass `browserApi` via `ConfigStore` constructor) |

All service files already have `browserApi` available via composition root (`runtime.ts`). `ConfigStore` needs browserApi passed to its constructor.

## Test strategy

Tests for files moving to wallet-core:
- `fake-browser-api.test.ts` — moves with `src/core/testing/`
- `mock-clock.test.ts` — moves with it
- `serialization.test.ts` — moves with `serialization.ts`
- `rw-guard.test.ts` — moves with `rw-guard.ts`
- `mnemonic.test.ts` — moves with `mnemonic.ts`
- `topology.test.ts` — moves with `topology.ts`

**New tests to write** (see `implementations-plan/M3/testing-plan.md` — M3.1 section for full code):

| New test file | Invariants locked |
|---|---|
| `packages/wallet-core/src/utils/lock.test.ts` | Sequential access, FIFO ordering, force-release timer, leave()-before-enter() no-op |
| `packages/wallet-core/src/utils/queue.test.ts` | FIFO, dedup by key, priorityPass (promote + insert + already-at-front, **asserting value replacement**), dequeueBatch (normal + oversize + empty), dequeue empty → undefined, clear resets key set |
| `packages/wallet-core/src/utils/event-handler.test.ts` | invoke, add idempotent, remove, remove-never-added no-op, error isolation (throwing cb fires + subsequent cbs still run) |
| `packages/wallet-core/src/utils/arrays.test.ts` | array_equals (same/diff/length/empty), array_max (empty/single/middle/all-negative quirk), hasIntersectionByKeys (match/no-match/multi-key/empty/bigint) |
| `packages/wallet-core/src/storage/entity_storage.test.ts` | set/get round-trip, contains (set/miss/delete), getAll, getKeys (`root@` prefix stripped), cross-namespace isolation, findByPredicate, getVersion/setVersion |
| `packages/wallet-core/src/storage/value-storage.test.ts` | get undefined when unset, set/get for primitives + objects, delete, cross-namespace isolation |

After migration, run `bun run test` in `packages/wallet-core/` — all tests must pass without extension deps.

## Verification cadence

**Step 0a (pre-extraction refactor — decouple Node globals from moving files)**: Files moving to wallet-core currently rely on Node globals that are present in the extension only because `@aztec/*` transitively pulls in `@types/node`. Wallet-core has no Aztec deps, so `"types": []` rejects `Buffer` and `NodeJS.Timeout`. Fix BEFORE moving:
- `lock.ts:12` — `NodeJS.Timeout` → `ReturnType<typeof setTimeout>`
- `random.ts:2` — add `import { Buffer } from "buffer"` at top (or refactor to a small local hex helper built on `Uint8Array`)
- `serialization.ts:6-8` — same Buffer import
- `mnemonic.test.ts` (lines using `Buffer.from`) — same Buffer import
- (In M3.3 pre-refactor: `base/offscreen/client.ts:20` — same `NodeJS.Timeout` fix)
- (In M3.2 pre-refactor: `passkey/credential.ts:25`, `password-secret-box.ts:127` — same Buffer import)

Add `"buffer": "^6.0.3"` to wallet-core devDependencies (or the root if hoisted). The `buffer` npm package is the standard browser-compatible Buffer polyfill; explicit import replaces the global-by-@types/node-transitive-pollution pattern. Verify with a scratch `tsc -p` run using `"types": []` before the extraction PR.

**Step 0b (pre-extraction)**: Write `entity_storage.test.ts` + `value-storage.test.ts` against the CURRENT (pre-purification) code, run them, confirm they pass. This locks the contract before the refactor. They sit temporarily at `src/wallet/storage/*.test.ts` alongside the source.

1. Create `packages/wallet-core/`, scaffold package.json + tsconfig + vitest config
2. Move files (one directory at a time: ports/ → testing/ → utils safe list → storage/ → base/ → logger interfaces): commit after each dir. `entity_storage.test.ts` and `value-storage.test.ts` move with their sources.
3. Purify EntityStorage/ValueStorage (remove StorageType ctor branch). Storage tests MUST still pass — they're the regression guard.
4. Update extension imports (mechanical search-replace + typecheck)
5. Migrate StorageType callers (~13 files)
6. Add `define` block to extension's vitest.config.ts
7. `bun run typecheck` in wallet-core — zero errors
8. `bun run test` in wallet-core — tests pass (including new lock/queue/event-handler/arrays/entity_storage/value-storage)
9. `bun run typecheck` in extension — zero errors
10. `bun run test` in extension — no regressions
11. `bun run build` — clean build
12. Chrome smoke: unlock → home page → tokens (no behavior change expected)

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **Import cascade**: ~80 files need updating → merge conflicts if on a branch with UI work | MED | Land M3.1 on a clean master branch; purely mechanical PR |
| 2 | **StorageType migration**: 13 callers need browserApi injection | MED | All already have browserApi via runtime; ConfigStore gets ctor injection |
| 3 | **`chrome-types` leaking into wallet-core**: vitest picks up wrong tsconfig | LOW | wallet-core has its own tsconfig with `"types": []` |
| 4 | **Storage purification regressions**: `entity_storage.ts` and `value-storage.ts` currently have zero unit test coverage; M3.1 removes the `StorageType | StorageArea` union ctor and re-routes 13 callers | MED | Add `entity_storage.test.ts` + `value-storage.test.ts` BEFORE purification (put/get/getAll/getKeys/findByPredicate round-trip + JSON serialize edge cases + key-scoping via the `root@id` prefix). Uses `FakeBrowserApi` (already in `src/core/testing/`). See testing-plan.md for code. ~1-2h work, covers an untested refactor |
| 5 | **`fn.ts` still at `@/wallet/utils/fn`**: imports after extraction via barrel may need care | LOW | fn.ts stays in extension; barrel (`@/wallet/utils`) re-exports it alongside the new package exports |
| 6 | **logger re-export chain**: if store.ts imports from index.ts circularly | LOW | Restructure: index.ts re-exports from wallet-core + store + utils; no circular path |

## Size estimate

~1 week:
- 2 days: scaffold + file moves + storage purification
- 1 day: StorageType migration (~13 files) + logger interfaces extraction
- 1 day: typecheck + vitest fixes + `define` block
- 1 day: build verification + Chrome smoke test
