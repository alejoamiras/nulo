# M3.4 — Extract `@nulo/aztec-runtime` (~1 week)

## Context & prerequisite

Prerequisites: **M3.1 + M3.3 done** (wallet-core + extension-messaging extracted). M3.2 (wallet-crypto) is also needed because PxeService depends on PasskeyCredential derivation paths. M3.4 is the **most complex extraction** — it carries the heaviest dependencies (bb.js WASM, Aztec PXE stack) and owns the offscreen document lifecycle.

Per the architecture plan: "Only **after** M2.2 done." M2.2 (ExecutionService split) is done (0.12.0). ✅

## What goes in `@nulo/aztec-runtime`

The Aztec proof/execution engine and the off-screen document that hosts it.

| Source tree (current) | Moves to |
|---|---|
| `src/wallet/services/pxe/service.ts` | `packages/aztec-runtime/src/pxe/service.ts` |
| `src/wallet/services/pxe/spec.ts` | `packages/aztec-runtime/src/pxe/spec.ts` |
| `src/wallet/services/pxe/client.ts` | `packages/aztec-runtime/src/pxe/client.ts` |
| `src/wallet/services/pxe/chain-runtime.ts` + test | `packages/aztec-runtime/src/pxe/chain-runtime.ts` |
| `src/wallet/services/pxe/artifact-registry.ts` + test | `packages/aztec-runtime/src/pxe/artifact-registry.ts` |
| `src/wallet/services/pxe/known-artifacts.ts` | `packages/aztec-runtime/src/pxe/known-artifacts.ts` |
| `src/wallet/services/pxe/proxy.ts` | `packages/aztec-runtime/src/pxe/proxy.ts` |
| `src/wallet/services/account/contracts/nulo-account.ts` | `packages/aztec-runtime/src/account/nulo-account.ts` |
| `src/wallet/services/account/contracts/index.ts` — `IAccountContract` | `packages/aztec-runtime/src/account/index.ts` |
| `src/offscreen/` (index.html + index.ts) | `packages/aztec-runtime/src/offscreen/` |

**Stays in `@nulo/extension`:**
- `src/wallet/services/account/service.ts` — `AccountService` (SW side; uses PXE via offscreen RPC, not directly)
- `src/wallet/services/account/client.ts` — `AccountServiceClient` (popup side)
- `src/wallet/services/account/spec.ts` — account RPC spec (non-PXE types)
- `src/wallet/services/execution/` — ExecutionService (calls PXE through OffscreenServiceClient)

## Offscreen document boundary

The offscreen document is the ONLY place where `PxeService` runs. It's isolated by Chrome's MV3 offscreen architecture:
- SW sends messages to offscreen via `chrome.runtime.sendMessage`
- `OffscreenService` base (from M3.3) handles routing
- `PxeService` extends `OffscreenService`

After extraction, the offscreen entry point (`packages/aztec-runtime/src/offscreen/index.ts`) must be correctly bundled and loaded by the extension's manifest. The **vite config** for the extension must continue to include the offscreen entry:
```ts
rollupOptions: {
  input: {
    offscreen: "../../aztec-runtime/src/offscreen/index.html",  // or a re-export HTML
    ...
  }
}
```

**Problem**: `vite-plugin-crx` (CRX plugin) expects the offscreen HTML to be discoverable from the extension's source tree. Moving it to `packages/aztec-runtime/` breaks this expectation.

**Solution A**: Keep `src/offscreen/index.html` + `src/offscreen/index.ts` in the extension as thin shell files that import from `@nulo/aztec-runtime`. The runtime entry point is in aztec-runtime, but the HTML shim lives in extension.

```ts
// packages/extension/src/offscreen/index.ts (thin shell — stays in extension)
import "@nulo/aztec-runtime/offscreen/entry"
```

```ts
// packages/aztec-runtime/src/offscreen/entry.ts (implementation — in aztec-runtime)
import { PxeService } from "../pxe/service"
// ... init code
```

This preserves the CRX plugin's file discovery while giving aztec-runtime ownership of the actual logic. **Use Solution A.**

**Solution B**: Pass the aztec-runtime's directory to Vite's input directly. Requires changes to vite config that the CRX plugin may not support. Riskier.

## WASM asset management

