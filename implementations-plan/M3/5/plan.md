# M3.5 — Extract `@nulo/wallet-bridge` (~4-5 days)

## Context & prerequisite

Prerequisites: **M3.1 + M3.3** done (wallet-core + extension-messaging).

`@nulo/wallet-bridge` is the facade layer that adapts the `@aztec/wallet-sdk` protocol (discovery, key exchange, encrypted-channel message routing) to Nulo's internal service graph. It's smaller than aztec-runtime and has no WASM — just protocol logic and dispatch routing.

M3.5 can proceed in parallel with M3.4 after M3.1 + M3.3 land, since wallet-bridge does not depend on aztec-runtime.

## What goes in `@nulo/wallet-bridge`

| Source tree (current) | Moves to |
|---|---|
| `src/wallet/services/wallet-sdk/capability-map.ts` | `packages/wallet-bridge/src/capability-map.ts` |
| `src/wallet/services/wallet-sdk/discovery-queue.ts` | `packages/wallet-bridge/src/discovery-queue.ts` |
| `src/wallet/services/wallet-sdk/dispatcher.ts` | `packages/wallet-bridge/src/dispatcher.ts` |
| `src/wallet/services/wallet-sdk/scope-enforcement.ts` | `packages/wallet-bridge/src/scope-enforcement.ts` |
| `src/wallet/services/wallet-sdk/types.ts` | `packages/wallet-bridge/src/types.ts` |
| `src/wallet/services/rpc/types.ts` | `packages/wallet-bridge/src/rpc/types.ts` |
| `src/wallet/services/rpc/utils.ts` | `packages/wallet-bridge/src/rpc/utils.ts` |

**Stays in `@nulo/extension`:**
- `src/wallet/services/wallet-sdk/background.ts` — value-imports 6 concrete service classes (`NetworkService`, `AccountService`, `ExecutionService`, `ProfileService`, `DappInteractionService`, `DappSessionService`) via `.name` property for `services.get(ClassName.name)`. Moving to wallet-bridge creates a circular workspace dep. `initWalletSdkHandler` stays in extension as the wiring point.
- `src/content-script/content.ts` — content-script relay; thin glue that stays in extension
- All service implementations — bridge receives them via DI through `ServiceCollection`

## Architecture invariants preserved

- `BackgroundConnectionHandler` from `@aztec/wallet-sdk` is the entry point; wallet-bridge owns the dispatcher/scope-enforcement layer.
- `initWalletSdkHandler(services, logger)` stays in `@nulo/extension`'s `background.ts` (it's the wiring point that knows about concrete service classes). It is NOT exported from wallet-bridge. `runtime.ts` continues to import it from `@/wallet/services/wallet-sdk/background`.
- Service references at runtime are obtained via `ServiceCollection` (DI). But at **COMPILE TIME** the dispatcher still type-imports concrete service classes (see Pre-extraction refactor below). Earlier drafts of this plan understated the compile-time surface — the earlier "no concrete imports" claim was incorrect.
- `CAIP` utilities in `dispatcher.ts` (if any) — the dispatcher uses `parseCaipAccount`, `parseCaipChain`, `resolveNetworkByChainId`. These currently live in `@/wallet/utils/caip`. After M3.1, `caip.ts` STAYS in extension (not wallet-core — it imports from `@/wallet/services/dapp-interaction/spec`). So wallet-bridge cannot import from extension's caip. See pre-refactor step below.

## ⚠ Pre-extraction refactor (Step 0) — decouple dispatcher + scope-enforcement from extension

Codex audit of `dispatcher.ts` lines 43-66 found these extension-internal imports that must be resolved before the extraction PR lands:

