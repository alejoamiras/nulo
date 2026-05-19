# M3 Plan Audit — Agent Report

**Scope**: M3 README + plans 1–7.  
**Source read**: `runtime.ts`, `vite.config.ts`, `entity_storage.ts`, `value-storage.ts`, `simple_storage.ts`, `base/background/service.ts`, `base/background/client.ts`, `base/utils.ts`, `services/pxe/service.ts`, `services/wallet-sdk/background.ts`, `wallet/utils/` (all files), `storage/index.ts`, manifests, all vite configs.

---

## Blockers (would prevent the implementation from working)

### B1 — M3.1: `simple_storage.ts` cannot move to `wallet-core` as-is

`simple_storage.ts` uses `chrome.storage.StorageArea` as a **direct typed field** (`private readonly storage: chrome.storage.StorageArea`) with no injected-port fallback path. Unlike `EntityStorage`/`ValueStorage`, it has no `MinimalArea` abstraction and accepts only `StorageType`. It will fail `tsc` under wallet-core's `"types": []` config immediately.

The M3.1 plan groups it with `entity_storage.ts` and `value-storage.ts` in the "move to wallet-core/src/storage/" table, but the Option A decision (purge the chrome path) is not applied to `simple_storage.ts` in the plan. The plan must either:
- Apply the same chrome-stripping to `simple_storage.ts` (add a `StorageArea`-only ctor), or
- Keep `simple_storage.ts` in `@nulo/extension`.

**Check who uses it**: `storage/index.ts` re-exports it, and grep shows `SimpleStorage` is only imported from a handful of files. This is a contained fix but must be explicit in the plan.

---

### B2 — M3.1: Large portion of `src/wallet/utils/` cannot move to `wallet-core`

The M3.1 plan says "move ALL of `src/wallet/utils/`" but multiple files have disqualifying dependencies:

| File | Blocking dep | Cannot go to wallet-core because |
|---|---|---|
| `offscreen.ts` | `chrome.runtime`, `chrome.offscreen` (direct globals) | Chrome-only globals |
| `fetch.ts` | `@aztec/foundation/json-rpc`, `@aztec/foundation/retry` | Aztec deps |
| `auth-registry.ts` | `@aztec/constants`, `@aztec/stdlib/*`, `@aztec/foundation/*` | Aztec deps |
| `fee-juice.ts` | `@aztec/constants`, `@aztec/stdlib/*`, `@aztec/noir-contracts.js/*` + `@/wallet/services/execution/spec` | Aztec deps + extension internal |
| `schemas.ts` | `@aztec/stdlib/*`, `@aztec/foundation/*` | Aztec deps |
| `caip.ts` | `@/wallet/services/dapp-interaction/spec` | Extension internal dep |

The `utils/index.ts` barrel only exports `arrays`, `lock`, `random`, `rw-guard`, `sleep` — so the barrel is safe. But the plan's claim that the whole `utils/` directory moves is wrong. These files need to stay in extension or move to `@nulo/aztec-runtime` (for Aztec-dep utils).

Risk register item #6 says "audit each util — move only pure ones" but the plan body contradicts this by including the whole directory in the move table. The plan needs a corrected file-by-file move table for `utils/`.

---

### B3 — M3.5: `background.ts` imports **6 concrete service classes** (not just types)

The M3.5 plan states "Service references are accessed via `ServiceCollection` — DI, no concrete imports." This is **factually wrong**.

`services/wallet-sdk/background.ts` (lines 30–36) has these **value imports** (not type-only):

```ts
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { ExecutionService } from "@/wallet/services/execution/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { DappInteractionService } from "@/wallet/services/dapp-interaction/service"
import { DappSessionService, AccessLevel } from "@/wallet/services/dapp-session/service"
```

These are needed at runtime to call `services.get(NetworkService.name)` (using the `.name` static property). Moving `background.ts` to `@nulo/wallet-bridge` while these service implementations remain in `@nulo/extension` creates a **circular workspace dependency**: `wallet-bridge → extension`.

Mitigation options (the plan must choose one):
1. Export service-name string constants from each service's `spec.ts` (already has specs), then import only those constants — eliminates concrete class imports.
2. Accept resolved service instances as typed parameters to `initWalletSdkHandler` (change signature to take explicit services rather than a `ServiceCollection`).
3. Keep `background.ts` in `@nulo/extension` and only extract `dispatcher.ts`, `capability-map.ts`, `scope-enforcement.ts`, `types.ts`, `rpc/` to wallet-bridge.

