# M3.3 — Extract `@nulo/extension-messaging` (~4-5 days)

## Context & prerequisite

Prerequisites: **M3.1** done. M3.2 is independent of M3.3 (crypto and messaging have no overlap); they can proceed in parallel after M3.1 lands.

`@nulo/extension-messaging` captures the Chrome extension RPC layer: the `Service<T>` + `ServiceClient<T>` base classes, message envelopes, structured error types, and the topological startup machinery. Any Chrome extension (or webextension-polyfill compatible add-on) that wants typed RPC between background and popup can depend on this package.

## What goes in `@nulo/extension-messaging`

| Source tree (current) | Moves to |
|---|---|
| `src/wallet/base/background/service.ts` — `Service<T>` base class | `packages/extension-messaging/src/background/service.ts` |
| `src/wallet/base/background/client.ts` — `ServiceClient<T>` base class | `packages/extension-messaging/src/background/client.ts` |
| `src/wallet/base/background/index.ts` | `packages/extension-messaging/src/background/index.ts` |
| `src/wallet/base/offscreen/service.ts` — `OffscreenService` base | `packages/extension-messaging/src/offscreen/service.ts` |
| `src/wallet/base/offscreen/client.ts` — `OffscreenServiceClient` base | `packages/extension-messaging/src/offscreen/client.ts` |
| `src/wallet/base/offscreen/messages.ts` — offscreen message protocol | `packages/extension-messaging/src/offscreen/messages.ts` |
| `src/wallet/base/offscreen/index.ts` | `packages/extension-messaging/src/offscreen/index.ts` |
| `src/wallet/base/errors.ts` — WalletError hierarchy | `packages/extension-messaging/src/errors.ts` |
| `src/wallet/base/messages.ts` — MessageType + message type definitions | `packages/extension-messaging/src/messages.ts` |
| `src/wallet/base/zod-helpers.ts` — Zod validation helpers | `packages/extension-messaging/src/zod-helpers.ts` |

**What stays in `@nulo/wallet-core` (after M3.1):**
- `src/wallet/base/index.ts` — ServiceCollection, IService, MethodsMap, EventsMap (moved in M3.1)
- `src/wallet/base/topology.ts` — topological sort (moved in M3.1)
- `src/wallet/base/utils.ts` — wrapParams/unwrapParams (moves HERE in M3.3 — belongs in messaging)

Wait — `utils.ts` (wrapParams/unwrapParams) is used by both Service and ServiceClient. It's messaging-specific. Move it to extension-messaging in M3.3, NOT wallet-core in M3.1. **Revise M3.1 accordingly**: `src/wallet/base/utils.ts` stays in extension during M3.1 and moves to extension-messaging in M3.3.

## Chrome dependency surface

`Service<T>` uses:
- `chrome.runtime.onConnect` (line: registers `onConnect` listener in ctor)
- `chrome.runtime.Port` (type used in `onConnect`, `onDisconnect`, `onMessage`)
- `client.postMessage()` on Port

`ServiceClient<T>` uses:
- `chrome.runtime.connect({ name: service })` — creates the port
- `chrome.runtime.Port` type

`OffscreenService` / `OffscreenServiceClient` use:
- `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`

These must be available at runtime. In tests, `@webext-core/fake-browser` provides them. In the package itself, the types come from `chrome-types` (type-only, no runtime dep).