**In `dispatcher.ts`:**
- Line 43: `type { NetworkService, Network }` from `@/wallet/services/network/service`
- Line 44: `type { AccountService, Account }` from `@/wallet/services/account/service`
- Lines 45-56: `type { ExecutionService, Operation, OperationResult, ... }` from `@/wallet/services/execution/service` (12 type imports)
- Line 57: `type { ProfileService }` from `@/wallet/services/profile/service`
- Line 58: `type { DappInteractionService, ExecutionResult }` from `@/wallet/services/dapp-interaction/service`
- Line 59: `type { DappSessionService }` from `@/wallet/services/dapp-session/service`
- Line 60: `{ OriginType, type LocalTxOrigin }` from `@/wallet/services/transaction/service` (value + type)
- Line 61: `type { Capability, DappSession, GrantedCapabilityRecord, RejectedCapabilityRecord }` from `@/wallet/services/dapp-session/spec`
- Line 62: `type { AztecSendTxRequest }` from `@/wallet/services/dapp-interaction/spec`
- Line 64: `{ formatCaipAccount, formatCaipChain, parseCaipAccount, resolveNetworkByChainId }` from `@/wallet/utils/caip`
- Line 66: `{ isNoFromRequest }` from `@/wallet/services/execution/utils/fee-detection`

**In `scope-enforcement.ts`:**
- Lines 13-23: capability type imports (`GrantedCapabilityRecord`, `Scope`, `ScopePattern`, `AccountsCapability`, etc.) from `../dapp-session/spec`

**Resolution strategy** — extract the capability/session type model into a shared boundary, then rewrite dispatcher to depend ONLY on structural interfaces:

1. **Extract capability + session types to wallet-bridge** (new location — these belong to the wallet-sdk protocol layer):
   - Move `packages/extension/src/wallet/services/dapp-session/spec.ts` capability-related types (`Capability`, `ScopePattern`, `GrantedCapabilityRecord`, per-type capability interfaces) to `packages/wallet-bridge/src/capabilities.ts`.
   - Extension's `dapp-session/spec.ts` re-exports them from `@nulo/wallet-bridge` for existing consumers.

2. **Pull CAIP helpers into wallet-bridge or wallet-core**: `caip.ts` currently stays in extension because it imports from dapp-interaction/spec. Option A: move the small AztecSendTxRequest shape into wallet-bridge too, freeing caip.ts to move to wallet-core. Option B: inline the 4 CAIP helpers into wallet-bridge. **Recommendation: Option B** (smaller blast radius).

3. **Replace concrete service imports with structural `IDispatcherServices` interface in wallet-bridge**:
   ```ts
   // packages/wallet-bridge/src/services.ts
   export interface IDispatcherServices {
     network: { getById(id: string): NetworkInfo | undefined; ... }
     account: { getAccount(address: string): AccountInfo | undefined; ... }
     execution: { executeOperations(ops: Operation[]): Promise<OperationResult[]> }
     // ... minimal surface the dispatcher actually calls
   }
   ```
   The dispatcher depends on `IDispatcherServices` only. Extension's `initWalletSdkHandler` wires real services to the interface — structural typing does the rest.

4. **Execution Operation types are the hardest part**: dispatcher imports 12 Operation types from execution/service. Either:
   - (a) Move the Operation type definitions (pure types, no runtime) to wallet-bridge or a shared types module
   - (b) Keep Operation types in extension and have dispatcher consume them via a typed callback interface

   **Recommendation**: (a). Extract `packages/extension/src/wallet/services/execution/operation-types.ts` (or similar) and move to wallet-bridge as `operations.ts`. Extension's execution/service.ts re-exports for backward compat.

5. **`isNoFromRequest` from execution/utils/fee-detection**: small pure helper. Either move to wallet-bridge or inline in dispatcher.

**Do this pre-refactor as a standalone PR BEFORE M3.5 extraction.** Verify extension still builds + tests pass after the refactor. Then M3.5 is a pure file-move.

Size: ~1-2 days for the pre-refactor. Bumps M3.5 total to ~6-7 days.

## `version` from `package.json`

`src/wallet/services/rpc/types.ts` does:
```ts
import packageJson from "../../../../package.json"
const { version } = packageJson
```

After moving to `packages/wallet-bridge/src/rpc/types.ts`, the relative path would be `../../package.json` — wallet-bridge's own package.json. But the version we want is the EXTENSION's version (the user-facing wallet version). 

**Options:**
1. Import from extension's package.json by going up: `../../../../extension/package.json` — fragile path.
2. Pass version as a parameter to `NuloWalletInfo`'s factory.
3. Move `NuloWalletInfo` construction into `runtime.ts` (extension-side), pass it as a dep to `initWalletSdkHandler`.
4. Use `__VERSION__` define (already set in vite config: `define: { __VERSION__: ... }`).