Option 1 is lowest risk since spec files already exist.

---

### B4 — M3.5: `dispatcher.ts` also imports `packageJson.version` (undocumented)

The M3.5 plan correctly identifies `rpc/types.ts` and `background.ts` as importing `packageJson.version`, and proposes `__VERSION__` as the fix. However, `dispatcher.ts` **also** imports `packageJson` at line 73 and uses `packageJson.version` in 3 places (lines 364, 392, 489 — wallet info structs in `requestCapabilities` responses).

All three files need the `__VERSION__` substitution. The plan is incomplete on this point.

Additionally, vitest for `wallet-bridge` will need `define: { __VERSION__: '"0.0.0"' }` injected (the plan does note this as Risk #1, so the awareness is there, but the fix must cover all three files, not just one).

---

### B5 — M3.7: Dependency-cruiser `chrome-types` rule does not catch actual chrome global usage

The M3.7 boundary enforcement config includes:
```js
{ name: "wallet-core-no-chrome", from: { path: "^packages/wallet-core/src" }, to: { path: "chrome-types" } }
```

This rule catches files that **import** the `chrome-types` npm package. But `chrome.*` usage in wallet-core would appear as **global access** (not a module import) — `chrome-types` only provides TypeScript type definitions via `"types": ["chrome-types"]` in tsconfig. A file that calls `chrome.storage.local` does not generate a module import to `chrome-types`.

The actual protection against chrome leakage into wallet-core is the `"types": []` in wallet-core's `tsconfig.json` (which the plan correctly prescribes). The dependency-cruiser rule as written adds no additional enforcement beyond what tsc already provides. It is not harmful, but it should not be relied upon as a lint gate.

The plan should clarify that `tsc --noEmit` with `"types": []` is the real guard, and the depcruiser rule is documentation-only for the chrome boundary.

---

## Improvements (correct but should be tightened)

### I1 — M3.1: Internal inconsistency on `utils.ts` placement (acknowledged but not resolved)

The M3.1 plan explicitly lists `src/wallet/base/utils.ts` (wrapParams/unwrapParams) in the "What goes in wallet-core" table, then at the end says "revise M3.1 accordingly" — leaving M3.1 internally inconsistent. M3.3 restates the correction. The M3.1 plan document itself should remove `utils.ts` from the wallet-core table, since implementors reading only M3.1 would move it to the wrong place.

Action: delete the `src/wallet/base/utils.ts` row from M3.1's move table and add a note: "Stays in extension during M3.1; moves to extension-messaging in M3.3."

---

### I2 — M3.3: `wrapParams/unwrapParams` is messaging-specific — classification is correct

The classification of `wrapParams`/`unwrapParams` as messaging-specific (not general-purpose) is correct. The functions exist solely to preserve array index semantics when serializing `unknown[]` over Chrome's `Port.postMessage()` which goes through `JSON.stringify`. They are not reusable outside the RPC layer. The M3.3 decision to put them in `extension-messaging` is sound.

`unwrapParams` imports `array_max` from `@/wallet/utils/arrays.ts`. After M3.1, `arrays.ts` will be in `@nulo/wallet-core/utils`. The import must update to `import { array_max } from "@nulo/wallet-core/utils"` when utils.ts moves to extension-messaging in M3.3. This cross-package dependency is fine (extension-messaging may import wallet-core), but it should be called out explicitly in the M3.3 plan.

---

### I3 — M3.1: StorageType blast radius is 14 call-sites, not "~15 service files"

Actual grep count of `StorageType.Local/Session` in non-storage source files:

- 11 service files (token, transaction, contact, operation-journal, network, fpc, dapp-session, profile/repository, profile/session-manager, account, auth-registry ×2, token-balance)
- 1 config file (`config/store.ts` — ValueStorage)
- 2 storage implementations themselves (entity_storage, value-storage — these also contain the chrome path)

**Total callers outside storage/**: 13 files. The plan says "~15" which is close enough, but the migration must also address `config/store.ts` (which the plan doesn't mention explicitly). `ConfigStore` is special because it's passed into services via DI through `WalletRuntimeDeps` — its storage injection should follow the same pattern.

The Option A decision (purge the legacy enum) is the right call. Option B (keep enum in extension, re-export from wallet-core without chrome logic) is tricky because the `StorageType` number enum is the type discriminator inside the ctor: `if (typeof areaOrType === "number")` — keeping the enum outside wallet-core while the storage classes live inside creates a coupling that makes the type guard brittle.

---

### I4 — M3.4: WASM shim `resolveId` will still work after workspace extraction

The shim's `resolveId` hook checks `importer?.includes("@aztec/bb.js")`. When `@aztec/bb.js` is resolved by Bun, the physical path goes through:
```
.../node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/...
```

This path **does** contain `@aztec/bb.js` as a substring, so the check fires correctly. The concern that "workspace bundling might change the importer path" is unfounded for Bun's flat cache layout. The shim will work correctly after M3.4.

**However**, there is a subtler scenario: if `@nulo/aztec-runtime` ships its own copy of `@aztec/bb.js` in its `dependencies` (which the M3.4 package.json draft does), Bun may resolve two separate bb.js instances under different `.bun/` cache paths. The `dedupe` vite config should handle this, but the plan should add a build verification step: confirm the final bundle contains exactly one bb.js WASM instance after M3.4 (e.g., check bundle size doesn't double for WASM bytes).

---

### I5 — M3.4: Solution A (thin offscreen shell) is correct — but needs one more detail

The plan proposes keeping `packages/extension/src/offscreen/index.html` and `index.ts` as thin shells. This is correct. The offscreen document is runtime-created via `chrome.offscreen.createDocument({ url: chrome.runtime.getURL("src/offscreen/index.html") })` in `utils/offscreen.ts` — the hardcoded URL `"src/offscreen/index.html"` must match the shell's location in the extension package. As long as the shell stays in `packages/extension/src/offscreen/`, this is stable.

The plan should also note that `utils/offscreen.ts` itself must **not** move to `@nulo/aztec-runtime` (it uses `chrome.runtime` and `chrome.offscreen` directly) — it should stay in `@nulo/extension`. The M3.1 plan currently includes it in the "move all of `utils/`" table, which is wrong (see B2).

---

### I6 — M3.5: `__VERSION__` as `declare const` is correct TypeScript

`declare const __VERSION__: string` is the standard pattern for Vite global defines. The define is injected at bundle time as a string literal replacement (e.g., `"0.12.3"`). TypeScript sees the ambient declaration and allows the usage without importing. This is well-established and correct.

The one gotcha: `declare const` must appear in a `.d.ts` file or at top-level in the source file (not inside a block). The plan's inline example (`declare const __VERSION__: string` at module top-level) is valid. Alternatively, add it to `packages/wallet-bridge/src/env.d.ts` to keep it out of the implementation files.

For vitest in wallet-bridge: since `rpc/types.ts` uses `__VERSION__` at module load time (it's in the `NuloWalletInfo` constant initializer), any test that imports `rpc/types.ts` will hit an undefined `__VERSION__` unless vitest's `define` option is set. The M3.5 risk register correctly flags this (Risk #1). Make sure the wallet-bridge `vitest.config.ts` includes `define: { __VERSION__: '"0.0.0-test"' }`.

---

### I7 — M3.6: SCSS `loadPaths` approach is correct; the `@use "abstracts/"` concern is moot

The extension's current `src/assets/styles/` contains only `_base.scss`, `_flex.scss`, `_text.scss`. There are **no** `@use "abstracts/..."` imports anywhere in the codebase. The plan's Risk #5 ("SCSS import loops if SCSS partials reference vars from extension's styles") is a concern that doesn't currently exist. The actual SCSS structure is flat and the loadPaths migration is mechanical.

The plan's approach of adding `../extension-ui/src/assets/styles` to the extension's `loadPaths` array is correct. Both paths coexist without conflict since they have different filenames.

---

### I8 — M3.6: Auto-import outside package root is supported by unplugin-vue-components v29

`unplugin-vue-components` v29.2.0 (in use) accepts any filesystem path in `dirs` — it uses `fast-glob` without a package-root restriction. The plan's proposal to add `"../extension-ui/src/components"` to `useComponents({ dirs: [...] })` will work. The `dts` regeneration step (delete components.d.ts + run `bun dev` once) is the correct procedure after changing dirs.

One detail: the `dts` output file (`src/types/components.d.ts`) stays in the extension package. If `vue-tsc` typecheck runs in extension-ui separately, it won't see auto-registered component types. The M3.7 plan correctly flags this (Risk #4) and suggests adding `"references"` in extension's tsconfig.

---

### I9 — M3.7: Boundary enforcement coverage is adequate but has the chrome-global gap (see B5)

The dependency-cruiser matrix in M3.7 is logically correct for the package dependency graph. All forbidden edges are identified. The rules correctly use path patterns to detect source-level imports between packages.

The gap is the chrome-global issue (B5): `wallet-core-no-chrome` detects `chrome-types` module imports, not `chrome.*` global usage. The real guard is wallet-core's `"types": []` tsconfig. The plan should not describe the depcruiser rule as the primary boundary here.

For `extension-ui`, the plan's rule `extension-ui-no-extension` is correct — it prevents extension-ui from importing from extension's `src/`. But extension-ui does depend on `@nulo/wallet-core` (via EventHandler types in composables) — that dependency is allowed and not flagged, which is correct.

---

## Sequencing Analysis

### Parallel execution (M3.2, M3.3, M3.6 after M3.1)

**M3.2 and M3.3** have no overlap — wallet-crypto and extension-messaging share no files. They can proceed in parallel after M3.1. **Correct.**

**M3.6 after M3.1** is correct. Extension-ui's components use `EventHandler` from wallet-core (via `@/wallet/utils/event-handler`), so wallet-core must be extracted first.

**Hidden constraint between M3.3 and M3.6**: Extension-ui composables do NOT use extension-messaging (the plan's Option 2 keeps `externalLinks.ts`, `externalImage.ts`, `configClient.ts` in extension). So M3.6 does not depend on M3.3. **The parallel claim is correct.**

**M3.4 and M3.5 in parallel after M3.1+M3.3**: Correct — aztec-runtime depends on wallet-core + wallet-crypto + extension-messaging; wallet-bridge depends on wallet-core + extension-messaging. They share no files.

**Hidden constraint**: B3 (wallet-bridge importing concrete service classes from extension) affects M3.5 regardless of sequencing. This needs resolution at M3.5 planning time, not a sequencing fix.

---

## Missing Risks

### MR1 — `wrapParams` imports `array_max` from wallet-core

After M3.1 moves `arrays.ts` to wallet-core, and M3.3 moves `utils.ts` (wrapParams/unwrapParams) to extension-messaging, the import `import { array_max } from "@/wallet/utils"` in `utils.ts` must become `import { array_max } from "@nulo/wallet-core/utils"`. This is a sequencing dependency within M3.3 that the plan doesn't call out.

### MR2 — `config/store.ts` uses `StorageType` but is NOT listed in the M3.1 migration table

`config/store.ts` line 10: `new ValueStorage<Config>("nulo:config", StorageType.Local)`. This file stays in extension (it uses chrome.storage directly and is part of ConfigStore infrastructure). After M3.1 removes the StorageType enum from wallet-core and moves EntityStorage/ValueStorage there without the legacy path, `config/store.ts` must be updated to pass `chrome.storage.local` directly. The M3.1 plan lists service files but not `config/store.ts`.

### MR3 — `aztec-runtime` tests via extension's vitest config creates a cross-package coupling

The M3.4 plan proposes running `chain-runtime.test.ts` and `artifact-registry.test.ts` via the extension's vitest config with a wildcard include. This is pragmatic but creates a testing coupling: the extension's vitest must know about aztec-runtime's src directory. If aztec-runtime is later given its own vitest config, the extension's vitest include must be cleaned up. Document this as technical debt.

### MR4 — `background.ts` has a monkey-patch of a private method on `BackgroundConnectionHandler`

Lines 171–183 in `background.ts` monkey-patch `handler.handleEncryptedMessage` (a private method) with a comment "Remove if wallet-sdk adds serialization API." This code moves to wallet-bridge. If the upstream `@aztec/wallet-sdk` renames or removes `handleEncryptedMessage`, the build will silently break (TypeScript can't type-check `as any` monkey-patching). This is an existing risk that M3.5 doesn't mention.

### MR5 — Extension-ui moving assets changes the `@assets` alias target

`vite.config.ts` line 44: `"@assets": fileURLToPath(new URL("src/assets", import.meta.url))`. After M3.6, assets move to extension-ui. The alias must be updated to point to `../extension-ui/src/assets`. The M3.7 audit step mentions checking `@assets` usages, and M3.6 mentions it in Risk #4 — but neither plan specifies the exact vite.config change needed. This should be explicit in M3.6's vite config update section.

### MR6 — `aztec-runtime`'s dependency on `@aztec/pxe`, `@aztec/accounts`, etc. creates large workspace package install surface

Adding all Aztec packages as direct dependencies of `@nulo/aztec-runtime` means every package in the monorepo that depends on aztec-runtime transitively pulls these large Aztec packages. Since `@nulo/extension` is the only consumer today, this is not a practical problem — but it means running `bun install` in `packages/wallet-core` won't pull Aztec deps (good), while `packages/extension` still does (via aztec-runtime dep). The plan correctly notes this; no action required, just awareness.

---

## Missing Plans Coverage

### Boundary lint for internal path imports

The architecture plan mentions "a lint rule that fails if a package imports another package's internal path instead of its index." The M3.7 plan covers this via dependency-cruiser `from` → `to` path rules. However, the current `.dependency-cruiser.cjs` draft catches cross-package imports at the **file** level but does not specifically enforce "must import from index, not from internal paths."

For example, a rule like `import { X } from "@nulo/wallet-core/src/utils/arrays"` (bypassing the public index) would not be caught by the current rules because the `to.path` patterns match `packages/<pkg>/src/...` paths from *other* packages' source. A cross-package internal-path import from extension into wallet-core would be caught (the rule says extension can't import from wallet-core internal paths beyond its own source). But wallet-core's subpath exports (`./utils`, `./ports`, etc.) already restrict the public API via the `exports` field — Bun/Vite's module resolution will error on unregistered subpaths. The boundary is enforced at the module resolver level, not just lint.

Coverage is adequate. No additional plan needed.

---

## Summary Table

| # | Finding | Plan | Severity | Type |
|---|---|---|---|---|
| B1 | `simple_storage.ts` can't move to wallet-core (no injected-port path) | M3.1 | Blocker | Correctness |
| B2 | Half of `utils/` has chrome/Aztec deps and can't go to wallet-core | M3.1 | Blocker | Correctness |
| B3 | `background.ts` imports 6 concrete service classes → circular dep | M3.5 | Blocker | Architecture |
| B4 | `dispatcher.ts` also imports `packageJson.version` (plan omits it) | M3.5 | Blocker | Completeness |
| B5 | depcruiser chrome-types rule doesn't catch chrome.* global usage | M3.7 | Blocker | Enforcement gap |
| I1 | M3.1 `utils.ts` placement still in move table (acknowledged but unfixed) | M3.1 | Improvement | Inconsistency |
| I2 | wrapParams classification in extension-messaging is correct | M3.3 | Improvement | Confirm |
| I3 | StorageType blast radius: plan omits `config/store.ts` | M3.1 | Improvement | Completeness |
| I4 | WASM shim resolveId works correctly post-extraction | M3.4 | Improvement | Confirm |
| I5 | Solution A (thin shell) is correct; `offscreen.ts` must stay in extension | M3.4 | Improvement | Clarify |
| I6 | `declare const __VERSION__` pattern is correct; needs vitest define | M3.5 | Improvement | Confirm |
| I7 | SCSS `@use "abstracts/"` concern is moot (no such pattern exists) | M3.6 | Improvement | Risk reduction |
| I8 | Auto-import cross-package dir scan is supported in v29 | M3.6 | Improvement | Confirm |
| I9 | depcruiser matrix is correct except for chrome-global gap (see B5) | M3.7 | Improvement | Gap |
| MR1 | `wrapParams` → `array_max` import update needed in M3.3 | M3.3 | Risk | Missing |
| MR2 | `config/store.ts` StorageType migration not in M3.1 task list | M3.1 | Risk | Missing |
| MR3 | aztec-runtime tests via extension vitest = cross-package coupling debt | M3.4 | Risk | Missing |
| MR4 | `handleEncryptedMessage` monkey-patch is a silent breakage risk | M3.5 | Risk | Missing |
| MR5 | `@assets` alias target change not spelled out in M3.6 vite config section | M3.6 | Risk | Missing |
| MR6 | Large Aztec transitive dep surface from aztec-runtime | M3.4 | Risk | Low (FYI) |