`@aztec/bb.js` loads WASM via a fetch shim (`src/shims/bb-fetch-code.ts`). This shim lives in the extension and is Vite-specific. After M3.4:
- The shim **stays in `@nulo/extension`** (it's a build-system concern, not runtime logic)
- `@nulo/aztec-runtime` imports `@aztec/bb.js` normally
- Vite's `resolveId` hook in the extension's vite config intercepts the WASM import at build time

The shim works because Vite processes `@nulo/aztec-runtime`'s source through the extension's Vite build — the shim plugin runs over aztec-runtime's imports. **This is the key insight: aztec-runtime doesn't need its own Vite config.** The extension's Vite build is the bundler for all packages.

Similarly, the `dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"]` Vite config option stays in the extension's vite config and applies transitively.

## bb.js WASM asset copy

```ts
viteStaticCopy({
  targets: [
    {
      src: "./libs/@aztec/bb.js/*.wasm.gz",
      dest: "assets/",
    },
  ],
}),
```

This still runs from the extension's vite config. No change.

## New package scaffold

### `packages/aztec-runtime/package.json`
```json
{
  "name": "@nulo/aztec-runtime",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./pxe": "./src/pxe/index.ts",
    "./account": "./src/account/index.ts",
    "./offscreen/entry": "./src/offscreen/entry.ts"
  },
  "dependencies": {
    "@nulo/wallet-core": "workspace:*",
    "@nulo/wallet-crypto": "workspace:*",
    "@nulo/extension-messaging": "workspace:*",
    "@aztec/pxe": "4.2.0-nightly.20260413",
    "@aztec/accounts": "4.2.0-nightly.20260413",
    "@aztec/aztec.js": "4.2.0-nightly.20260413",
    "@aztec/bb.js": "4.2.0-nightly.20260413",
    "@aztec/entrypoints": "4.2.0-nightly.20260413",
    "@aztec/foundation": "4.2.0-nightly.20260413",
    "@aztec/protocol-contracts": "4.2.0-nightly.20260413",
    "@aztec/stdlib": "4.2.0-nightly.20260413",
    "@aztec/simulator": "4.2.0-nightly.20260413"
  }
}
```

**No separate build/vitest** in aztec-runtime for now. The Aztec packages require WASM and bb.js initialization that doesn't work in the standard jsdom environment. Existing tests (`chain-runtime.test.ts`, `artifact-registry.test.ts`) inject fake deps and currently pass in the extension's vitest — they can stay in extension OR move to aztec-runtime with a custom vitest config that skips WASM.

**Test decision**: Keep existing tests (`chain-runtime.test.ts`, `artifact-registry.test.ts`) in aztec-runtime's src, but run them via the extension's vitest config (which has the right alias + jsdom setup). Use a wildcard in the extension vitest include: `"../../aztec-runtime/src/**/*.test.ts"`.

### `packages/aztec-runtime/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "lib": ["ESNext", "DOM", "WebWorker"],
    "types": ["chrome-types"],
    "isolatedModules": true,
    "skipLibCheck": true
  }
}
```

### `packages/aztec-runtime/src/index.ts`
```ts
export * from "./pxe/index.js"
export * from "./account/index.js"
```

## Account contracts — `IAccountContract` boundary

`IAccountContract` is the interface that `NuloAccount` implements. `AccountService` (SW side) uses it to call `createTxExecutionRequest`. After M3.4:
- `IAccountContract` is in `@nulo/aztec-runtime/account`
- `AccountService` in `@nulo/extension` imports it from `@nulo/aztec-runtime`

This is fine — extension depends on aztec-runtime is acceptable in the package graph.

## Known artifacts: `@defi-wonderland/aztec-standards`, `@wonderland/aztec-fee-payment`

`known-artifacts.ts` imports these packages for FPC + token artifacts. They stay as dependencies of aztec-runtime (or extension — wherever known-artifacts.ts ends up). Since known-artifacts.ts is part of the PXE registry logic, it moves to aztec-runtime.

These packages are pinned in extension's package.json today. They must be declared as dependencies of aztec-runtime (not just extension) after the move. **Important**: they're loaded from Vite's alias resolver (`@private-fpc-artifact`, `@wonderland-token-artifact`). These Vite aliases are defined in the extension's vite.config.ts — they apply transitively when building. No per-aztec-runtime vite config is needed.

## Changes in `@nulo/extension`

### `package.json`
```json
{
  "dependencies": {
    "@nulo/wallet-core": "workspace:*",
    "@nulo/wallet-crypto": "workspace:*",
    "@nulo/extension-messaging": "workspace:*",
    "@nulo/aztec-runtime": "workspace:*"
  }
}
```

### Import migrations in extension

| Old import | New import |
|---|---|
| `from "@/wallet/services/pxe/client"` | `from "@nulo/aztec-runtime/pxe"` |
| `from "@/wallet/services/pxe/spec"` | `from "@nulo/aztec-runtime/pxe"` |
| `from "@/wallet/services/pxe/service"` | `from "@nulo/aztec-runtime/pxe"` |
| `from "@/wallet/services/account/contracts"` | `from "@nulo/aztec-runtime/account"` |
| `from "@/wallet/services/account/contracts/nulo-account"` | `from "@nulo/aztec-runtime/account"` |

Affected files (~5-8): execution/service.ts, account/service.ts, any file that imports PxeServiceClient or IAccountContract.

### ⚠ Pre-extraction refactor (Step 0) — decouple moved source from extension types

The source files moving to aztec-runtime currently import extension-internal types. These `@/` paths will NOT resolve from inside `@nulo/aztec-runtime`. Fix BEFORE the extraction PR:

| File | Import to replace | Resolution |
|---|---|---|
| `chain-runtime.ts:8` | `import type { Network } from "@/wallet/services/network/client"` | Define minimal local `NetworkInfo` type (only the fields chain-runtime actually reads: `chainId`, `rpcUrl`, `id`), OR move the `Network` type to `wallet-core/network-types.ts` |
| `artifact-registry.ts:4` | `import type { Network } from "@/wallet/services/network/client"` | Same as above |
| `artifact-registry.ts:5` | `import type { ConfigServiceClient } from "@/wallet/services/config/client"` | Define a minimal `IConfigReader` interface with only the methods artifact-registry uses (probably `getValue<T>(key)`) |

**Decision**: inline minimal local interfaces in aztec-runtime. The shapes are small (Network has ~6 fields; the config reader uses 1-2 methods). This keeps `@nulo/aztec-runtime` structurally typed against what it ACTUALLY needs, without depending on extension's public service contract.

After this pre-refactor, the source files compile cleanly in aztec-runtime. The extension's tests (which stay in extension per the test-strategy section) can still use the real `Network` and `ConfigServiceClient` types — TypeScript structural typing matches the narrower runtime interface automatically.

Run `bun run typecheck` in aztec-runtime with `"types": []` to verify zero errors before the extraction PR lands.

### `src/offscreen/index.ts` (thin shell stays in extension)
```ts
// Shell: Aztec runtime logic lives in @nulo/aztec-runtime/offscreen/entry.
// This file exists so the CRX build plugin can discover and bundle it.
import "@nulo/aztec-runtime/offscreen/entry"
```

## Test strategy

**Pattern: tests STAY in extension, only source moves.** Same approach as M3.2's `key-vectors.test.ts`.

`chain-runtime.test.ts` and `artifact-registry.test.ts` both import extension-internal types:
- `chain-runtime.test.ts:4`: `import type { Network } from "@/wallet/services/network/client"`
- `artifact-registry.test.ts:4-5`: same `Network` + `import type { ConfigServiceClient } from "@/wallet/services/config/client"`

Moving these tests to aztec-runtime would require either inlining fixture shapes (fragile — drifts from production types) or extracting the types to wallet-core (invasive). Keeping the tests in `@nulo/extension` preserves production-type coupling and is the M3.2-consistent pattern.

**Import updates in the staying-in-extension tests (after M3.4):**
- `import { ArtifactRegistry, ... } from "./artifact-registry"` → `from "@nulo/aztec-runtime"`
- `import { ChainRuntime, ... } from "./chain-runtime"` → `from "@nulo/aztec-runtime"`
- Type-only imports (`Network`, `ConfigServiceClient`) stay as `@/wallet/services/...` — these remain extension types

These tests run as part of the extension's `bun run test` suite. `@nulo/aztec-runtime` has no tests of its own.

**WASMSimulator injection** (0.12.2 fix): `AcceleratorProver` must receive an explicit `WASMSimulator` because lazy fallback breaks in MV3 offscreen. This injection happens in `pxe/chain-runtime.ts` and is preserved in the extraction.

**E2E**: the send-token flow exercises the full PXE path (proveTx in offscreen → result to SW → popup shows confirmed). Run `bun run test:e2e` after M3.4. The offscreen shell shim must correctly load the entry point — if it doesn't, proveTx will fail.

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **CRX plugin can't find offscreen HTML** after move | HIGH | Use Solution A (thin shell in extension) — CRX plugin sees the extension-local file |
| 2 | **WASM shim (bb-fetch-code) stops intercepting** aztec-runtime imports | MED | Shim's `resolveId` hook matches on importer path containing `@aztec/bb.js` — still works when the import goes through workspace bundling |
| 3 | **WASMSimulator injection missing** after refactor | MED | Chain-runtime test pins the explicit injector; CI fails if injection is lost |
| 4 | **Aztec package dedup breaks** (two copies of noirc_abi) | MED | `dedupe` config stays in extension vite.config; applies to entire bundle including aztec-runtime |
| 5 | **`known-artifacts.ts` artifact alias paths** (`@private-fpc-artifact`) stop resolving | MED | Extension vite.config still owns the aliases; applies transitively |
| 6 | **`NuloAccount` ctor changes** if `IAccountContract` interface moves | LOW | Interface-only move; no logic change |
| 7 | **Circular dep**: aztec-runtime → execution-service path | LOW | aztec-runtime only defines the PXE + NuloAccount; does NOT import ExecutionService |

## Size estimate

~1 week:
- 1 day: scaffold + offscreen shell strategy decision
- 2 days: file moves + import migrations
- 1 day: WASM shim verification + vite build
- 1 day: e2e smoke (full proveTx path)
- 1 day: buffer for Aztec dep surprises