**Decision: Option 4** — replace `packageJson.version` with `__VERSION__` (a Vite compile-time define). The extension's `vite.config.ts` already sets this. `wallet-bridge/src/rpc/types.ts` uses `declare const __VERSION__: string` and accesses `__VERSION__` directly. Zero path gymnastics.

```ts
// packages/wallet-bridge/src/rpc/types.ts
declare const __VERSION__: string
export const NuloWalletInfo = {
  name: "Nulo",
  // ...
  version: __VERSION__,
}
```

The `viteStaticCopy` and other vite plugins continue to run in the extension's build context; the `__VERSION__` define is injected at that build time. No per-package build step needed.

## New package scaffold

### `packages/wallet-bridge/package.json`
```json
{
  "name": "@nulo/wallet-bridge",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./rpc": "./src/rpc/index.ts"
  },
  "dependencies": {
    "@nulo/wallet-core": "workspace:*",
    "@nulo/extension-messaging": "workspace:*",
    "@aztec/wallet-sdk": "4.2.0-nightly.20260413",
    "@aztec/stdlib": "4.2.0-nightly.20260413",
    "@aztec/foundation": "4.2.0-nightly.20260413"
  },
  "devDependencies": {
    "@webext-core/fake-browser": "^1.3.4",
    "vitest": "^3.2.4",
    "jsdom": "^26.1.0",
    "chrome-types": "^0.1.370"
  }
}
```