**webextension-polyfill**: The extension uses `webextension-polyfill` for Firefox compatibility. `Service<T>` currently accesses `chrome.*` directly. The polyfill is not strictly needed in the package itself (the ext's entry points import it and shim the global). Keep using `chrome.*` directly in extension-messaging; the polyfill import in `wallet/index.ts` + popup `app.vue` continues to provide the shim globally.

## New package scaffold

### `packages/extension-messaging/package.json`
```json
{
  "name": "@nulo/extension-messaging",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./background": "./src/background/index.ts",
    "./offscreen": "./src/offscreen/index.ts",
    "./errors": "./src/errors.ts",
    "./messages": "./src/messages.ts",
    "./zod": "./src/zod-helpers.ts"
  },
  "dependencies": {
    "@nulo/wallet-core": "workspace:*"
  },
  "peerDependencies": {
    "zod": "^3.23.8"
  },
  "peerDependenciesMeta": {
    "zod": { "optional": true }
  },
  "devDependencies": {
    "@webext-core/fake-browser": "^1.3.4",
    "vitest": "^3.2.4",
    "jsdom": "^26.1.0",
    "chrome-types": "^0.1.370",
    "zod": "^3.23.8"
  }
}
```

### `packages/extension-messaging/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "lib": ["ESNext", "DOM"],
    "types": ["chrome-types"],
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

`"types": ["chrome-types"]` — makes `chrome.*` types available without requiring the runtime global. Tests provide the `chrome` global via `@webext-core/fake-browser`.

### `packages/extension-messaging/vitest.config.ts`
```ts
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/testing/setup.ts"],
  },
})
```

`setup.ts` installs `@webext-core/fake-browser` to provide `chrome.*` globals in test.

### `packages/extension-messaging/src/testing/setup.ts`
```ts
import { fakeBrowser } from "@webext-core/fake-browser"
beforeEach(() => fakeBrowser.reset())
```

### `packages/extension-messaging/src/index.ts`
```ts
export * from "./background/index.js"
export * from "./offscreen/index.js"
export * from "./errors.js"
export * from "./messages.js"
// zod-helpers NOT re-exported from root — consumers import from "@nulo/extension-messaging/zod"
```

Consumers that need Zod validation: `import { validateParams, validateResult } from "@nulo/extension-messaging/zod"`. This keeps `zod` optional for consumers that only need the transport layer.

## Changes in `@nulo/extension`

### `package.json`
```json
{
  "dependencies": {
    "@nulo/wallet-core": "workspace:*",
    "@nulo/wallet-crypto": "workspace:*",
    "@nulo/extension-messaging": "workspace:*"
  }
}
```

### Import migrations in extension

Every service file imports from `@/wallet/base` or its sub-paths:

| Old import | New import |
|---|---|
| `from "@/wallet/base"` (ServiceCollection, IService, etc.) | `from "@nulo/wallet-core/base"` |
| `from "@/wallet/base/background"` | `from "@nulo/extension-messaging/background"` |
| `from "@/wallet/base/background/service"` | `from "@nulo/extension-messaging/background"` |
| `from "@/wallet/base/background/client"` | `from "@nulo/extension-messaging/background"` |
| `from "@/wallet/base/offscreen"` | `from "@nulo/extension-messaging/offscreen"` |
| `from "@/wallet/base/errors"` | `from "@nulo/extension-messaging/errors"` |
| `from "@/wallet/base/messages"` | `from "@nulo/extension-messaging/messages"` |
| `from "@/wallet/base/zod-helpers"` | `from "@nulo/extension-messaging/zod"` |
| `from "@/wallet/base/utils"` | `from "@nulo/extension-messaging"` (utils.ts barrel) |

Affected files: every `service.ts` + `client.ts` pair (~25 service pairs) + `wallet/base/index.ts` + any file that imports errors or messages directly.

Estimate: ~60 files.

## Existing tests to migrate

The `Service<T>` and `ServiceClient<T>` don't have standalone unit tests today (they're exercised indirectly via service tests in the extension). No tests to move.

If unit tests for Service base are written as part of M5.3, they'll belong in `packages/extension-messaging/src/background/service.test.ts`.

The `topology.test.ts` (if it exists) stays in wallet-core.

## `utils.ts` (wrapParams/unwrapParams) placement

**Correction from M3.1 plan**: `src/wallet/base/utils.ts` was listed as moving to wallet-core in M3.1. It should NOT move there — it's messaging-specific (serializes RPC params). **Revised M3.1 plan** leaves it in extension during M3.1. **M3.3 moves it to extension-messaging**.

In `packages/extension-messaging/src/utils.ts`:
```ts
/** Serialize method params for the chrome.runtime.Port RPC wire format. */
export function wrapParams(params: unknown[]): Record<string, unknown> { ... }
export function unwrapParams(wrapped: Record<string, unknown>): unknown[] { ... }
```

## Zod integration