### `packages/wallet-bridge/tsconfig.json`
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
  }
}
```

### `packages/wallet-bridge/src/index.ts`
```ts
// background.ts stays in extension — initWalletSdkHandler is NOT exported from wallet-bridge
export * from "./types.js"
export * from "./rpc/types.js"
```

### `packages/wallet-bridge/vitest.config.ts`
```ts
import { defineConfig } from "vitest/config"
export default defineConfig({
  define: {
    __VERSION__: '"0.0.0-test"',
  },
  test: {
    globals: true,
    environment: "jsdom",
  },
})
```

## `__VERSION__` substitution in moved files

Both `rpc/types.ts` AND `dispatcher.ts` import `packageJson.version`. After moving to wallet-bridge, replace all `packageJson.version` usages with `__VERSION__`:

- `packages/wallet-bridge/src/rpc/types.ts` — replace `packageJson.version` with `__VERSION__`
- `packages/wallet-bridge/src/dispatcher.ts` — replace all 3 occurrences (lines ~364, ~392, ~489 in the original source)
- Add `declare const __VERSION__: string` at the top of each file that uses it

## Changes in `@nulo/extension`

### `package.json`
```json
{
  "dependencies": {
    "@nulo/wallet-core": "workspace:*",
    "@nulo/wallet-crypto": "workspace:*",
    "@nulo/extension-messaging": "workspace:*",
    "@nulo/aztec-runtime": "workspace:*",
    "@nulo/wallet-bridge": "workspace:*"
  }
}
```

### `runtime.ts` — no change needed
`runtime.ts` continues to import `initWalletSdkHandler` from `@/wallet/services/wallet-sdk/background` (which stays in extension). No import update needed for this file.

### Import migrations in extension

Affected files (~2-4):
- `src/wallet/index.ts` — if it imports rpc types
- Any file importing `NuloWalletInfo` from `@/wallet/services/rpc/types`

| Old import | New import |
|---|---|
| `from "@/wallet/services/rpc/types"` | `from "@nulo/wallet-bridge/rpc"` |

Note: `from "@/wallet/services/wallet-sdk/background"` is NOT migrated — background.ts stays in extension.

## `scope-enforcement.ts` — M0.1 incomplete item

The architecture plan (M0.1) noted that `createAuthWit` scope enforcement in `scope-enforcement.ts:192-204` was incomplete. M0.1 was listed as a security patch. **Check status before M3.5**: if the scope enforcement gap still exists, M3.5 is an opportunity to fix it while moving the file. If already fixed by an earlier commit, no action needed.

**Action**: `grep -n "192\|TODO\|FIXME\|scope" src/wallet/services/wallet-sdk/scope-enforcement.ts` before moving. If unfixed, add scope-enforcement fix to M3.5 PR. If fixed, document in PR as "verified closed."

## `discovery-queue.ts` — 3rd `chrome.windows.create` call

`background.ts:135` (flagged in M2.4-c plan as out-of-scope): the wallet-sdk background opens a verification popup via direct `chrome.windows.create`. After M3.5, this is still out of scope for WindowManager routing. The follow-up task created in M2.4-c PR is the tracker. Do NOT add it to M3.5 scope.

## Test strategy

**Tests that move with source:**
- `scope-enforcement.test.ts` ✅ confirmed present — moves with `scope-enforcement.ts`. Comprehensive coverage of all scope dimensions.

**New tests to write** (see `implementations-plan/M3/testing-plan.md` — M3.5 section for full code):

`packages/wallet-bridge/src/capability-map.test.ts` — `test.each` over all 14 `METHOD_CAPABILITY_MAP` entries. This is a security gate; partial coverage allows silent miscategorization. Also: case-sensitivity test (`"SendTx"` → null), `getAccounts` exempt, all 4 exempt methods tested.

`packages/wallet-bridge/src/discovery-queue.test.ts` — covers:
- chrome.action stubbed in `beforeEach` (⚠ required — `enqueue()` calls `chrome.action.setBadgeText` immediately)
- Empty drain no-op
- enqueue increments size
- Gone discovery (undefined) — skip
- Non-pending discovery (status "approved") — skip (security: must not re-process)
- Stale discovery — reject + no processFn call
- Mid-drain lock (processFn returns false) — re-queue remaining in original order (verified by second drain)

No unit tests for `dispatcher.ts` — deferred to M5.3 (tested implicitly via e2e).

## Verification cadence

1. Scaffold `packages/wallet-bridge/`
2. Move files (rpc/types → rpc/utils → types → scope-enforcement → capability-map → discovery-queue → dispatcher)
3. Patch `__VERSION__` access in `rpc/types.ts` and `dispatcher.ts`
4. Update extension imports (rpc type consumers — NOT runtime.ts, background.ts stays)
5. `bun run typecheck` — zero errors
6. `bun run test` — no regressions
7. `bun run build` — clean build
8. Smoke: discover + connect a dApp (wallet-sdk discovery flow)

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **`__VERSION__` not available in jest/vitest** without Vite define injection | MED | Add `define: { __VERSION__: '"0.0.0"' }` in wallet-bridge's vitest config if tests use it |
| 2 | **`chrome.runtime.getURL` in NuloWalletInfo** — fails in non-Chrome test env | **HIGH** | `rpc/types.ts:4-12` declares `NuloWalletInfo` as a top-level `const` that calls `chrome.runtime.getURL("/src/assets/logo.png")` at module load (not runtime-deferred). Any test that imports `rpc/types.ts` crashes with `ReferenceError: chrome is not defined` in jsdom. **Fix**: convert `NuloWalletInfo` to a factory (`export const makeNuloWalletInfo = () => ({ ..., logo: chrome.runtime.getURL(...), ... })`) OR lazy-compute the logo on first access. Callers in the service-worker side call `makeNuloWalletInfo()` once. Tests that import rpc/types.ts no longer crash at import time. Do this in the same PR as the extraction. |
| 3 | **`@aztec/wallet-sdk` internal import paths** change between nightly versions | LOW | Pinned version in package.json |
| 4 | **3rd chrome.windows.create site** — left unrouted through WindowManager; creates drift | LOW | Documented follow-up task already exists; lint guard added in M2.4-c |
| 5 | **Scope enforcement gap in scope-enforcement.ts** if M0.1 was never closed | MED | Audit before moving; fix in this PR if still open |

## Size estimate

4-5 days:
- 0.5 day: file move (mechanical, small surface)
- 0.5 day: `__VERSION__` + NuloWalletInfo patch
- 0.5 day: scope-enforcement M0.1 audit/fix
- 1 day: import migrations + typecheck
- 1 day: build + discovery/connect smoke test
- 0.5 day: buffer