`src/wallet/base/zod-helpers.ts` provides `validatedMethod` and related utilities for adding runtime Zod validation at the RPC boundary (M1-RT deliverable). Moving it to extension-messaging is natural — it's part of the RPC layer.

The pilot Zod validation on NetworkService (from M1-RT) uses `@/wallet/base/zod-helpers`. After M3.3, this becomes `@nulo/extension-messaging/zod`. Consumers that don't need validation do not need to install `zod` at all.

## Boundary enforcement

Add to the dependency-cruiser config started in M3.1:
- `@nulo/extension-messaging` must NOT import from `@nulo/extension` or `@nulo/wallet-crypto` or `@nulo/aztec-runtime`
- `@nulo/extension-messaging` MAY import from `@nulo/wallet-core`

## Pre-extraction refactor (Step 0)

`base/offscreen/client.ts:20` uses `NodeJS.Timeout` type (`Map<number, NodeJS.Timeout>`). Extension-messaging's tsconfig will NOT have `@types/node` (it has `"types": ["chrome-types"]`). Before moving: replace `NodeJS.Timeout` with `ReturnType<typeof setTimeout>` — browser/node-portable, resolves to `number` in the DOM lib. Same change may also be needed in `base/background/service.ts` or `client.ts` if they use similar types — grep before moving.

Also: grep `base/` directory for `Buffer` usage. If any `wrapParams`-adjacent file uses Buffer, add `import { Buffer } from "buffer"` before moving.

## Test strategy

**Tests that move with source** (already solid, move to extension-messaging):
- `wallet/base/errors.test.ts` — WalletError hierarchy, round-trip, unknown code fallback
- `wallet/base/zod-helpers.test.ts` — validateParams/validateResult
- `wallet/base/background/client.test.ts` — ServiceClient connect/call/event cycle
- `wallet/base/offscreen/client.test.ts` — OffscreenServiceClient message round-trip

**New test to write** (see `implementations-plan/M3/testing-plan.md` — M3.3 section for full code):

`packages/extension-messaging/src/utils.test.ts` — `wrapParams`/`unwrapParams` round-trip for: single element, multiple primitives, undefined holes, empty array, nested objects. This is the RPC wire serialization invariant — silent drift here corrupts all method params with no type error.

**Regression check**: run full `bun run test` in extension after migrations. All service-level tests must pass.

## Verification cadence

1. Scaffold `packages/extension-messaging/`
2. Move files in order: errors.ts → messages.ts → utils.ts → background/ → offscreen/ → zod-helpers.ts
3. Update extension imports (search-replace + typecheck)
4. `bun run typecheck` in both packages — zero errors
5. `bun run test` in extension — all service tests pass
6. `bun run build` — clean build
7. Chrome smoke: connect a dApp, send a transaction (exercises full RPC stack)

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **`chrome.runtime.*` in tests without fake-browser**: Service base uses chrome.runtime in ctor | MED | extension-messaging's vitest setup installs fake-browser; extension tests already have this via their own setup |
| 2 | **`utils.ts` M3.1/M3.3 sequencing**: if M3.1 moved it to wallet-core, M3.3 must move it again | LOW | Revised M3.1 explicitly leaves utils.ts in extension; M3.3 finalizes the move |
| 3 | **Zod version mismatch**: extension and extension-messaging both depend on Zod | LOW | Both pin `^3.23.8`; Bun workspace deduplication ensures one version |
| 4 | **25 service pairs need import updates**: high volume, risk of missing one | MED | Use `grep -r "from \"@/wallet/base"` to enumerate all occurrences; typecheck catches misses |
| 5 | **`WalletError` re-export surface**: some popup code imports WalletError directly from `@/wallet/base/errors`; popup code can't import from extension-messaging without the package being listed in extension's deps | LOW | Extension already lists extension-messaging as dep; popup can import from `@nulo/extension-messaging/errors` |

## Size estimate

4-5 days:
- 1 day: scaffold + file moves (errors, messages, utils, background, offscreen, zod)
- 1.5 days: import migration across ~60 files
- 0.5 day: typecheck + vitest setup
- 1 day: build verification + Chrome smoke test
- 0.5 day: boundary enforcement update
