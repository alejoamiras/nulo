Reading additional input from stdin...
OpenAI Codex v0.120.0 (research preview)
--------
workdir: (project root)
model: gpt-5.4
provider: openai
approval: never
sandbox: read-only
reasoning effort: xhigh
reasoning summaries: none
session id: 019dbb8a-b4f7-7670-8a29-564ca826f266
--------
user
You are auditing 7 implementation plans for M3 — a package extraction milestone for the Nulo Chrome extension wallet. The plans propose splitting packages/extension/ into 7 bun workspace packages: @nulo/wallet-core (ports + utils), @nulo/wallet-crypto (KDF/encryption), @nulo/extension-messaging (Service/ServiceClient RPC base), @nulo/aztec-runtime (PXE + NuloAccount), @nulo/wallet-bridge (wallet-sdk facade), @nulo/extension-ui (Vue components), @nulo/extension (MV3 thin shell).

Key context: The codebase is a Bun monorepo, packages/extension uses Vite + Vue 3 + TypeScript + @crxjs/vite-plugin for MV3. The extension's Vite config has: (a) a bb-fetch-code-shim that intercepts @aztec/bb.js WASM imports via resolveId, (b) dedupe config for @aztec/noir-noirc_abi + @aztec/noir-acvm_js, (c) useAutoImport scanning src/composables|stores|utils/, (d) useComponents scanning src/components/. All M2 work is complete at 0.12.4.

AUDIT QUESTIONS:
1. M3.1 StorageType: The plan debates keeping vs removing the chrome.storage fallback in EntityStorage/ValueStorage. It decides on Option A (remove fallback, pass browserApi.storage.local explicitly). Is this right? What are the risks?

2. M3.1 utils.ts placement: The plan includes src/wallet/base/utils.ts (wrapParams/unwrapParams) in wallet-core in one table, but then says it should go to extension-messaging in a later section. This is an internal inconsistency — which location is correct?

3. M3.3 Zod dependency: Is Zod justified as a dependency of extension-messaging? Can the zod-helpers be optional/separate?

4. M3.4 CRX plugin + offscreen shell: The plan proposes a thin shell in extension/src/offscreen/index.ts that does 'import @nulo/aztec-runtime/offscreen/entry'. Will @crxjs/vite-plugin v2 correctly discover and bundle this? The CRX manifest has offscreen doc declared — what does the plugin need to see?

5. M3.4 WASM shim correctness: The bb-fetch-code shim's resolveId hook checks 'importer?.includes(@aztec/bb.js)'. When aztec-runtime is a workspace package processed through extension's Vite build, will the importer path contain '@aztec/bb.js'? Or will it contain the aztec-runtime package path?

6. M3.5 __VERSION__ define: Is 'declare const __VERSION__: string' correct TypeScript for a Vite define? Will it work in vitest without special config?

7. M3.6 Auto-import cross-package: Can useComponents/useAutoImport scan directories outside the extension package root? Is '../extension-ui/src/components' a valid dir path for these plugins?

8. M3.6 SCSS loadPaths: Adding '../extension-ui/src/assets/styles' to Dart Sass loadPaths — will this correctly resolve @use 'abstracts/variables' from components that have moved to extension-ui?

9. M3.7 Boundary enforcement: Is dependency-cruiser the right tool? What specific npm package + version should be installed? Any pitfalls with it in a Bun monorepo vs npm/yarn monorepo?

10. Sequencing correctness: M3.2+M3.3+M3.6 are listed as parallelizable after M3.1. Is extension-messaging (M3.3) truly independent of wallet-crypto (M3.2)? Any hidden cross-deps?

11. Missing risks: What critical risks did the plans miss?

12. Overall: Is the 'source-first exports' strategy (no per-package compile step, extension Vite bundles all workspace source) sound? What are the implications for future package publication?

Please give a structured verdict with: BLOCKERS (would prevent execution), MEDIUM issues (worth fixing in plans), MINOR issues, and per-question answers.

<stdin>
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
| `src/wallet/utils/` — arrays, errors, event-handler, fn, lock, queue, random, rw-guard, schemas, serialization, sleep, mnemonic, offscreen, fetch, auth-registry, caip, fee-juice | `packages/wallet-core/src/utils/` |
| `src/wallet/storage/entity_storage.ts`, `value-storage.ts`, `simple_storage.ts`, `index.ts` | `packages/wallet-core/src/storage/` |
| `src/wallet/base/index.ts` — ServiceCollection, IService, MethodsMap, EventsMap, topological phases | `packages/wallet-core/src/base/` |
| `src/wallet/base/topology.ts` | `packages/wallet-core/src/base/` |
| `src/wallet/base/utils.ts` — wrapParams, unwrapParams | `packages/wallet-core/src/base/` |
| `src/wallet/logger/index.ts` — ILogger interface, LogLevel, LogContext, Log type | `packages/wallet-core/src/logger/` |

**NOT in wallet-core (remain in extension or go to other packages):**
- `src/core/adapters/` — Chrome adapter implementations → remain in `@nulo/extension`
- `src/wallet/base/background/` — Service/ServiceClient base classes (use `chrome.runtime`) → M3.3
- `src/wallet/base/offscreen/` — same → M3.3
- `src/wallet/base/errors.ts` — WalletError (RPC boundary type) → M3.3
- `src/wallet/base/zod-helpers.ts` — Zod integration → M3.3
- `src/wallet/base/messages.ts` — RPC message types → M3.3
- `src/wallet/logger/store.ts`, `utils.ts` — concrete logger using chrome.storage → remain in extension
- `src/wallet/config/` — reaches chrome.storage → remains in extension

### Storage edge case: legacy chrome path

`EntityStorage` and `ValueStorage` have two constructor shapes:
1. **Legacy** — pass `StorageType` enum → reaches `chrome.storage.local/session` directly
2. **Injected** — pass a `StorageArea` port → pure

The legacy path uses `chrome.storage` which would make these files Chrome-dependent. **Decision**: keep the legacy path compile-time present but document it as "extension-side only". The package ships these files; the Chrome global is available when the extension loads them. The test path always uses the injected port.

Alternative: strip the legacy path entirely and migrate all callers to the injected form. **This is the right call for M3.1** — the legacy fallback is dead weight once all callers pass ports explicitly. Do it as part of moving: remove the `StorageType | StorageArea` overload, make `StorageArea` the only ctor arg. Callers remaining in `@nulo/extension` that used the legacy form must be updated to pass `browserApi.storage.local` / `browserApi.storage.session` explicitly.

Affected callers (grep: `StorageType.Local|StorageType.Session` in ctor calls):
- Various services in `src/wallet/services/*/service.ts` that construct EntityStorage/ValueStorage inline
- All already have `browserApi` available via `runtime.ts`; pass `browserApi.storage.local` instead of `StorageType.Local`

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
    "./logger": "./src/logger/index.ts"
  },
  "devDependencies": {
    "vitest": "^3.2.4",
    "jsdom": "^26.1.0"
  }
}
```

**No `main`/`dist` yet** — Bun workspace resolution resolves to `src/index.ts` directly (TypeScript source, bundled only by the extension's Vite build). This is the simplest approach and avoids a per-package build step during development.

### Export strategy: source-first via `exports`

Bun workspace packages resolved by the extension's Vite config don't need a compile step — Vite directly processes the TypeScript source. The `"exports"` field maps subpaths to `.ts` source files. This means:
- No `tsc` / `vite build` step for wallet-core in development
- Extension's `bun run build` bundles everything together
- Fast iteration: edit wallet-core source → vite hot-reloads extension

Downside: the package can't be published to npm as-is (needs build). Accept for now; add build step if needed later.

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
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

No path aliases (`@/` etc.) — files use relative imports within the package.

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

No path alias needed — all imports are relative or `@nulo/*` workspace packages.

### `packages/wallet-core/src/index.ts`
Re-exports the public surface for consumers that import `@nulo/wallet-core` directly:
```ts
export * from "./ports/index.js"
export * from "./base/index.js"
export * from "./storage/index.js"
export * from "./utils/index.js"
export * from "./logger/index.js"
// testing NOT re-exported from root (devDependency only surface)
```

## Changes in `@nulo/extension`

### 1. Update `package.json` to add workspace dependency
```json
{
  "dependencies": {
    "@nulo/wallet-core": "workspace:*"
  }
}
```

### 2. Update `tsconfig.json` to add path alias
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

### 3. Update `vitest.config.ts` to add alias
```ts
resolve: {
  alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    "@nulo/wallet-core": fileURLToPath(new URL("../wallet-core/src/index.ts", import.meta.url)),
  },
},
```

(Vite resolves workspace packages by package name; for vitest the alias is needed because vitest bypasses Bun's workspace resolution in some setups.)

### 4. Import migration in extension source files

Every file in `packages/extension/src/` that currently imports from one of the moved paths must be updated:

| Old import | New import |
|---|---|
| `from "@/core/ports"` | `from "@nulo/wallet-core/ports"` |
| `from "@/core/ports/clock-port"` | `from "@nulo/wallet-core/ports"` (re-export) |
| `from "@/core/testing"` | `from "@nulo/wallet-core/testing"` |
| `from "@/wallet/utils"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils/event-handler"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/utils/errors"` | `from "@nulo/wallet-core/utils"` |
| `from "@/wallet/storage"` | `from "@nulo/wallet-core/storage"` |
| `from "@/wallet/base"` | `from "@nulo/wallet-core/base"` |
| `from "@/wallet/logger"` | `from "@nulo/wallet-core/logger"` |

Estimate: ~60-80 files. Use a combination of find+sed for mechanical renames, then typecheck to catch stragglers.

### 5. `StorageType` enum migration

Files that currently do `new EntityStorage("key", StorageType.Local)` must change to pass `browserApi.storage.local`. These files are in service implementations — they already have browserApi available via the runtime or can receive it via constructor injection.

Pattern (repeated in ~15 service files):
```ts
// Before:
private readonly storage = new EntityStorage<Foo>("nulo:foo", StorageType.Local)

// After (with browserApi injected):
private readonly storage: EntityStorage<Foo>
constructor(private readonly browserApi: BrowserApi) {
  this.storage = new EntityStorage<Foo>("nulo:foo", browserApi.storage.local)
}
```

**Option B** (simpler, less churn): keep `StorageType` enum in `@nulo/extension` and have `EntityStorage` accept `StorageArea | StorageType` — but re-export `StorageType` from the extension, NOT from wallet-core. This avoids touching 15 service files. **Preferred for M3.1** to minimize blast radius; strip the legacy enum in a follow-up PR after M3 is fully extracted.

Use Option B: `EntityStorage` keeps the union ctor, but the `StorageType` enum (plus the `chrome.storage.*` reference in the ctor) is guarded behind a runtime check. The package compiles cleanly because `chrome` types are declared globally in the TypeScript environment (via `"types": ["chrome-types"]` in the extension tsconfig). For wallet-core's own tsconfig, add `"types": []` (no chrome-types) so any accidental `chrome.*` usage in wallet-core fails the typecheck.

**This means**: if wallet-core has `chrome.storage` in the StorageType branch, wallet-core's own tscheck FAILS. So we must actually do the migration (Option A) or: move EntityStorage/ValueStorage to remain in extension (not extracted). 

**Final decision**: Move EntityStorage and ValueStorage to `@nulo/wallet-core` but with ONLY the injected constructor (no StorageType fallback). The enum + chrome.storage fallback is dead weight and should be purged. The 15 service files get the browserApi injection now. This is cleaner and future-proof.

## Boundary enforcement

Add to `biome.json` (or a separate `.dependency-cruiser.cjs`):
```json
// in biome.json noRestrictedImports (if supported) or a separate config
```

Actually, Biome doesn't have an import-restriction rule for cross-package boundaries. Use **dependency-cruiser** instead:
- Add `dependency-cruiser` as a devDependency at root
- Create `.dependency-cruiser.cjs` that asserts:
  - Nothing in `packages/wallet-core/src/` imports from `@nulo/extension*`
  - Nothing in `packages/wallet-core/src/` imports from `chrome-types` globals
  - Nothing in `packages/wallet-core/src/` imports from `vue` or `@aztec/*`

Run as part of `bun run lint` or `bun run check`.

Alternatively (simpler): add `noRestrictedSyntax` in biome for `chrome.*` usage in wallet-core files, since biome DOES have a `noRestrictedGlobals` rule.

## Test strategy

Tests for files moving to wallet-core:
- `fake-browser-api.test.ts` — already in `src/core/testing/` → moves with it
- `mock-clock.test.ts` — already in `src/core/testing/` → moves with it
- `clock-ticker-adapter.test.ts` — moves with it
- No new tests needed for the port interfaces themselves (they're types)

After migration, run `bun run test` in `packages/wallet-core/` to confirm these tests still pass without extension deps.

## Verification cadence

1. Create `packages/wallet-core/`, scaffold package.json + tsconfig + vitest config
2. Move files (one directory at a time, starting with `ports/`): commit after each dir
3. Update extension imports (mechanical search-replace + typecheck)
4. `bun run typecheck` — zero errors
5. `bun run test` — unit tests pass (wallet-core tests + extension tests)
6. `bun run build` — extension builds clean
7. Load extension in Chrome: smoke-test unlock + send (no behavior change expected)

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **Import cascade**: ~80 files need updating → merge conflicts if on a branch with UI work | MED | Land M3.1 before any concurrent UI/feature branch; keep the PR purely mechanical |
| 2 | **StorageType migration**: 15 service files need browserApi injection | MED | Use Option B (keep enum in extension, extracted storage class gets it at init, not in wallet-core). Actually use the clean Option A but with a script for the migration. |
| 3 | **`chrome-types` leaking into wallet-core tests**: vitest picks up the extension tsconfig | LOW | wallet-core has its own tsconfig with `"types": []` — vitest uses this config |
| 4 | **Bun workspace resolution in vitest**: `@nulo/wallet-core` resolves incorrectly | MED | Add explicit alias in wallet-core's vitest.config.ts pointing to its own src/ |
| 5 | **`mnemonic.ts` uses `bip39` or other deps**: may have external deps not in wallet-core's package.json | LOW | Grep deps; add to wallet-core's package.json or keep in extension |
| 6 | **`fetch.ts`, `offscreen.ts` use browser APIs**: these may not belong in wallet-core | MED | Audit each util — move only pure ones; keep browser-API utils in extension |

## Size estimate

~1 week:
- 2 days: scaffold + file moves + import migrations
- 1 day: typecheck + vitest fixes
- 1 day: build verification + Chrome smoke test
- 1 day: boundary enforcement setup + cleanup
# M3.2 — Extract `@nulo/wallet-crypto` (~3-4 days)

## Context & prerequisite

Prerequisite: **M3.1 done** (`@nulo/wallet-core` extracted and imported by extension).

M2.6 crypto test vectors already exist in `src/wallet/crypto/key-vectors.test.ts`. Those vectors must pass **before and after** this extraction — any vector regression during M3.2 means the derivation path changed and keys could be bricked.

## What goes in `@nulo/wallet-crypto`

The crypto primitives that implement the security-critical derivation chains. No Chrome APIs. No Vue. Aztec math libraries (`@aztec/stdlib/keys`, `@aztec/foundation`) are used for `deriveSigningKey` — these are math, not runtime infrastructure.

| Source tree (current) | Moves to |
|---|---|
| `src/wallet/services/profile/encryption/encryption-key.ts` | `packages/wallet-crypto/src/encryption-key.ts` |
| `src/wallet/services/profile/encryption/encryption-key.test.ts` | `packages/wallet-crypto/src/encryption-key.test.ts` |
| `src/wallet/services/profile/password-secret-box.ts` | `packages/wallet-crypto/src/password-secret-box.ts` |
| `src/wallet/services/profile/password-secret-box.test.ts` | `packages/wallet-crypto/src/password-secret-box.test.ts` |
| `src/wallet/services/passkey/credential.ts` | `packages/wallet-crypto/src/passkey-credential.ts` |
| `src/wallet/crypto/key-vectors.test.ts` | `packages/wallet-crypto/src/key-vectors.test.ts` |

**Scope boundary — what stays in `@nulo/extension`:**
- `src/wallet/services/passkey/spec.ts` — the `PASSKEY_PRF_LABEL` constant is referenced by wallet-crypto. Import from crypto package after move, OR inline the constant in crypto (it's just a string).
- `src/wallet/services/profile/repository.ts` — uses EncryptionKey but also has storage deps → stays in extension
- `src/wallet/services/profile/session-manager.ts` — uses PasswordSecretBox + SessionStore → stays in extension
- `src/wallet/services/passkey/service.ts` — uses PasskeyCredential + WindowManager → stays in extension

### Critical: `PASSKEY_PRF_LABEL` constant

Currently in `src/wallet/services/passkey/spec.ts`:
```ts
export const PASSKEY_PRF_LABEL = "nulo:kdf:v1"
```

The passkey/credential.ts imports this. After M3.2, credential.ts is in wallet-crypto; spec.ts stays in extension. Two options:
1. **Inline the constant in wallet-crypto** (`const PRF_LABEL = "nulo:kdf:v1"`) — never changes; safe to duplicate.
2. **Move the constant to wallet-core or wallet-crypto**, re-export from passkey/spec.ts.

**Decision: Option 2** — the KDF label is a crypto constant, belongs in wallet-crypto. Add `export const PASSKEY_PRF_LABEL = "nulo:kdf:v1"` to `packages/wallet-crypto/src/index.ts`. The extension's `passkey/spec.ts` re-exports it: `export { PASSKEY_PRF_LABEL } from "@nulo/wallet-crypto"`. This makes the source of truth the crypto package.

**DO NOT CHANGE THE VALUE.** It is a HKDF domain separator. Any change bricks existing wallets.

## Derivation invariants (guardrails — from architecture plan)

Do not change without migration + test vectors:
- KDF label `"nulo:kdf:v1"` — passkey PRF label
- KDF label `"nulo:master:v1"` — master secret derivation
- KDF label `"nulo:profile:v1"` — profile encryption derivation
- AES-GCM ciphertext format `[version byte][12b IV][ct]` — in EncryptionKey
- PBKDF2 iteration count — in PasswordSecretBox

M2.6 vectors pin all of these. **Run `bun run test` in wallet-crypto before committing the PR** and confirm every M2.6 vector passes.

## New package scaffold

### `packages/wallet-crypto/package.json`
```json
{
  "name": "@nulo/wallet-crypto",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@nulo/wallet-core": "workspace:*",
    "@aztec/foundation": "4.2.0-nightly.20260413",
    "@aztec/stdlib": "4.2.0-nightly.20260413"
  },
  "devDependencies": {
    "vitest": "^3.2.4",
    "jsdom": "^26.1.0"
  }
}
```

**Aztec deps are PEER/DIRECT** because `deriveSigningKey` from `@aztec/stdlib/keys` and `Fr` from `@aztec/foundation/curves/bn254` are used in the signing key derivation vector. These are pure math — no WASM, no node deps. They compile and test in jsdom.

### `packages/wallet-crypto/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "lib": ["ESNext", "DOM"],
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src/**/*.ts"]
}
```

`"types": []` — no chrome-types, no webworker — keeps the package browser-agnostic (Web Crypto API is in `DOM`).

### `packages/wallet-crypto/vitest.config.ts`
```ts
import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
  },
})
```

### `packages/wallet-crypto/src/index.ts`
```ts
export { EncryptionKey } from "./encryption-key.js"
export { PasswordSecretBox } from "./password-secret-box.js"
export { PasskeyCredential } from "./passkey-credential.js"
export { PASSKEY_PRF_LABEL } from "./constants.js"
```

### `packages/wallet-crypto/src/constants.ts`
```ts
/** HKDF domain separator for passkey PRF → master secret derivation.
 *  DO NOT CHANGE — changing this bricks all existing passkey wallets. */
export const PASSKEY_PRF_LABEL = "nulo:kdf:v1"
```

## Changes in `@nulo/extension`

### `package.json`
```json
{
  "dependencies": {
    "@nulo/wallet-core": "workspace:*",
    "@nulo/wallet-crypto": "workspace:*"
  }
}
```

### Import migrations in extension

| Old import | New import |
|---|---|
| `from "@/wallet/services/profile/encryption/encryption-key"` | `from "@nulo/wallet-crypto"` |
| `from "@/wallet/services/profile/password-secret-box"` | `from "@nulo/wallet-crypto"` |
| `from "@/wallet/services/passkey/credential"` | `from "@nulo/wallet-crypto"` |
| `from "@/wallet/services/passkey/spec"` (PRF_LABEL only) | `from "@nulo/wallet-crypto"` |

Affected files (~6):
- `src/wallet/services/profile/repository.ts` — imports EncryptionKey
- `src/wallet/services/profile/session-manager.ts` — imports PasswordSecretBox
- `src/wallet/services/profile/service.ts` — imports both
- `src/wallet/services/profile/passkey-recovery-coordinator.ts` — imports PasskeyCredential
- `src/wallet/services/passkey/service.ts` — imports PasskeyCredential + PASSKEY_PRF_LABEL
- `src/wallet/crypto/key-vectors.test.ts` — moves entirely (no residual import)

### `src/wallet/services/passkey/spec.ts` — re-export the constant
```ts
// Keep the constant re-exported so any external code that already imports from this path doesn't break:
export { PASSKEY_PRF_LABEL } from "@nulo/wallet-crypto"
```

## Test strategy

**Before M3.2**: Run `bun run test` in extension — record all M2.6 vector results.

**M3.2 test migration**:
1. `encryption-key.test.ts` → moves with `encryption-key.ts`. Run as `bun run test` in `packages/wallet-crypto/`.
2. `password-secret-box.test.ts` → moves with it.
3. `passkey-recovery-coordinator.test.ts` — stays in extension (tests the coordinator, not crypto primitives directly).
4. `key-vectors.test.ts` → moves to wallet-crypto. This is the critical M2.6 regression suite.

**After M3.2**: `bun run test` in `packages/wallet-crypto/` — every vector in `key-vectors.test.ts` must pass byte-for-byte.

**Deferred vectors** (V4, V7b, V10, P2 — require bb.js WASM poseidon2): these are documented as deferred in the M2.6 test file. They stay deferred; M3.2 does not add WASM infrastructure to wallet-crypto. If WASM tests are needed later, add a separate `vitest.e2e.config.ts` with a custom pool worker.

## Verification cadence

1. Run M2.6 vectors in current extension → record baseline output
2. Create wallet-crypto scaffold
3. Move files (crypto primitives first, then tests)
4. Update extension imports
5. `bun run typecheck` — zero errors in both packages
6. `bun run test` in `packages/wallet-crypto/` — all M2.6 vectors pass
7. `bun run test` in `packages/extension/` — no regressions
8. `bun run build` — extension builds clean
9. Smoke: unlock wallet, verify passkey flow still works

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **M2.6 vector regression**: derivation path changes silently during file move | LOW | Vectors run before + after; any diff is a blocker |
| 2 | **`@aztec/stdlib/keys` has node deps that break jsdom**: deriveSigningKey may pull in node-specific code | MED | Vector V7a already passes in current jsdom vitest; if it breaks, check if a dep changed or import paths diverged |
| 3 | **PASSKEY_PRF_LABEL re-export chain**: if spec.ts re-exports from wallet-crypto and something imports from spec.ts transitively, the indirection must be stable | LOW | Simple re-export; no logic |
| 4 | **`passkey-recovery-coordinator.ts` still in extension**: it imports PasskeyCredential. After move, it uses `@nulo/wallet-crypto` — verify the type shapes survive the import change | LOW | Same type definition, different path |
| 5 | **`credentials.ts` file rename** (`credential.ts` → `passkey-credential.ts`): import paths in coordinator must update | LOW | Handled in import migration step |

## Size estimate

3-4 days:
- 0.5 day: vector baseline + scaffold
- 1 day: file moves + import migrations
- 0.5 day: typecheck + test verification
- 0.5 day: build + smoke test
- 0.5 day: buffer for Aztec dep surprises
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
    "./messages": "./src/messages.ts"
  },
  "dependencies": {
    "@nulo/wallet-core": "workspace:*",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@webext-core/fake-browser": "^1.3.4",
    "vitest": "^3.2.4",
    "jsdom": "^26.1.0",
    "chrome-types": "^0.1.370"
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
export * from "./zod-helpers.js"
```

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
| `from "@/wallet/base/zod-helpers"` | `from "@nulo/extension-messaging/zod-helpers"` |
| `from "@/wallet/base/utils"` | `from "@nulo/extension-messaging"` |

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

The pilot Zod validation on NetworkService (from M1-RT) uses `@/wallet/base/zod-helpers`. After M3.3, this becomes `@nulo/extension-messaging/zod-helpers` or just `@nulo/extension-messaging`.

## Boundary enforcement

Add to the dependency-cruiser config started in M3.1:
- `@nulo/extension-messaging` must NOT import from `@nulo/extension` or `@nulo/wallet-crypto` or `@nulo/aztec-runtime`
- `@nulo/extension-messaging` MAY import from `@nulo/wallet-core`

## Test strategy

No new unit tests created in M3.3 (tests for messaging layer go in M5.3). The existing extension unit tests that exercise individual services will implicitly test that the messaging base classes work correctly after import path migration.

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

### `src/offscreen/index.ts` (thin shell stays in extension)
```ts
// Shell: Aztec runtime logic lives in @nulo/aztec-runtime/offscreen/entry.
// This file exists so the CRX build plugin can discover and bundle it.
import "@nulo/aztec-runtime/offscreen/entry"
```

## Test strategy

**Existing PXE-level tests:**
- `chain-runtime.test.ts` — uses FakePxeFactory + FakeNodeFactory, no WASM → stays/moves to aztec-runtime src, run via extension's vitest config
- `artifact-registry.test.ts` — uses fake HTTP fetch, no WASM → same

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
# M3.5 — Extract `@nulo/wallet-bridge` (~4-5 days)

## Context & prerequisite

Prerequisites: **M3.1 + M3.3** done (wallet-core + extension-messaging).

`@nulo/wallet-bridge` is the facade layer that adapts the `@aztec/wallet-sdk` protocol (discovery, key exchange, encrypted-channel message routing) to Nulo's internal service graph. It's smaller than aztec-runtime and has no WASM — just protocol logic and dispatch routing.

M3.5 can proceed in parallel with M3.4 after M3.1 + M3.3 land, since wallet-bridge does not depend on aztec-runtime.

## What goes in `@nulo/wallet-bridge`

| Source tree (current) | Moves to |
|---|---|
| `src/wallet/services/wallet-sdk/background.ts` | `packages/wallet-bridge/src/background.ts` |
| `src/wallet/services/wallet-sdk/capability-map.ts` | `packages/wallet-bridge/src/capability-map.ts` |
| `src/wallet/services/wallet-sdk/discovery-queue.ts` | `packages/wallet-bridge/src/discovery-queue.ts` |
| `src/wallet/services/wallet-sdk/dispatcher.ts` | `packages/wallet-bridge/src/dispatcher.ts` |
| `src/wallet/services/wallet-sdk/scope-enforcement.ts` | `packages/wallet-bridge/src/scope-enforcement.ts` |
| `src/wallet/services/wallet-sdk/types.ts` | `packages/wallet-bridge/src/types.ts` |
| `src/wallet/services/rpc/types.ts` | `packages/wallet-bridge/src/rpc/types.ts` |
| `src/wallet/services/rpc/utils.ts` | `packages/wallet-bridge/src/rpc/utils.ts` |

**Stays in `@nulo/extension`:**
- All service implementations that `dispatcher.ts` calls into (ExecutionService, NetworkService, etc.) — the bridge receives these via DI, not by importing their implementations
- `src/content-script/content.ts` — content-script relay; thin glue that stays in extension

## Architecture invariants preserved

- `BackgroundConnectionHandler` from `@aztec/wallet-sdk` is the entry point; wallet-bridge owns its initialization.
- `initWalletSdkHandler(services, logger)` function stays as the composition point (called from `runtime.ts`). After M3.5, `initWalletSdkHandler` is exported from `@nulo/wallet-bridge`.
- Service references (ExecutionService, NetworkService, etc.) are accessed via `ServiceCollection` — DI, no concrete imports.
- `NuloWalletInfo` in `rpc/types.ts` uses `chrome.runtime.getURL` for the logo. This is a Chrome API call. **Decision**: keep it, since wallet-bridge is an extension-specific package anyway (it wraps `@aztec/wallet-sdk` which is extension-only).
- `CAIP` utilities in `dispatcher.ts` (if any) — the dispatcher uses `parseCaipAccount`, `parseCaipChain`, `resolveNetworkByChainId`. These currently live in `@/wallet/utils/caip`. After M3.1, they're in `@nulo/wallet-core/utils`. Import from there.

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
export { initWalletSdkHandler } from "./background.js"
export * from "./types.js"
export * from "./rpc/types.js"
```

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

### `runtime.ts` — update import
```ts
// Before:
import { initWalletSdkHandler } from "./services/wallet-sdk/background"

// After:
import { initWalletSdkHandler } from "@nulo/wallet-bridge"
```

### Import migrations in extension

Affected files (~3-5):
- `src/wallet/runtime.ts` — imports `initWalletSdkHandler`
- `src/wallet/index.ts` — if it imports rpc types
- Any file importing `NuloWalletInfo` from `@/wallet/services/rpc/types`

| Old import | New import |
|---|---|
| `from "@/wallet/services/wallet-sdk/background"` | `from "@nulo/wallet-bridge"` |
| `from "@/wallet/services/rpc/types"` | `from "@nulo/wallet-bridge/rpc"` |

## `scope-enforcement.ts` — M0.1 incomplete item

The architecture plan (M0.1) noted that `createAuthWit` scope enforcement in `scope-enforcement.ts:192-204` was incomplete. M0.1 was listed as a security patch. **Check status before M3.5**: if the scope enforcement gap still exists, M3.5 is an opportunity to fix it while moving the file. If already fixed by an earlier commit, no action needed.

**Action**: `grep -n "192\|TODO\|FIXME\|scope" src/wallet/services/wallet-sdk/scope-enforcement.ts` before moving. If unfixed, add scope-enforcement fix to M3.5 PR. If fixed, document in PR as "verified closed."

## `discovery-queue.ts` — 3rd `chrome.windows.create` call

`background.ts:135` (flagged in M2.4-c plan as out-of-scope): the wallet-sdk background opens a verification popup via direct `chrome.windows.create`. After M3.5, this is still out of scope for WindowManager routing. The follow-up task created in M2.4-c PR is the tracker. Do NOT add it to M3.5 scope.

## Test strategy

`scope-enforcement.ts` has a test file (`scope-enforcement.test.ts` if it exists — grep to confirm). If present, it moves with the source.

No other wallet-bridge files have unit tests today (the `dispatcher.ts` is tested implicitly via e2e). New unit tests for dispatcher routing are deferred to M5.3.

## Verification cadence

1. Scaffold `packages/wallet-bridge/`
2. Move files (rpc/types → types → scope-enforcement → capability-map → discovery-queue → dispatcher → background)
3. Patch `__VERSION__` access
4. Update extension imports (runtime.ts + any rpc type consumers)
5. `bun run typecheck` — zero errors
6. `bun run test` — no regressions
7. `bun run build` — clean build
8. Smoke: discover + connect a dApp (wallet-sdk discovery flow)

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **`__VERSION__` not available in jest/vitest** without Vite define injection | MED | Add `define: { __VERSION__: '"0.0.0"' }` in wallet-bridge's vitest config if tests use it |
| 2 | **`chrome.runtime.getURL` in NuloWalletInfo** — fails in non-Chrome test env | LOW | NuloWalletInfo is constructed at runtime, not in unit tests; `chrome-types` in tsconfig provides the type |
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
# M3.6 — Extract `@nulo/extension-ui` (~1 week)

## Context & prerequisite

Prerequisites: **M3.1** done (wallet-core extracted — composables need `EventHandler`, `ILogger`, utility types).

M3.6 extracts the **dumb UI primitives** that are pure Vue + CSS and have no service-client dependencies. This is the riskiest extraction for the Vite build system because:
- `useAutoImport` and `useComponents` plugins auto-import from `src/components/` and `src/composables/` — these directories will partially move
- SCSS `loadPaths` is absolute to the extension's `src/assets/styles/`
- Some composables DO import service clients (configClient.ts imports ConfigServiceClient) — those stay in extension

## What goes in `@nulo/extension-ui`

**Rule**: only files with zero dependencies on SW service implementations, service clients, or Aztec packages.

### Components (pure Vue primitives)

Everything in `src/components/ui/` that is a visual primitive with no service-client imports:

| Source tree (current) | Moves to |
|---|---|
| `src/components/` (entire directory — see below for exceptions) | `packages/extension-ui/src/components/` |

**Audit required**: grep each component for service client imports before moving. Expected safe list:
- `Flex`, `Grid`, `Text`, `Icon`, `Button`, `Input`, `Checkbox`, `Toggle`, `Tooltip`, `Dropdown`, `Badge`, `Spinner`, `Divider`, `Modal`, `Popup/*` UI primitives, `SubPageHeader`, `Banner`, `LoadingState`, `SectionLabel`, etc.

**Expected exceptions (stay in extension):**
- Any component that imports from `@/wallet/services/*` (service clients). Audit with: `grep -r "wallet/services" src/components/`.

### Composables (Vue composables)

| Source tree (current) | Moves to | Condition |
|---|---|---|
| `src/composables/ticker.ts` | `packages/extension-ui/src/composables/` | Pure — uses `setInterval`, no service |
| `src/composables/externalLinks.ts` | `packages/extension-ui/src/composables/` | Depends on `configClient.ts` (has service dep) — see below |
| `src/composables/externalImage.ts` | `packages/extension-ui/src/composables/` | Same config dep |
| `src/composables/toast.ts` | `packages/extension-ui/src/composables/` | Likely pure |
| `src/composables/configClient.ts` | STAYS in extension | Imports `ConfigServiceClient` |

**`configClient.ts` problem**: `useExternalLink` and `useExternalImage` both depend on `configClient.ts` which imports `ConfigServiceClient`. Two options:
1. **Move configClient.ts to extension-ui** and make it depend on `@nulo/extension-messaging` (to get the client base). Extension-ui then depends on extension-messaging.
2. **Keep configClient.ts and its dependents in extension**. Extension-ui gets only truly dumb composables.

**Decision: Option 2.** Extension-ui stays free of service-client deps. `externalLinks.ts` and `externalImage.ts` stay in extension. Extension-ui gets `ticker.ts`, `toast.ts`, and any other pure composables.

This is intentionally conservative — better to extract less and avoid a circular dep than to extract composables that pull in service clients.

### Stores

Pinia stores (`app.store.ts`, `popup.store.ts`, `cache.store.ts`) import service clients heavily. **All stores stay in `@nulo/extension`**.

### Assets (styles + fonts)

| Source tree (current) | Moves to |
|---|---|
| `src/assets/styles/` (SCSS partials, base vars) | `packages/extension-ui/src/assets/styles/` |
| `src/assets/fonts/` | `packages/extension-ui/src/assets/fonts/` |

**Critical**: The `vite.config.ts` in extension has:
```ts
scss: {
  loadPaths: [fileURLToPath(new URL("./src/assets/styles", import.meta.url))],
}
```
After M3.6, this must point to `../../extension-ui/src/assets/styles`. Components in `packages/extension-ui` also need this loadPath for their own SCSS.

**Solution**: extension-ui gets its own scss loadPath configuration. The extension's vite config is updated to also include extension-ui's styles path. Both are passed as `loadPaths` array:
```ts
loadPaths: [
  fileURLToPath(new URL("./src/assets/styles", import.meta.url)),
  fileURLToPath(new URL("../extension-ui/src/assets/styles", import.meta.url)),
]
```

## New package scaffold

### `packages/extension-ui/package.json`
```json
{
  "name": "@nulo/extension-ui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./components": "./src/components/index.ts",
    "./composables": "./src/composables/index.ts",
    "./assets/styles": "./src/assets/styles/"
  },
  "dependencies": {
    "@nulo/wallet-core": "workspace:*",
    "vue": "^3.5.18",
    "vue-router": "^4.5.1",
    "pinia": "^3.0.3"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^6.0.1",
    "sass": "^1.90.0",
    "vitest": "^3.2.4",
    "jsdom": "^26.1.0"
  }
}
```

### `packages/extension-ui/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "lib": ["ESNext", "DOM"],
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src/**/*.ts", "src/**/*.vue"]
}
```

### `packages/extension-ui/vitest.config.ts`
```ts
import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@nulo/extension-ui": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        loadPaths: [fileURLToPath(new URL("./src/assets/styles", import.meta.url))],
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
  },
})
```

## Auto-import strategy

The extension currently uses `useAutoImport` and `useComponents` to auto-import composables and components. After M3.6:
- `useComponents` scans `src/components/` — many components have moved. Update dirs to include extension-ui's components path:
  ```ts
  useComponents({
    dirs: [
      "src/components",
      "../extension-ui/src/components",
    ],
    dts: "src/types/components.d.ts",
  })
  ```
- `useAutoImport` scans `src/composables/`, `src/stores/`, `src/utils/`. If ticker/toast move to extension-ui, add `"../extension-ui/src/composables"` to dirs.

This preserves the developer experience — components and composables from extension-ui remain auto-imported in the extension's popup and pages without explicit import statements.

## `@/` alias strategy for extension-ui's internal code

Within `packages/extension-ui`, files use relative imports (no `@/` alias) OR define their own `@/` alias pointing to `./src`. For the extension's vite config, add an alias for extension-ui:
```ts
"@nulo/extension-ui": fileURLToPath(new URL("../extension-ui/src", import.meta.url)),
"@nulo/extension-ui/*": fileURLToPath(new URL("../extension-ui/src/*", import.meta.url)),
```

Inside extension-ui components, `@/` would resolve to extension-ui's src. This is set up in extension-ui's vitest config. For the extension's vite build, the `@/` alias still points to extension's own src — components in extension-ui use relative imports or `@nulo/extension-ui/...` paths.

## `src/pages/` — NOT in extension-ui

`src/pages/` (registered via `vite-plugin-pages` as `common` route) and `src/setup/pages/` stay in extension. They use service clients and stores.

## Changes in `@nulo/extension`

### `package.json`
```json
{
  "dependencies": {
    "...existing...",
    "@nulo/extension-ui": "workspace:*"
  }
}
```

### `vite.config.ts` — update auto-import dirs + SCSS loadPaths

```ts
useComponents({
  dirs: ["src/components", "../extension-ui/src/components"],
  dts: "src/types/components.d.ts",
})

useAutoImport({
  // ...
  dirs: ["src/composables/", "src/stores/", "src/utils/", "../extension-ui/src/composables/"],
})

scss: {
  loadPaths: [
    fileURLToPath(new URL("./src/assets/styles", import.meta.url)),
    fileURLToPath(new URL("../extension-ui/src/assets/styles", import.meta.url)),
  ],
}
```

### Import migrations

Files in extension popup/pages that import components by full path (not auto-import) must update. Most won't need changes since auto-import handles it. Explicit imports of assets/styles from `@assets/...` paths may break if moved — audit `@assets` usages.

## Test strategy

M5.1 (Vue component tests pilot) is the right place for extension-ui unit tests. In M3.6, verify:
1. `bun run typecheck` in extension-ui — zero errors
2. Extension's `bun run typecheck` — zero errors
3. `bun run build` — clean build (SCSS compilation, WASM, all)
4. Visual smoke: open popup → verify assets load (fonts, icons, button styles)
5. Open settings, send flow, dApp approval — no visual regressions

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **SCSS `loadPaths` breaks**: styles path changes break `@use` / `@import` in moved components | HIGH | Update extension's vite.config loadPaths immediately when moving styles |
| 2 | **Auto-import dts regeneration**: `components.d.ts` / `auto-imports.d.ts` must regenerate cleanly | MED | Delete dts files + run `bun run dev` once to trigger regeneration |
| 3 | **Components with service-client deps move accidentally**: audit missed an import | MED | `grep -r "wallet/services" src/components/` before any move |
| 4 | **`@assets` alias breaks**: some files use `@assets/...` to import fonts/images | MED | Audit `@assets` usages; the alias stays in extension's vite.config pointing to extension-ui's assets |
| 5 | **SCSS import loops**: if SCSS partials in extension-ui reference vars from extension's styles | LOW | Extensions' styles currently live in one dir; splitting must preserve `@use "abstracts/..."` chain |
| 6 | **`vue-tsc` (vue-tsc typecheck)** scope: root-level typecheck points to extension's tsconfig. Moving Vue SFCs to another package means vue-tsc must include that package | MED | Add `"references": [{ "path": "../../extension-ui" }]` to extension tsconfig, OR run vue-tsc on both packages separately in CI |

## Size estimate

~1 week:
- 1 day: component audit (grep for service deps) + decision on what moves
- 1 day: scaffold + SCSS strategy + vite config update
- 2 days: file moves + auto-import config update
- 1 day: typecheck + visual smoke test
- 0.5 day: CSS regression patrol (fonts, icons, colors)
- 0.5 day: buffer for SCSS surprises
# M3.7 — `@nulo/extension` — Final thin shell + boundary enforcement (~3-4 days)

## Context & prerequisite

Prerequisites: **M3.1 through M3.6 all done**. This milestone is not an extraction — it's the cleanup pass after all 6 extractions have landed. The `packages/extension/` directory is the existing `@nulo/extension` package; it becomes a thin shell by this point.

M3.7 has three goals:
1. **Audit**: verify what's actually left in extension — no orphaned code that should have moved
2. **Boundary enforcement**: install dependency-cruiser (or Biome-based) lint rules that prevent packages importing each other's internals
3. **Build system hardening**: per-package `bun run build` + `bun run test` commands, root `bun run test:all`, CI integration

## What `@nulo/extension` contains after M3.1–M3.6

The remaining "business domain" that is inherently extension-specific and doesn't belong in any reusable package:

| What remains | Why it stays |
|---|---|
| `src/wallet/runtime.ts` — composition root | Creates all service instances; orchestrates the full graph |
| `src/wallet/index.ts` — SW entry | MV3 service worker boot; chrome.runtime.onInstalled + onStartup |
| `src/wallet/services/` (all service implementations not moved) | Business logic tightly coupled to Aztec + Chrome extension |
| `src/wallet/services/profile/` | ProfileService, SessionManager, PasswordSecretBox → crypto in M3.2, services stay |
| `src/wallet/services/execution/` | ExecutionService + all extracted seams |
| `src/wallet/services/account/` | AccountService (SW side) + AccountServiceClient (popup) |
| `src/wallet/services/network/` | NetworkService |
| `src/wallet/services/token/`, `token-balance/` | TokenService, TokenBalanceService |
| `src/wallet/services/dapp-interaction/` | DappInteractionService |
| `src/wallet/services/passkey/` | PasskeyService |
| `src/wallet/services/window-manager/` | WindowManager |
| `src/wallet/config/` | ConfigStore (chrome.storage backed) |
| `src/wallet/logger/store.ts` | LoggerStore (chrome.storage backed) |
| `src/wallet/storage/migrate.ts` | Storage migration (reads/writes chrome.storage) |
| `src/core/adapters/` | Chrome adapter implementations (ChromeBrowserApiAdapter, etc.) |
| `src/popup/` | Popup pages, windows, components that use service clients |
| `src/content-script/` | Content script |
| `src/setup/` | Setup/onboarding pages |
| `src/stores/` | Pinia stores (app, popup, cache) |
| `src/composables/configClient.ts`, `externalLinks.ts`, `externalImage.ts` | Service-client-dependent composables |
| `manifest/`, `vite.*.config.mts` | Build system |
| `tests/` | E2E tests |

## M3.7 audit tasks

### 1. Dead code sweep
After all extractions, `packages/extension/src/` has lost many directories. Any remaining `@/wallet/base/background`, `@/core/ports`, `@/wallet/utils` references must now point to workspace packages. Run:
```
grep -r "from \"@/core/ports" src/
grep -r "from \"@/wallet/base/background" src/
grep -r "from \"@/wallet/utils" src/
grep -r "from \"@/wallet/storage" src/
```
Any hit means an import migration was missed in M3.1–M3.3. Fix them.

### 2. `@assets` alias check
The extension's vite config has `"@assets": fileURLToPath(...)`. If assets moved to extension-ui, the alias must point to extension-ui's assets path. Verify: `grep -r "@assets" src/` — each usage should resolve correctly through the updated alias.

### 3. Verify no phantom imports
Run `bun run typecheck` with `--incremental false` to force a full type check. Zero errors expected.

### 4. Verify test coverage still runs
`bun run test` in extension — all existing service tests, storage tests, and unit tests pass without needing the moved files.

## Boundary enforcement

### Option A: dependency-cruiser (recommended)

Install at root:
```json
// root package.json devDependencies
"dependency-cruiser": "^16"
```

`.dependency-cruiser.cjs`:
```js
module.exports = {
  forbidden: [
    // wallet-core must not import from extension packages
    {
      name: "wallet-core-no-extension",
      severity: "error",
      from: { path: "^packages/wallet-core/src" },
      to: { path: "^packages/(extension|extension-messaging|extension-ui|wallet-bridge|aztec-runtime|wallet-crypto)/src" }
    },
    // wallet-crypto must not import from extension packages (wallet-core is OK)
    {
      name: "wallet-crypto-no-extension",
      severity: "error",
      from: { path: "^packages/wallet-crypto/src" },
      to: { path: "^packages/(extension|extension-messaging|extension-ui|wallet-bridge|aztec-runtime)/src" }
    },
    // extension-messaging must not import from higher packages
    {
      name: "extension-messaging-no-higher",
      severity: "error",
      from: { path: "^packages/extension-messaging/src" },
      to: { path: "^packages/(extension|extension-ui|wallet-bridge|aztec-runtime|wallet-crypto)/src" }
    },
    // aztec-runtime must not import from extension or wallet-bridge
    {
      name: "aztec-runtime-no-extension",
      severity: "error",
      from: { path: "^packages/aztec-runtime/src" },
      to: { path: "^packages/(extension|extension-ui|wallet-bridge)/src" }
    },
    // wallet-bridge must not import from extension or extension-ui
    {
      name: "wallet-bridge-no-extension",
      severity: "error",
      from: { path: "^packages/wallet-bridge/src" },
      to: { path: "^packages/(extension|extension-ui)/src" }
    },
    // extension-ui must not import from extension
    {
      name: "extension-ui-no-extension",
      severity: "error",
      from: { path: "^packages/extension-ui/src" },
      to: { path: "^packages/extension/src" }
    },
    // Block direct chrome.* usage in wallet-core (no chrome-types dep there)
    {
      name: "wallet-core-no-chrome",
      severity: "error",
      from: { path: "^packages/wallet-core/src" },
      to: { path: "chrome-types" }
    },
  ],
  options: {
    moduleSystems: ["es6"],
    tsConfig: { fileName: "tsconfig.json" },
  }
}
```

Add to root `package.json` scripts:
```json
"check:deps": "depcruise packages --config .dependency-cruiser.cjs"
```

### Option B: Biome `noRestrictedImports` (lighter weight)

Biome's `noRestrictedImports` rule can block specific import paths. Less expressive than dependency-cruiser (no from→to matrix), but zero extra tooling. Use as a supplementary guard:

```json
// biome.json
"linter": {
  "rules": {
    "correctness": {
      "noRestrictedImports": {
        "level": "error",
        "options": {
          "paths": [
            { "name": "chrome", "message": "Use port interfaces instead of direct chrome.* access" }
          ]
        }
      }
    }
  }
}
```

**Recommendation**: implement both. Dependency-cruiser gives architectural boundary checking; Biome gives line-level chrome usage checking in packages that shouldn't have it.

## Build system hardening

### Per-package `bun run test`

Each extracted package gets:
```json
{
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Root `package.json`:
```json
{
  "scripts": {
    "test:all": "bun run --cwd packages/wallet-core test && bun run --cwd packages/wallet-crypto test && bun run --cwd packages/extension test",
    "typecheck:all": "bun run --cwd packages/extension typecheck && bun run --cwd packages/wallet-core typecheck && bun run --cwd packages/wallet-crypto typecheck",
    "check:deps": "depcruise packages --config .dependency-cruiser.cjs"
  }
}
```

### CI integration

Add to pre-commit or CI pipeline:
1. `bun run typecheck:all` — all packages typecheck clean
2. `bun run test:all` — all unit tests pass
3. `bun run check:deps` — no boundary violations
4. `bun run build` — extension builds clean

### `vue-tsc` scope update

The root `typecheck` script currently runs `vue-tsc --project packages/extension/tsconfig.json`. After M3.6, Vue SFCs may be in extension-ui. Update:
- Either run `vue-tsc` once per package that has Vue SFCs
- OR add `"references"` to extension's tsconfig pointing to extension-ui's tsconfig

```json
// packages/extension/tsconfig.json
{
  "references": [{ "path": "../extension-ui" }],
  "compilerOptions": { ... }
}
```

## M3.7 does NOT include

- Moving additional files that weren't planned in M3.1–M3.6
- Refactoring remaining extension services
- Adding new features
- Any M4/M5 work

## Verification checklist (full M3 exit criteria)

After M3.7:
- [ ] `bun run test:all` passes (wallet-core + wallet-crypto + extension unit tests)
- [ ] `bun run typecheck:all` zero errors
- [ ] `bun run check:deps` zero boundary violations
- [ ] `bun run build` clean Chrome + Firefox builds
- [ ] Extension loads in Chrome: unlock → home page → tokens → send flow
- [ ] E2E smoke: register, unlock + send, dApp sendTransaction (M1.3 deterministic scenarios)
- [ ] M2.6 crypto vectors still pass in `@nulo/wallet-crypto`
- [ ] No `@/` path aliases pointing to directories that no longer exist in the extension

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **Phantom import misses**: a migration in M3.1–M3.6 missed updating some file | MED | Audit grep list in step 1 catches them all |
| 2 | **dependency-cruiser false positives**: transitive deps detected as violations | LOW | Tune `pathNot` exceptions in the config |
| 3 | **`bun run test:all` ordering**: wallet-crypto tests need wallet-core types | LOW | Bun workspace resolves correctly; tests are isolated per-package |
| 4 | **vue-tsc scope misses SFCs in extension-ui** | MED | Add `references` or separate typecheck step for extension-ui |
| 5 | **CI pipeline order**: if boundary check runs before build, it might see stale state | LOW | Run `bun install` + `bun run typecheck:all` first, then checks |

## Size estimate

3-4 days:
- 0.5 day: audit sweep (grep + typecheck)
- 1 day: boundary enforcement setup (dependency-cruiser config)
- 0.5 day: per-package test/typecheck scripts
- 0.5 day: CI integration
- 0.5 day: vue-tsc scope fix
- 1 day: M3 exit criteria verification
# M3 — Package Extraction (~4-6 weeks)

## Overview

M3 splits the monolithic `packages/extension/` into 7 bun workspace packages. All M2 work is complete (0.12.4). The architecture plan's prerequisite ("services constructable with fake ports") is met.

## Package dependency graph

```
@nulo/wallet-core            (no deps)
    ↑
@nulo/wallet-crypto          (wallet-core + @aztec/stdlib/keys for signing key derivation)
@nulo/extension-messaging    (wallet-core + chrome-types + zod)
    ↑                            ↑
@nulo/aztec-runtime          (wallet-core + wallet-crypto + extension-messaging + @aztec/*)
@nulo/wallet-bridge          (wallet-core + extension-messaging + @aztec/wallet-sdk)
@nulo/extension-ui           (wallet-core + vue + pinia)
    ↑                            ↑                ↑             ↑              ↑
@nulo/extension              (everything above — thin MV3 shell)
```

## Extraction order

| # | Package | Days | Prerequisite |
|---|---|---|---|
| M3.1 | `@nulo/wallet-core` | ~5 | — |
| M3.2 | `@nulo/wallet-crypto` | ~3-4 | M3.1 |
| M3.3 | `@nulo/extension-messaging` | ~4-5 | M3.1 |
| M3.4 | `@nulo/aztec-runtime` | ~5 | M3.1 + M3.2 + M3.3 |
| M3.5 | `@nulo/wallet-bridge` | ~4-5 | M3.1 + M3.3 |
| M3.6 | `@nulo/extension-ui` | ~5 | M3.1 |
| M3.7 | Thin shell + boundary enforcement | ~3-4 | All above |

M3.2, M3.3, M3.6 can proceed in **parallel** after M3.1 lands.
M3.4 and M3.5 can proceed in **parallel** after their respective prereqs land.
M3.7 is the final pass after all 6 extractions.

## Key build-system decisions (pre-resolved for all plans)

**Source-first exports**: Extracted packages expose `./src/index.ts` (TypeScript source) via the `exports` field. The extension's Vite build processes all packages as source — no per-package compile step during development. This avoids per-package vite build orchestration and is the simplest path for a monorepo where the extension is the sole bundler.

**`@/` alias strategy**: Within each extracted package, files use relative imports. The extension's `@/` alias continues to map to `packages/extension/src/`. Cross-package imports use the package name: `@nulo/wallet-core`, `@nulo/extension-messaging`, etc.

**Auto-import preservation**: `useComponents` and `useAutoImport` Vite plugins are updated to include the extension-ui directories so developer ergonomics (no explicit imports for UI primitives) are preserved.

**WASM shim stays in extension**: The `bb-fetch-code.ts` shim and `dedupe` config live in the extension's `vite.config.ts` and apply transitively to all workspace packages during the extension's Vite build.

**Chrome types**: Packages that use `chrome.*` types include `chrome-types` in devDependencies and set `"types": ["chrome-types"]` in tsconfig. Tests provide the chrome global via `@webext-core/fake-browser`.

## Critical invariants (do not break)

- KDF labels (`nulo:kdf:v1`, `nulo:master:v1`, `nulo:profile:v1`) — never change values
- Passkey RP ID `nulo.sh` — stays in extension/passkey spec
- AES-GCM ciphertext format — stays in wallet-crypto, tested by M2.6 vectors
- M2.6 crypto vectors must pass before and after M3.2

## M3 exit criteria

- `bun run test:all` passes across all packages
- `bun run typecheck:all` zero errors  
- `bun run check:deps` zero boundary violations (dependency-cruiser)
- `bun run build` clean Chrome + Firefox builds
- E2E smoke: register, unlock + send, dApp sendTransaction
- M2.6 crypto vectors still pass in `@nulo/wallet-crypto`
</stdin>
codex
I’m auditing the plans against the actual repo structure and build setup first. I’ll inspect the current Vite/CRX config, the storage and messaging code, and the package/test configuration to separate real blockers from plan noise.
exec
/bin/zsh -lc 'rg --files packages/extension/src | rg "(wallet/base|wallet/storage|wallet/services/pxe|wallet/services/wallet-sdk|offscreen|components|composables|assets/styles|assets/fonts|core/ports|core/testing|wallet/utils|wallet/logger|wallet/config)"' in (project root)
 succeeded in 0ms:
packages/extension/src/assets/fonts/SpaceGrotesk-latin-ext.woff2
packages/extension/src/assets/fonts/SpaceGrotesk-latin.woff2
packages/extension/src/assets/fonts/JetBrainsMono-latin.woff2
packages/extension/src/assets/fonts/InterVariable.woff2
packages/extension/src/assets/fonts/ClashDisplay-Medium.ttf
packages/extension/src/assets/fonts/MaterialSymbolsOutlined.woff2
packages/extension/src/assets/styles/_base.scss
packages/extension/src/assets/styles/_text.scss
packages/extension/src/assets/styles/_flex.scss
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts
packages/extension/src/wallet/services/pxe/service.ts
packages/extension/src/wallet/services/pxe/artifact-registry.ts
packages/extension/src/wallet/services/pxe/proxy.ts
packages/extension/src/wallet/services/pxe/client.ts
packages/extension/src/wallet/services/pxe/spec.ts
packages/extension/src/wallet/services/pxe/chain-runtime.ts
packages/extension/src/wallet/services/pxe/chain-runtime.test.ts
packages/extension/src/wallet/services/pxe/known-artifacts.ts
packages/extension/src/wallet/storage/index.ts
packages/extension/src/wallet/storage/simple_storage.ts
packages/extension/src/wallet/storage/entity_storage.ts
packages/extension/src/wallet/storage/migrate.ts
packages/extension/src/wallet/storage/value-storage.ts
packages/extension/src/wallet/utils/fetch.ts
packages/extension/src/wallet/utils/queue.ts
packages/extension/src/wallet/utils/arrays.ts
packages/extension/src/wallet/utils/serialization.test.ts
packages/extension/src/wallet/utils/event-handler.ts
packages/extension/src/wallet/utils/index.ts
packages/extension/src/wallet/utils/fee-juice.ts
packages/extension/src/wallet/utils/random.ts
packages/extension/src/wallet/utils/caip.test.ts
packages/extension/src/wallet/utils/rw-guard.ts
packages/extension/src/wallet/utils/fn.ts
packages/extension/src/wallet/utils/mnemonic.test.ts
packages/extension/src/wallet/utils/schemas.ts
packages/extension/src/wallet/utils/mnemonic.ts
packages/extension/src/wallet/utils/auth-registry.ts
packages/extension/src/wallet/utils/lock.ts
packages/extension/src/wallet/utils/sleep.ts
packages/extension/src/wallet/utils/errors.ts
packages/extension/src/wallet/utils/serialization.ts
packages/extension/src/wallet/utils/offscreen.ts
packages/extension/src/wallet/utils/rw-guard.test.ts
packages/extension/src/wallet/utils/caip.ts
packages/extension/src/types/components.d.ts
packages/extension/src/wallet/base/zod-helpers.test.ts
packages/extension/src/wallet/base/errors.ts
packages/extension/src/wallet/base/errors.test.ts
packages/extension/src/wallet/base/zod-helpers.ts
packages/extension/src/wallet/base/index.ts
packages/extension/src/wallet/base/topology.test.ts
packages/extension/src/wallet/base/utils.ts
packages/extension/src/wallet/base/topology.ts
packages/extension/src/wallet/base/messages.ts
packages/extension/src/wallet/config/store.ts
packages/extension/src/wallet/config/config.ts
packages/extension/src/wallet/config/index.ts
packages/extension/src/wallet/base/background/service.ts
packages/extension/src/wallet/base/background/index.ts
packages/extension/src/wallet/base/background/client.ts
packages/extension/src/wallet/base/background/client.test.ts
packages/extension/src/wallet/base/offscreen/service.ts
packages/extension/src/wallet/base/offscreen/client.test.ts
packages/extension/src/wallet/base/offscreen/index.ts
packages/extension/src/wallet/base/offscreen/client.ts
packages/extension/src/wallet/base/offscreen/messages.ts
packages/extension/src/offscreen/index.ts
packages/extension/src/offscreen/index.html
packages/extension/src/wallet/services/wallet-sdk/dispatcher.ts
packages/extension/src/wallet/services/wallet-sdk/scope-enforcement.ts
packages/extension/src/wallet/services/wallet-sdk/capability-map.ts
packages/extension/src/wallet/services/wallet-sdk/discovery-queue.ts
packages/extension/src/wallet/services/wallet-sdk/scope-enforcement.test.ts
packages/extension/src/wallet/services/wallet-sdk/background.ts
packages/extension/src/wallet/services/wallet-sdk/types.ts
packages/extension/src/composables/toast.js
packages/extension/src/composables/configClient.ts
packages/extension/src/composables/externalLinks.ts
packages/extension/src/composables/syncedRef.js
packages/extension/src/composables/ticker.ts
packages/extension/src/composables/outside.js
packages/extension/src/composables/notification.js
packages/extension/src/composables/externalImage.ts
packages/extension/src/wallet/logger/store.ts
packages/extension/src/wallet/logger/index.ts
packages/extension/src/wallet/logger/utils.ts
packages/extension/src/wallet/logger/store.test.ts
packages/extension/src/popup/components/Navigation.vue
packages/extension/src/components/Header.vue
packages/extension/src/components/Divider.vue
packages/extension/src/components/update.vue
packages/extension/src/popup/components/popups/EditTokenPopup.vue
packages/extension/src/popup/components/popups/SelectBalanceTypePopup.vue
packages/extension/src/popup/components/popups/EditClaimParametersPopup.vue
packages/extension/src/popup/components/popups/NewAccountPopup.vue
packages/extension/src/popup/components/popups/EditAccountPopup.vue
packages/extension/src/popup/components/popups/NewFpcPopup.vue
packages/extension/src/popup/components/popups/ChangeProfilePasswordPopup.vue
packages/extension/src/popup/components/popups/SelectProfilePopup.vue
packages/extension/src/popup/components/popups/DataViewerPopup.vue
packages/extension/src/popup/components/popups/NetworksPopup.vue
packages/extension/src/popup/components/popups/EditFpcPopup.vue
packages/extension/src/popup/components/popups/SelectNetworksPopup.vue
packages/extension/src/popup/components/popups/ConfirmPopup.vue
packages/extension/src/popup/components/popups/ChangeAuthwitsRegistryPopup.vue
packages/extension/src/popup/components/popups/SelectFpcPopup.vue
packages/extension/src/components/install.vue
packages/extension/src/popup/components/popups/EditContactPopup.vue
packages/extension/src/popup/components/popups/NewContactPopup.vue
packages/extension/src/popup/components/popups/TokenMetadataPopup.vue
packages/extension/src/popup/components/popups/EditProfilePopup.vue
packages/extension/src/popup/components/popups/PopupManager.vue
packages/extension/src/popup/components/popups/SelectTokenPopup.vue
packages/extension/src/popup/components/popups/StealthPromoPopup.vue
packages/extension/src/popup/components/popups/ImportPopup.vue
packages/extension/src/popup/components/popups/NewSenderPopup.vue
packages/extension/src/popup/components/popups/AccountsPopup.vue
packages/extension/src/popup/components/popups/RevokeAuthwitsPopup.vue
packages/extension/src/popup/components/popups/ForgotPasswordPopup.vue
packages/extension/src/popup/components/popups/ReceivePopup.vue
packages/extension/src/popup/components/popups/EditNetworkPopup.vue
packages/extension/src/popup/components/popups/ResetPopup.vue
packages/extension/src/popup/components/popups/NewNetworkPopup.vue
packages/extension/src/core/ports/background-ticker-port.ts
packages/extension/src/core/ports/index.ts
packages/extension/src/core/ports/node-factory-port.ts
packages/extension/src/core/ports/types.ts
packages/extension/src/core/ports/alarms-port.ts
packages/extension/src/core/ports/storage-port.ts
packages/extension/src/core/ports/clock-port.ts
packages/extension/src/core/ports/window-port.ts
packages/extension/src/core/ports/browser-api.ts
packages/extension/src/core/ports/runtime-port.ts
packages/extension/src/popup/components/popups/ImportContactsPopup.vue
packages/extension/src/components/core/MaterialIcon.vue
packages/extension/src/components/core/Text.vue
packages/extension/src/components/core/Flex.vue
packages/extension/src/components/core/Icon.vue
packages/extension/src/core/testing/fake-node-factory.ts
packages/extension/src/core/testing/index.ts
packages/extension/src/core/testing/mock-clock.test.ts
packages/extension/src/core/testing/fake-background-ticker.ts
packages/extension/src/core/testing/fake-browser-api.ts
packages/extension/src/core/testing/mock-clock.ts
packages/extension/src/core/testing/fake-browser-api.test.ts
packages/extension/src/popup/components/modules/send/AmountCard.vue
packages/extension/src/popup/components/modules/send/SendTypesCard.vue
packages/extension/src/popup/components/modules/send/SelectTokenCard.vue
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue
packages/extension/src/popup/components/modules/send/FeeJuiceCard.vue
packages/extension/src/components/ui/LoadingState.vue
packages/extension/src/components/ui/Input.vue
packages/extension/src/components/ui/Checkbox.vue
packages/extension/src/components/ui/Spinner.vue
packages/extension/src/components/ui/Toggle.vue
packages/extension/src/components/ui/Button.vue
packages/extension/src/components/ui/NotificationManager.vue
packages/extension/src/components/ui/Badge.vue
packages/extension/src/components/ui/SubPageHeader.vue
packages/extension/src/components/ui/GlobalLoader.vue
packages/extension/src/components/ui/ToastManager.vue
packages/extension/src/components/ui/SectionLabel.vue
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue
packages/extension/src/components/ui/JsonViewer/creator.js
packages/extension/src/components/ui/JsonViewer/theme.js
packages/extension/src/components/ui/JsonViewer/JsonViewer.vue
packages/extension/src/components/ui/Tooltip.vue
packages/extension/src/components/ui/utils.ts
packages/extension/src/components/ui/AddressDisplay.vue
packages/extension/src/components/ui/Popover.vue
packages/extension/src/popup/components/popups/RegisterPopup/RegisterPopup.vue
packages/extension/src/popup/components/popups/RegisterPopup/WalletNameContent.vue
packages/extension/src/popup/components/popups/RegisterPopup/WalletTypeContent.vue
packages/extension/src/popup/components/popups/RegisterPopup/WalletPasswordContent.vue
packages/extension/src/popup/components/popups/NewTokenPopup/NewTokenPopup.vue
packages/extension/src/popup/components/popups/NewTokenPopup/CandidatesForm.vue
packages/extension/src/popup/components/modules/activity/TransactionsList.vue
packages/extension/src/popup/components/modules/activity/TransactionCard.vue
packages/extension/src/popup/components/modules/activity/TransactionAwaitingCard.vue
packages/extension/src/popup/components/modules/capabilities/CapabilityDetailPanel.vue
packages/extension/src/components/ui/Dropdown/DropdownDivider.vue
packages/extension/src/components/ui/Dropdown/DropdownItem.vue
packages/extension/src/components/ui/Dropdown/DropdownRoot.vue
packages/extension/src/components/ui/Dropdown/DropdownTrigger.vue
packages/extension/src/components/ui/Dropdown/DropdownTitle.vue
packages/extension/src/components/ui/Dropdown/index.js
packages/extension/src/components/ui/Banner.vue
packages/extension/src/components/ui/Settings/SettingValue.vue
packages/extension/src/components/ui/Settings/SettingField.vue
packages/extension/src/components/ui/Settings/SettingItem.vue
packages/extension/src/components/ui/Settings/PageHeader.vue
packages/extension/src/components/ui/Settings/ItemsContainer.vue
packages/extension/src/components/ui/Popup/PopupCard.vue
packages/extension/src/components/ui/Popup/Popup.vue
packages/extension/src/components/ui/Popup/PopupHeader.vue
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue
packages/extension/src/popup/components/modules/general/BalanceView.vue
packages/extension/src/popup/components/modules/general/TokensView.vue
packages/extension/src/popup/components/modules/general/RecentActivityView.vue
packages/extension/src/popup/components/modules/general/NetworkBadge.vue
packages/extension/src/popup/components/modules/general/ActionButtonsView.vue
packages/extension/src/popup/components/modules/general/WarningView.vue
packages/extension/src/popup/components/modules/general/EmojiGrid.vue
packages/extension/src/popup/components/modules/general/SplittedBalancesView.vue
packages/extension/src/popup/components/modules/general/TokenCard.vue

exec
/bin/zsh -lc "pwd && rg -n \"bb-fetch-code|useAutoImport|useComponents|dedupe|offscreen|__VERSION__|dependency-cruiser|depcruise|StorageType|wrapParams|unwrapParams|zod-helpers|chrome\\.storage|EntityStorage|ValueStorage|fake-browser|@crxjs/vite-plugin|@aztec/bb\\.js|loadPaths|vite-plugin-pages|@assets\" packages/extension -S" in (project root)
 succeeded in 0ms:
(project root)
packages/extension/vite.firefox.config.mts:2:import { crx } from "@crxjs/vite-plugin"
packages/extension/vite.config.ts:18:import usePages from "vite-plugin-pages"
packages/extension/vite.config.ts:19:import useAutoImport from "unplugin-auto-import/vite"
packages/extension/vite.config.ts:20:import useComponents from "unplugin-vue-components/vite"
packages/extension/vite.config.ts:44:			"@assets": fileURLToPath(new URL("src/assets", import.meta.url)),
packages/extension/vite.config.ts:63:		dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"],
packages/extension/vite.config.ts:68:				loadPaths: [fileURLToPath(new URL("./src/assets/styles", import.meta.url))],
packages/extension/vite.config.ts:78:			name: "bb-fetch-code-shim",
packages/extension/vite.config.ts:81:				if (importer?.includes("@aztec/bb.js") && source.includes("fetch_code") && source.endsWith("index.js")) {
packages/extension/vite.config.ts:82:					return fileURLToPath(new URL("./src/shims/bb-fetch-code.ts", import.meta.url))
packages/extension/vite.config.ts:109:		useAutoImport({
packages/extension/vite.config.ts:130:		useComponents({
packages/extension/vite.config.ts:160:					src: "./libs/@aztec/bb.js/*.wasm.gz",
packages/extension/vite.config.ts:177:				offscreen: "src/offscreen/index.html",
packages/extension/vite.config.ts:185:		exclude: ["@aztec/bb.js", "@aztec/noir-acvm_js", "@aztec/noir-noirc_abi", "vue-demi"],
packages/extension/vite.config.ts:191:		__VERSION__: JSON.stringify(packageJson.version),
packages/extension/src/shims/bb-fetch-code.ts:2: * Replacement for @aztec/bb.js fetchCode browser module.
packages/extension/src/shims/bb-fetch-code.ts:8: * The WASM files are copied to /assets/ by vite-plugin-static-copy from libs/@aztec/bb.js/.
packages/extension/manifest/manifest.chrome.config.ts:1:import { defineManifest } from "@crxjs/vite-plugin"
packages/extension/src/stores/app.store.ts:61:		const activeAccountResult = await chrome.storage.local.get("nulo:ui:activeAccount")
packages/extension/src/stores/app.store.ts:72:		await chrome.storage.local.set({
packages/extension/src/stores/app.store.ts:78:		await chrome.storage.local.set({
packages/extension/src/stores/app.store.ts:91:				await chrome.storage.local.set({
packages/extension/src/popup/pages/settings/about.vue:16:const version = __VERSION__
packages/extension/src/popup/app.vue:84:	const activeNetworkResult = await chrome.storage.local.get("nulo:ui:activeNetwork")
packages/extension/src/popup/app.vue:91:	const lastActiveNetworkId = (await chrome.storage.local.get(key))[key]
packages/extension/src/popup/app.vue:98:		chrome.storage.local.set({ [key]: appStore.network.id })
packages/extension/manifest/manifest.firefox.config.ts:1:import { defineManifest } from "@crxjs/vite-plugin"
packages/extension/src/offscreen/index.ts:6:import { OFFSCREEN_READY_MESSAGE, OFFSCREEN_PING, OFFSCREEN_PONG } from "@/wallet/utils/offscreen"
packages/extension/src/offscreen/index.ts:18:const logger = new LoggerServiceClient("offscreen")
packages/extension/tsconfig.json:14:			"@assets/*": ["./src/assets/*"]
packages/extension/src/wallet/services/auth-registry/service.ts:11:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/auth-registry/service.ts:28:	private readonly authwits = new EntityStorage<Authwit>("nulo:core:auth-registry", StorageType.Local)
packages/extension/src/wallet/services/auth-registry/service.ts:29:	private readonly statuses = new EntityStorage<boolean>("nulo:core:auth-registry-enabled", StorageType.Local)
packages/extension/manifest/manifest.config.ts:1:import type { ManifestV3Export } from "@crxjs/vite-plugin"
packages/extension/manifest/manifest.config.ts:33:	permissions: ["alarms", "offscreen", "storage", "sidePanel", "unlimitedStorage"],
packages/extension/tests/e2e/fixtures/extension.ts:17:	// Headless "new" mode supports MV3 extensions (offscreen docs, SW,
packages/extension/tests/e2e/fixtures/extension.ts:18:	// chrome.storage, chrome.runtime.Port) — unlike the legacy "shell"
packages/extension/tests/e2e/fixtures/extension.ts:19:	// headless which has no DOM and breaks offscreen. Setting HEADLESS=0
packages/extension/tests/e2e/fixtures/extension.ts:41:	// Wait for SW to fully initialize (liveness heartbeat in chrome.storage.session)
packages/extension/tests/e2e/fixtures/extension.ts:50:				const result = await chrome.storage.session.get("nulo:liveness")
packages/extension/package.json:31:		"@aztec/bb.js": "4.2.0-nightly.20260413",
packages/extension/package.json:70:		"@crxjs/vite-plugin": "^2.1.0",
packages/extension/package.json:75:		"@webext-core/fake-browser": "^1.3.4",
packages/extension/package.json:90:		"vite-plugin-pages": "^0.33.1",
packages/extension/tests/e2e/fixtures/helpers.ts:121:/** Read the active account address from chrome.storage. */
packages/extension/tests/e2e/fixtures/helpers.ts:124:		const result = await chrome.storage.local.get("nulo:ui:activeAccount")
packages/extension/src/core/ports/index.ts:14: *   - PxePort         — offscreen PXE RPC surface
packages/extension/vite.chrome.config.mts:2:import { crx } from "@crxjs/vite-plugin"
packages/extension/src/components/update.vue:2:const version = __VERSION__
packages/extension/tests/e2e/accounts.test.ts:73:		const result = await chrome.storage.local.get("nulo:ui:activeAccount")
packages/extension/tsconfig.node.json:11:			"@assets/*": ["./src/assets/*"]
packages/extension/src/components/install.vue:3:const version = __VERSION__
packages/extension/src/popup/pages/settings/fpcs/index.vue:157:		const fpms = (await chrome.storage.local.get(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}
packages/extension/src/popup/pages/settings/fpcs/index.vue:165:			await chrome.storage.local.set({ [FEE_METHOD_LS_KEY]: fpms })
packages/extension/src/wallet/services/token-balance/balance-repository.test.ts:5:/** The repo uses EntityStorage<TokenBalanceRaw> under the hood, backed
packages/extension/src/wallet/services/token-balance/balance-repository.test.ts:6: *  by chrome.storage.local. The global test setup stubs chrome.*. */
packages/extension/src/wallet/services/token-balance/balance-repository.test.ts:22:		// chrome.storage.local is stubbed globally in vitest.setup.ts via
packages/extension/src/wallet/services/token-balance/balance-repository.test.ts:23:		// chrome.runtime, but EntityStorage talks to chrome.storage.local
packages/extension/src/wallet/services/token-balance/balance-repository.test.ts:100:		const local = (globalThis as any).chrome.storage.local
packages/extension/src/core/ports/alarms-port.ts:5: *  - M4.4 offscreen keepalive bookkeeping
packages/extension/src/popup/pages/settings/networks/index.vue:41:	chrome.storage.local.set({ [`nulo:ui:lastActiveNetwork@${appStore.profile.id}`]: target.id })
packages/extension/src/popup/pages/settings/networks/index.vue:61:		chrome.storage.local.set({ [`nulo:ui:lastActiveNetwork@${appStore.profile.id}`]: appStore.network.id })
packages/extension/src/wallet/services/operation-journal/service.ts:4:import { validateParams } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/operation-journal/service.ts:6:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/operation-journal/service.ts:36:	private readonly storage: EntityStorage<OperationRecord>
packages/extension/src/wallet/services/operation-journal/service.ts:43:			? new EntityStorage<OperationRecord>("nulo:journal", browserApi.storage.session)
packages/extension/src/wallet/services/operation-journal/service.ts:44:			: new EntityStorage<OperationRecord>("nulo:journal", StorageType.Session)
packages/extension/src/wallet/services/token-balance/balance-repository.ts:7: * - `StorageType.Local`.
packages/extension/src/wallet/services/token-balance/balance-repository.ts:14:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/token-balance/balance-repository.ts:18:	private readonly storage: EntityStorage<TokenBalanceRaw>
packages/extension/src/wallet/services/token-balance/balance-repository.ts:21:		this.storage = new EntityStorage<TokenBalanceRaw>("nulo:core:token-balances", StorageType.Local)
packages/extension/src/core/ports/storage-port.ts:2: * `chrome.storage` abstracted. Two areas:
packages/extension/src/core/ports/storage-port.ts:6: * Mirrors the Chrome API shape directly. `EntityStorage` / `ValueStorage` sit
packages/extension/src/core/ports/storage-port.ts:15:/** Change set shape emitted by `onChange`. Mirrors `chrome.storage.onChanged`. */
packages/extension/src/wallet/services/operation-journal/client.ts:3:import { validateParams, validateResult } from "@/wallet/base/zod-helpers"
packages/extension/src/utils/core.ts:144:	await chrome.storage.local.set({ [sentinelPath]: __SENTINEL__ })
packages/extension/src/utils/core.ts:148:	return (await chrome.storage.local.get(sentinelPath))[sentinelPath] === __SENTINEL__
packages/extension/src/wallet/services/operation-journal/spec.ts:7: * `chrome.storage.session` — they survive SW suspension but are cleared on
packages/extension/src/core/ports/runtime-port.ts:3: *  - one-shot message passing (content-script ↔ SW, SW ↔ offscreen)
packages/extension/src/wallet/base/utils.ts:3:export const wrapParams = (params: unknown[]): Record<number, unknown> => {
packages/extension/src/wallet/base/utils.ts:10:export const unwrapParams = <T>(params: T): T => {
packages/extension/src/wallet/services/account/service.ts:7:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/account/service.ts:22:	private readonly storage = new EntityStorage<Account>("nulo:core:accounts", StorageType.Local)
packages/extension/src/popup/pages/settings/profile/index.vue:22:const version = __VERSION__
packages/extension/src/utils/lastActiveProfile.ts:8:	const result = await chrome.storage.local.get(LAST_ACTIVE_PROFILE_KEY)
packages/extension/src/utils/lastActiveProfile.ts:13:	await chrome.storage.local.set({ [LAST_ACTIVE_PROFILE_KEY]: id })
packages/extension/src/core/adapters/chrome-browser-api.ts:10: * 2. chrome.storage.local.onChanged / .session.onChanged are area-specific
packages/extension/src/core/adapters/chrome-browser-api.ts:37:	public constructor(private readonly area: chrome.storage.StorageArea) {}
packages/extension/src/core/adapters/chrome-browser-api.ts:40:		// chrome.storage.StorageArea.get's type overloads don't include
packages/extension/src/core/adapters/chrome-browser-api.ts:60:		const wrapped = (changes: { [key: string]: chrome.storage.StorageChange }) => {
packages/extension/src/core/adapters/chrome-browser-api.ts:69:	public readonly local: StorageArea = new ChromeStorageAreaAdapter(chrome.storage.local)
packages/extension/src/core/adapters/chrome-browser-api.ts:70:	public readonly session: StorageArea = new ChromeStorageAreaAdapter(chrome.storage.session)
packages/extension/src/core/adapters/chrome-browser-api.ts:151:		// offscreen supervision. The runtime.d.ts type is looser than ours.
packages/extension/src/wallet/services/logger/spec.ts:8:	 * @param context Execution context ("offscreen" | "popup" | etc.)
packages/extension/src/wallet/base/zod-helpers.test.ts:4:import { validateParams, validateResult } from "./zod-helpers"
packages/extension/src/popup/pages/settings/security/export/full.vue:57:const version = __VERSION__
packages/extension/src/core/testing/index.ts:7:export { FakeBrowserApi } from "./fake-browser-api"
packages/extension/src/wallet/base/offscreen/service.ts:5:import { OFFSCREEN_KEEPALIVE } from "@/wallet/utils/offscreen"
packages/extension/src/wallet/base/offscreen/service.ts:8:import { unwrapParams } from "../utils"
packages/extension/src/wallet/base/offscreen/service.ts:60:		const params = unwrapParams(wrappedParams)
packages/extension/src/wallet/base/offscreen/service.ts:102:			// (in offscreen/client.ts) will reject the caller's promise.
packages/extension/src/wallet/base/offscreen/client.test.ts:9:vi.mock("@/wallet/utils/offscreen", () => ({
packages/extension/src/wallet/base/offscreen/client.test.ts:65:describe("ServiceClient.request (offscreen transport base)", () => {
packages/extension/src/core/testing/fake-browser-api.ts:2: * BrowserApi implementation for tests. Wraps `@webext-core/fake-browser`'s
packages/extension/src/core/testing/fake-browser-api.ts:6: * Not a free-form mock: storage behaves like real chrome.storage (persists
packages/extension/src/core/testing/fake-browser-api.ts:16:import { fakeBrowser } from "@webext-core/fake-browser"
packages/extension/src/core/testing/fake-browser-api.ts:45:		// @webext-core/fake-browser follows webextension-polyfill's get() shape:
packages/extension/src/core/testing/fake-browser-api.ts:47:		// Real chrome.storage returns `{}` for missing keys. EntityStorage and
packages/extension/src/core/testing/fake-browser-api.ts:85:// fake-browser doesn't simulate chrome.runtime.connect / onConnect (long-lived
packages/extension/src/core/testing/fake-browser-api.ts:214:// fake-browser doesn't ship a chrome.windows fake. Minimal in-memory impl.
packages/extension/src/wallet/base/offscreen/client.ts:3:import { ensureOffscreenRunning } from "@/wallet/utils/offscreen"
packages/extension/src/wallet/base/offscreen/client.ts:8:import { wrapParams } from "../utils"
packages/extension/src/wallet/base/offscreen/client.ts:10:/** Timeout for offscreen requests (ms). PXE operations can take 60s+ (fetch timeout + proof gen). */
packages/extension/src/wallet/base/offscreen/client.ts:127:				params: jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>,
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:241:	const fpms = (await chrome.storage.local.get(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:243:	chrome.storage.local.set({ [FEE_METHOD_LS_KEY]: fpms })
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:299:			const saved = (await chrome.storage.local.get(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}
packages/extension/src/core/testing/fake-browser-api.test.ts:2:import { FakeBrowserApi } from "./fake-browser-api"
packages/extension/src/wallet/services/contact/service.ts:6:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/contact/service.ts:25:	private readonly storage: EntityStorage<Contact>
packages/extension/src/wallet/services/contact/service.ts:31:	 * @param browserApi — optional; if omitted, falls back to `chrome.storage`
packages/extension/src/wallet/services/contact/service.ts:38:			? new EntityStorage<Contact>("nulo:core:contacts", browserApi.storage.local)
packages/extension/src/wallet/services/contact/service.ts:39:			: new EntityStorage<Contact>("nulo:core:contacts", StorageType.Local)
packages/extension/src/wallet/base/background/service.ts:8:import { unwrapParams } from "../utils"
packages/extension/src/wallet/base/background/service.ts:72:		const params = unwrapParams(wrappedParams)
packages/extension/src/wallet/services/pxe/artifact-registry.test.ts:165:	test("ensureKnown dedupes concurrent calls", async () => {
packages/extension/src/wallet/services/pxe/service.ts:29:import { Service } from "@/wallet/base/offscreen"
packages/extension/src/composables/syncedRef.js:7:	chrome.storage.local.get([storageKey], (result) => {
packages/extension/src/composables/syncedRef.js:14:		chrome.storage.local.set({ [storageKey]: newVal })
packages/extension/src/composables/syncedRef.js:17:	chrome.storage.onChanged.addListener((changes, area) => {
packages/extension/src/composables/notification.js:38:						chrome.storage.local.remove("nulo:ui:feePaymentMethods")
packages/extension/src/wallet/services/contact/service.test.ts:5: * No chrome.storage mocks, no vi.mock() on modules — real in-memory state
packages/extension/src/wallet/services/contact/service.test.ts:6: * via @webext-core/fake-browser through FakeBrowserApi, real service
packages/extension/src/wallet/base/background/client.ts:9:import { wrapParams } from "../utils"
packages/extension/src/wallet/base/background/client.ts:141:				params: jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>,
packages/extension/src/wallet/services/transaction/service.ts:10:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/transaction/service.ts:36:	private readonly txs = new EntityStorage<Tx>("nulo:core:txs", StorageType.Local)
packages/extension/src/wallet/services/pxe/client.ts:21:import { ServiceClient } from "@/wallet/base/offscreen"
packages/extension/src/wallet/services/pxe/client.ts:98:		// Schema rehydrates data fields (Fr, AztecAddress, etc.) after JSON round-trip from offscreen,
packages/extension/src/wallet/runtime.ts:16:import { BarretenbergSync } from "@aztec/bb.js"
packages/extension/src/types/vite-env.d.ts:2:/// <reference types="vite-plugin-pages/client" />
packages/extension/src/types/vite-env.d.ts:4:declare const __VERSION__: string
packages/extension/src/popup/components/popups/NewNetworkPopup.vue:58:		chrome.storage.local.set({ [`nulo:ui:lastActiveNetwork@${appStore.profile.id}`]: network.id })
packages/extension/src/wallet/services/pxe/chain-runtime.ts:71:		// offscreen-document conditions even though the chunk is bundled,
packages/extension/src/wallet/storage/index.ts:1:export enum StorageType {
packages/extension/src/wallet/config/store.ts:1:import { StorageType, ValueStorage } from "@/wallet/storage"
packages/extension/src/wallet/config/store.ts:10:	private readonly storage = new ValueStorage<Config>("nulo:config", StorageType.Local)
packages/extension/src/wallet/logger/index.ts:13:export type LogContext = "sw" | "offscreen" | "popup" | "content"
packages/extension/src/wallet/storage/simple_storage.ts:1:import { StorageType } from "."
packages/extension/src/wallet/storage/simple_storage.ts:4:	private readonly storage: chrome.storage.StorageArea
packages/extension/src/wallet/storage/simple_storage.ts:7:	constructor(root: string, type: StorageType = StorageType.Local) {
packages/extension/src/wallet/storage/simple_storage.ts:9:		this.storage = type === StorageType.Local ? chrome.storage.local : chrome.storage.session
packages/extension/src/wallet/crypto/key-vectors.test.ts:57: * cross-check) all require `@aztec/bb.js` WASM poseidon2, which
packages/extension/src/wallet/logger/store.ts:45:	/** Log with explicit context (used by LoggerService for offscreen/popup forwarding). */
packages/extension/src/wallet/logger/store.ts:64:	/** Rehydrate logs from chrome.storage.session (call on startup before wiring services). */
packages/extension/src/wallet/logger/store.ts:67:			const result = await chrome.storage.session.get("nulo:logs")
packages/extension/src/wallet/logger/store.ts:80:	/** Debounced flush of recent logs to chrome.storage.session for crash recovery. */
packages/extension/src/wallet/logger/store.ts:87:				chrome.storage.session.set({ "nulo:logs": items })
packages/extension/src/wallet/storage/value-storage.ts:2:import { StorageType } from "."
packages/extension/src/wallet/storage/value-storage.ts:5: * Minimal storage surface ValueStorage actually uses. Both
packages/extension/src/wallet/storage/value-storage.ts:6: * `chrome.storage.StorageArea` (legacy path) and our port's `StorageArea`
packages/extension/src/wallet/storage/value-storage.ts:15:export class ValueStorage<T> {
packages/extension/src/wallet/storage/value-storage.ts:20:	 * Two constructor shapes — mirrors `EntityStorage` exactly:
packages/extension/src/wallet/storage/value-storage.ts:21:	 * 1. Legacy — pass a `StorageType` enum value; reaches into `chrome.storage`.
packages/extension/src/wallet/storage/value-storage.ts:25:	constructor(root: string, areaOrType: StorageType | StorageArea = StorageType.Local) {
packages/extension/src/wallet/storage/value-storage.ts:28:			this.storage = areaOrType === StorageType.Local ? chrome.storage.local : chrome.storage.session
packages/extension/src/wallet/services/pxe/chain-runtime.test.ts:70:	test("getOrInit dedupes concurrent calls for same key", async () => {
packages/extension/src/popup/components/popups/ResetPopup.vue:61:		chrome.storage.local.remove("nulo:ui:feePaymentMethods")
packages/extension/src/wallet/storage/migrate.ts:28:	const result = await chrome.storage.local.get(STORAGE_VERSION_KEY)
packages/extension/src/wallet/storage/migrate.ts:35:	await chrome.storage.local.remove(KEYS_TO_WIPE)
packages/extension/src/wallet/storage/migrate.ts:50:	await chrome.storage.local.set({ [STORAGE_VERSION_KEY]: CURRENT_VERSION })
packages/extension/src/wallet/storage/entity_storage.ts:3:import { StorageType } from "."
packages/extension/src/wallet/storage/entity_storage.ts:6: * Minimal storage surface EntityStorage actually uses. Both
packages/extension/src/wallet/storage/entity_storage.ts:7: * `chrome.storage.StorageArea` (legacy path) and our port's `StorageArea`
packages/extension/src/wallet/storage/entity_storage.ts:16:export class EntityStorage<T> {
packages/extension/src/wallet/storage/entity_storage.ts:22:	 * 1. Legacy — pass a `StorageType` enum value; reaches into `chrome.storage`.
packages/extension/src/wallet/storage/entity_storage.ts:26:	public constructor(root: string, areaOrType: StorageType | StorageArea = StorageType.Local) {
packages/extension/src/wallet/storage/entity_storage.ts:29:			this.storage = areaOrType === StorageType.Local ? chrome.storage.local : chrome.storage.session
packages/extension/src/wallet/logger/store.test.ts:30:// Clean up any globals set by tests (e.g., chrome.storage mock)
packages/extension/src/wallet/logger/store.test.ts:122:			store.logWithContext("offscreen", "pxe", LogLevel.Debug, "msg")
packages/extension/src/wallet/logger/store.test.ts:125:			expect(log.context).toBe("offscreen")
packages/extension/src/wallet/logger/store.test.ts:197:		test("gracefully handles missing chrome.storage.session", async () => {
packages/extension/src/wallet/logger/store.test.ts:199:			// chrome.storage.session not defined in test env — should not throw
packages/extension/src/wallet/logger/store.test.ts:204:			// Mock chrome.storage.session
packages/extension/src/wallet/logger/store.test.ts:207:				{ id: 10, timestamp: 2000, source: "test", level: LogLevel.Debug, context: "offscreen" as const, data: ["saved2"] },
packages/extension/src/wallet/logger/store.test.ts:209:			// biome-ignore lint/suspicious/noExplicitAny: test setup — mocking chrome.storage.session
packages/extension/src/wallet/services/token/service.ts:10:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/token/service.ts:39:	private readonly tokens = new EntityStorage<Token>("nulo:core:tokens", StorageType.Local)
packages/extension/src/popup/components/popups/NewAccountPopup.vue:47:	await chrome.storage.local.set({
packages/extension/src/popup/components/modules/general/BalanceView.vue:214:	const oldResult = await chrome.storage.local.get(oldKey)
packages/extension/src/popup/components/modules/general/BalanceView.vue:217:		await chrome.storage.local.remove(oldKey)
packages/extension/src/popup/components/modules/general/BalanceView.vue:222:		const result = await chrome.storage.local.get(newKey)
packages/extension/src/popup/components/modules/general/BalanceView.vue:231:		await chrome.storage.local.set({ [newKey]: optionsMap })
packages/extension/src/popup/components/modules/general/BalanceView.vue:239:	const result = await chrome.storage.local.get(key)
packages/extension/src/popup/components/modules/general/BalanceView.vue:247:		await chrome.storage.local.set({ [key]: optionsMap })
packages/extension/src/popup/components/modules/general/BalanceView.vue:255:	const result = await chrome.storage.local.get(key)
packages/extension/src/popup/components/modules/general/BalanceView.vue:260:		await chrome.storage.local.set({ [key]: optionsMap })
packages/extension/src/wallet/utils/offscreen.ts:6:let offscreenTimeout: NodeJS.Timeout
packages/extension/src/wallet/utils/offscreen.ts:7:let offscreenPromise: Promise<void> | null = null
packages/extension/src/wallet/utils/offscreen.ts:14:const path = "src/offscreen/index.html"
packages/extension/src/wallet/utils/offscreen.ts:15:const offscreenUrl = chrome.runtime.getURL(path)
packages/extension/src/wallet/utils/offscreen.ts:19:		clearTimeout(offscreenTimeout)
packages/extension/src/wallet/utils/offscreen.ts:21:		offscreenPromise = null
packages/extension/src/wallet/utils/offscreen.ts:27:	// Kill the half-initialized offscreen so it doesn't become a ghost
packages/extension/src/wallet/utils/offscreen.ts:28:	chrome.offscreen.closeDocument().catch(() => {})
packages/extension/src/wallet/utils/offscreen.ts:30:	offscreenPromise = null
packages/extension/src/wallet/utils/offscreen.ts:34: * Check if the existing offscreen document is responsive.
packages/extension/src/wallet/utils/offscreen.ts:56:			// No receiver — offscreen is definitely dead
packages/extension/src/wallet/utils/offscreen.ts:65: * Close any existing offscreen document, ignoring errors.
packages/extension/src/wallet/utils/offscreen.ts:69:		await chrome.offscreen.closeDocument()
packages/extension/src/wallet/utils/offscreen.ts:76: * Create the offscreen document. Handles the Chrome ghost bug where
packages/extension/src/wallet/utils/offscreen.ts:81:		await chrome.offscreen.createDocument({
packages/extension/src/wallet/utils/offscreen.ts:87:		if (String(err).includes("single offscreen document")) {
packages/extension/src/wallet/utils/offscreen.ts:88:			// Ghost offscreen — close it and retry once
packages/extension/src/wallet/utils/offscreen.ts:90:			await chrome.offscreen.createDocument({
packages/extension/src/wallet/utils/offscreen.ts:104:		documentUrls: [offscreenUrl],
packages/extension/src/wallet/utils/offscreen.ts:112:		// Zombie offscreen — kill it and recreate below
packages/extension/src/wallet/utils/offscreen.ts:116:	if (!offscreenPromise) {
packages/extension/src/wallet/utils/offscreen.ts:117:		offscreenPromise = new Promise((resolve, reject) => {
packages/extension/src/wallet/utils/offscreen.ts:121:		offscreenTimeout = setTimeout(onOffscreenTimeout, READY_TIMEOUT_MS)
packages/extension/src/wallet/utils/offscreen.ts:126:			clearTimeout(offscreenTimeout)
packages/extension/src/wallet/utils/offscreen.ts:128:			offscreenPromise = null
packages/extension/src/wallet/utils/offscreen.ts:133:	await offscreenPromise
packages/extension/src/popup/components/popups/NetworksPopup.vue:37:		chrome.storage.local.set({ [`nulo:ui:lastActiveNetwork@${appStore.profile.id}`]: target.id })
packages/extension/src/wallet/services/fpc/service.ts:8:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/fpc/service.ts:34:	private readonly storage = new EntityStorage<FpcInfo>("nulo:core:fpcs", StorageType.Local)
packages/extension/src/wallet/services/network/service.ts:4:import { validateParams } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/network/service.ts:9:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/network/service.ts:25:	private readonly storage = new EntityStorage<Network>("nulo:core:networks", StorageType.Local)
packages/extension/src/wallet/services/network/client.ts:3:import { validateParams, validateResult } from "@/wallet/base/zod-helpers"
packages/extension/src/popup/components/popups/RegisterPopup/RegisterPopup.vue:123:	await chrome.storage.local.set({
packages/extension/src/wallet/services/execution/contract-resolver.test.ts:23:/** Minimal IConfig stand-in — avoids ConfigStore's chrome.storage touch
packages/extension/src/wallet/services/execution/contract-resolver.test.ts:82:	test("dedupes duplicate addresses across action kinds", () => {
packages/extension/src/wallet/services/execution/contract-resolver.test.ts:160:	test("dedupes by class id — one fetch per unique class", async () => {
packages/extension/src/wallet/services/profile/service.ts:41:	 *        `chrome.storage.local / session`.
packages/extension/src/wallet/services/profile/session-manager.test.ts:4: * Uses FakeBrowserApi — no chrome.storage, no real crypto. Focus:
packages/extension/src/wallet/services/profile/session-manager.test.ts:21: *  invoking `onUpdate` directly; avoids ConfigStore's chrome.storage
packages/extension/src/wallet/services/profile/repository.test.ts:4: * Constructable with FakeBrowserApi, no chrome.storage mocks, no real
packages/extension/src/wallet/services/profile/repository.ts:5: * an `EntityStorage<Profile>`, plus a single helper for the id-generation
packages/extension/src/wallet/services/profile/repository.ts:19:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/profile/repository.ts:34:	private readonly storage: EntityStorage<Profile>
packages/extension/src/wallet/services/profile/repository.ts:40:	 *        adapter. If omitted, falls back to `chrome.storage.local`
packages/extension/src/wallet/services/profile/repository.ts:45:			? new EntityStorage<Profile>(PROFILE_STORAGE_ROOT, browserApi.storage.local)
packages/extension/src/wallet/services/profile/repository.ts:46:			: new EntityStorage<Profile>(PROFILE_STORAGE_ROOT, StorageType.Local)
packages/extension/src/wallet/services/dapp-session/service.ts:5:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/dapp-session/service.ts:29:	private readonly storage = new EntityStorage<DappSession>("nulo:core:dappSessions", StorageType.Local)
packages/extension/src/wallet/services/profile/session-manager.ts:3: * `Session` mirror in `chrome.storage.session`.
packages/extension/src/wallet/services/profile/session-manager.ts:10: * Frozen storage key: `nulo:core:session` in `chrome.storage.session`.
packages/extension/src/wallet/services/profile/session-manager.ts:52:import { StorageType, ValueStorage } from "@/wallet/storage"
packages/extension/src/wallet/services/profile/session-manager.ts:83:	private readonly session: ValueStorage<Session>
packages/extension/src/wallet/services/profile/session-manager.ts:100:	 *                    `chrome.storage.session` for legacy SW startup.
packages/extension/src/wallet/services/profile/session-manager.ts:112:			? new ValueStorage<Session>(SESSION_STORAGE_ROOT, browserApi.storage.session)
packages/extension/src/wallet/services/profile/session-manager.ts:113:			: new ValueStorage<Session>(SESSION_STORAGE_ROOT, StorageType.Session)
packages/extension/src/wallet/services/profile/session-manager.ts:153:	 *  did the same because a broken chrome.storage write at unlock time

exec
/bin/zsh -lc "rg --files packages/extension | rg \"(vite\\.config|vitest\\.config|tsconfig|package\\.json|manifest)\"" in (project root)
 succeeded in 0ms:
packages/extension/vitest.config.ts
packages/extension/vite.config.ts
packages/extension/tsconfig.json
packages/extension/package.json
packages/extension/tsconfig.node.json
packages/extension/manifest/manifest.chrome.config.ts
packages/extension/manifest/manifest.firefox.config.ts
packages/extension/manifest/manifest.config.ts

codex
I’ve confirmed the main pressure points are real: the storage fallback still exists, the bb.js shim is importer-sensitive, and the CRX build currently pins offscreen via `src/offscreen/index.html`. I’m opening the exact files now to verify where the plans are correct and where they would break.
exec
/bin/zsh -lc "sed -n '1,260p' packages/extension/vite.config.ts" in (project root)
 succeeded in 0ms:
import { existsSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"

/** Resolve a file inside an npm package, bypassing its `exports` field.
 *  Walks up from this config file to find the package in any node_modules. */
function resolvePackageFile(pkg: string, file: string): string {
	const parts = pkg.startsWith("@") ? pkg.split("/").slice(0, 2) : [pkg.split("/")[0]]
	let dir = fileURLToPath(new URL(".", import.meta.url))
	while (dir !== dirname(dir)) {
		const candidate = join(dir, "node_modules", ...parts, file)
		if (existsSync(candidate)) return candidate
		dir = dirname(dir)
	}
	throw new Error(`Cannot find ${pkg}/${file} in any node_modules`)
}
import usePages from "vite-plugin-pages"
import useAutoImport from "unplugin-auto-import/vite"
import useComponents from "unplugin-vue-components/vite"
import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import packageJson from "./package.json"
import { viteStaticCopy } from "vite-plugin-static-copy"

export default defineConfig({
	server: {
		port: 8088,
		strictPort: true,
		hmr: {
			port: 8088,
		},
		// Headers needed for bb WASM to work in multithreaded mode
		headers: {
			"Cross-Origin-Embedder-Policy": "require-corp",
			"Cross-Origin-Opener-Policy": "same-origin",
		},
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			"~": fileURLToPath(new URL("./src", import.meta.url)),
			src: fileURLToPath(new URL("./src", import.meta.url)),
			"@assets": fileURLToPath(new URL("src/assets", import.meta.url)),
			"@private-fpc-artifact": resolvePackageFile("@wonderland/aztec-fee-payment", "target/private_contract-PrivateFPC.json"),
			"@wonderland-token-artifact": resolvePackageFile(
				"@defi-wonderland/aztec-standards",
				"artifacts/target/token_contract-Token.json",
			),
			"@alejoamiras/aztec-accelerator": resolvePackageFile("@alejoamiras/aztec-accelerator", "dist/index.js"),
			// Force detect-node to return false so @aztec/foundation's pino logger
			// uses the browser transport instead of Node.js worker-thread transport.
			// Without this, the node-polyfills process shim makes detect-node think
			// we're in Node.js, causing pino.transport() to fail with "window is not defined".
			"detect-node": fileURLToPath(new URL("./src/shims/detect-node.ts", import.meta.url)),
			comlink: "comlink",
			debug: "debug",
		},
		// Force Vite to resolve these WASM-binding packages to a single copy.
		// Multiple nested versions exist in node_modules (rc.2 in simulator/pxe,
		// rc.4 hoisted). Without dedup, initAbi() and abiEncode() end up in
		// different module scopes, so the WASM instance variable is never shared.
		dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"],
	},
	css: {
		preprocessorOptions: {
			scss: {
				loadPaths: [fileURLToPath(new URL("./src/assets/styles", import.meta.url))],
				quietDeps: true,
			},
		},
	},
	plugins: [
		// Replace bb.js fetchCode module to eliminate dynamic import() of embedded WASM.
		// Chrome MV3 service workers forbid import() at runtime. Our shim uses fetch()
		// against the WASM files in /assets/ instead.
		{
			name: "bb-fetch-code-shim",
			enforce: "pre",
			resolveId(source, importer) {
				if (importer?.includes("@aztec/bb.js") && source.includes("fetch_code") && source.endsWith("index.js")) {
					return fileURLToPath(new URL("./src/shims/bb-fetch-code.ts", import.meta.url))
				}
			},
		},
		vue(),

		usePages({
			dirs: [
				{
					dir: "src/pages",
					baseRoute: "common",
				},
				{
					dir: "src/setup/pages",
					baseRoute: "setup",
				},
				{
					dir: "src/popup/pages",
					baseRoute: "popup",
				},
				{
					dir: "src/popup/windows",
					baseRoute: "windows",
				},
			],
		}),

		useAutoImport({
			imports: [
				"vue",
				"vue-router",
				{
					"webextension-polyfill": [["*", "browser"]],
				},
			],
			dts: "src/types/auto-imports.d.ts",
			dirs: ["src/composables/", "src/stores/", "src/utils/"],
			// Rewrites compiled _ctx.<name> template references to resolve against the
			// auto-import registry so {{ trimAddress(...) }} works without explicit
			// imports in every SFC. Plugin runs enforce:"post" internally — must stay
			// after vue() in the plugin chain.
			vueTemplate: true,
			eslintrc: {
				enabled: true,
				filepath: "src/types/.eslintrc-auto-import.json",
			},
		}),

		useComponents({
			dirs: ["src/components"],
			dts: "src/types/components.d.ts",
		}),

		{
			name: "assets-rewrite",
			enforce: "post",
			apply: "build",
			transformIndexHtml(html, { path }) {
				const assetsPath = relative(dirname(path), "/assets").replace(/\\/g, "/")
				return html.replace(/"\/assets\//g, `"${assetsPath}/`)
			},
		},

		{
			name: "wasm-content-type",
			configureServer(server) {
				server.middlewares.use((req, res, next) => {
					if (req.url?.endsWith(".wasm")) {
						res.setHeader("Content-Type", "application/wasm")
					}
					next()
				})
			},
		},

		viteStaticCopy({
			targets: [
				{
					src: "./libs/@aztec/bb.js/*.wasm.gz",
					dest: "assets/",
				},
			],
		}),

		nodePolyfills({
			include: ["buffer", /*"crypto",*/ "net", "path", "stream", "tty", "vm", "util"],
		}),
	],
	build: {
		// Disable module preload polyfill — it references `window.dispatchEvent`
		// which doesn't exist in Chrome MV3 service workers.
		modulePreload: false,
		target: "esnext",
		rollupOptions: {
			input: {
				offscreen: "src/offscreen/index.html",
				popup: "src/popup/index.html",
				setup: "src/setup/index.html",
			},
		},
	},
	optimizeDeps: {
		include: ["pino", "vue", "webextension-polyfill"],
		exclude: ["@aztec/bb.js", "@aztec/noir-acvm_js", "@aztec/noir-noirc_abi", "vue-demi"],
		esbuildOptions: {
			target: "esnext",
		},
	},
	define: {
		__VERSION__: JSON.stringify(packageJson.version),
		__SENTINEL__: JSON.stringify(packageJson.sentinel),
		__AZTEC_VERSION__: JSON.stringify(packageJson.dependencies["@aztec/pxe"] ?? "unknown"),
		__NAME__: JSON.stringify(packageJson.name),
		__DISPLAY_NAME__: JSON.stringify(packageJson.displayName),
		"import.meta.env.HTML_TITLE": JSON.stringify(packageJson.displayName),
		"process.browser": true,
		"process.env": JSON.stringify({
			LOG_LEVEL: "verbose",
			BB_WASM_PATH: "/assets/barretenberg.wasm.gz",
		}),
	},
})

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/offscreen/index.ts && printf '\\n---HTML---\\n' && sed -n '1,220p' packages/extension/src/offscreen/index.html" in (project root)
exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/manifest/manifest.config.ts && printf '\\n---CHROME---\\n' && sed -n '1,220p' packages/extension/manifest/manifest.chrome.config.ts && printf '\\n---FIREFOX---\\n' && sed -n '1,220p' packages/extension/manifest/manifest.firefox.config.ts" in (project root)
 succeeded in 0ms:
import { ServiceCollection } from "@/wallet/base"
import { consoleMethods, LogLevel } from "@/wallet/logger"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { PxeService } from "@/wallet/services/pxe/service"
import { getErrorData } from "@/wallet/utils/errors"
import { OFFSCREEN_READY_MESSAGE, OFFSCREEN_PING, OFFSCREEN_PONG } from "@/wallet/utils/offscreen"

// Respond to health check pings from the service worker.
// Registered before anything else so even a slow init doesn't block pong.
chrome.runtime.onMessage.addListener((message) => {
	if (message === OFFSCREEN_PING) {
		chrome.runtime.sendMessage(OFFSCREEN_PONG).catch(() => {})
	}
	return false
})

// catch console
const logger = new LoggerServiceClient("offscreen")
for (const [method, level] of consoleMethods) {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic global property + console varargs
	;(self as any)[`on${method}`] = (...args: any[]) => {
		logger.log("pxe", level, ...args)
	}
}

// catch unhandled errors
self.onunhandledrejection = (e: PromiseRejectionEvent) => {
	try {
		logger.log("pxe", LogLevel.Error, getErrorData(e.reason))
	} catch {
		// Logger itself may fail if SW is dead — don't cascade
	}
}

// run services — await initialization before signaling ready
const t0 = Date.now()
const services = new ServiceCollection()
services.add(new PxeService())
await services.start()
logger.log("pxe", LogLevel.Info, `Offscreen services initialized (${Date.now() - t0}ms)`)

// notify bg only after services are actually initialized
chrome.runtime.sendMessage(OFFSCREEN_READY_MESSAGE)

---HTML---
<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<script type="module" src="../utils/console-sniffer.ts"></script>
	</head>
	<body>
		<script type="module" src="./index.ts"></script>
	</body>
</html>

 succeeded in 0ms:
import type { ManifestV3Export } from "@crxjs/vite-plugin"
import packageJson from "../package.json"

const { version, name, description, displayName } = packageJson

const [major, minor, patch, label = "0"] = version.replace(/[^\d.-]+/g, "").split(/[.-]/)

export default {
	name: displayName || name,
	description,
	version: `${major}.${minor}.${patch}.${label}`,
	version_name: version,
	manifest_version: 3,
	host_permissions: ["https://nulo.sh/"],
	action: {
		default_popup: "src/popup/index.html#/popup/general",
	},
	background: {
		service_worker: "src/wallet/index.ts",
		type: "module",
	},
	side_panel: {
		default_path: "src/popup/index.html",
	},
	content_scripts: [
		{
			all_frames: true,
			js: ["src/content-script/content.ts"],
			matches: ["*://*/*"],
			run_at: "document_start",
		},
	],
	permissions: ["alarms", "offscreen", "storage", "sidePanel", "unlimitedStorage"],
	optional_permissions: ["downloads"],
	content_security_policy: {
		extension_pages: "script-src 'self' 'wasm-unsafe-eval'",
	},
	cross_origin_embedder_policy: {
		value: "require-corp",
	},
	cross_origin_opener_policy: {
		value: "same-origin",
	},
	icons: {
		16: "src/assets/logo.png",
		24: "src/assets/logo.png",
		32: "src/assets/logo.png",
		128: "src/assets/logo.png",
	},
	web_accessible_resources: [
		{
			matches: ["*://*/*"],
			resources: ["src/assets/logo.png"],
		},
	],
} as ManifestV3Export

---CHROME---
import { defineManifest } from "@crxjs/vite-plugin"

import ManifestConfig from "./manifest.config"

// @ts-expect-error ManifestConfig provides all required fields
export default defineManifest((_env) => ({
	...ManifestConfig,
}))

---FIREFOX---
import { defineManifest } from "@crxjs/vite-plugin"
import ManifestConfig from "./manifest.config"

// @ts-expect-error ManifestConfig provides all required fields
export default defineManifest((_env) => ({
	...ManifestConfig,
	browser_specific_settings: {
		gecko: {
			id: "{}",
		},
	},
	background: {
		scripts: ["src/wallet/index.ts"],
		type: "module",
		persistent: false,
	},
	// @ts-expect-error
	permissions: ManifestConfig.permissions.filter((permission) => permission !== "background"),
}))

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/utils/offscreen.ts" in (project root)
 succeeded in 0ms:
export const OFFSCREEN_READY_MESSAGE = "OFFSCREEN_READY"
export const OFFSCREEN_PING = "OFFSCREEN_PING"
export const OFFSCREEN_PONG = "OFFSCREEN_PONG"
export const OFFSCREEN_KEEPALIVE = "OFFSCREEN_KEEPALIVE"

let offscreenTimeout: NodeJS.Timeout
let offscreenPromise: Promise<void> | null = null
let resolveOffscreenPromise: () => void
let rejectOffscreenPromise: (reason: string) => void

const HEALTH_CHECK_TIMEOUT_MS = 3_000
const READY_TIMEOUT_MS = 10_000

const path = "src/offscreen/index.html"
const offscreenUrl = chrome.runtime.getURL(path)
const onOffscreenReady = (message: unknown) => {
	if (message === OFFSCREEN_READY_MESSAGE) {
		chrome.runtime.onMessage.removeListener(onOffscreenReady)
		clearTimeout(offscreenTimeout)
		resolveOffscreenPromise()
		offscreenPromise = null
	}
	return false
}
const onOffscreenTimeout = () => {
	chrome.runtime.onMessage.removeListener(onOffscreenReady)
	// Kill the half-initialized offscreen so it doesn't become a ghost
	chrome.offscreen.closeDocument().catch(() => {})
	rejectOffscreenPromise("Offscreen is not responding")
	offscreenPromise = null
}

/**
 * Check if the existing offscreen document is responsive.
 * Sends a ping and waits for a pong within HEALTH_CHECK_TIMEOUT_MS.
 * Returns true if healthy, false if zombie/unresponsive.
 */
async function isOffscreenHealthy(): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => {
			chrome.runtime.onMessage.removeListener(onPong)
			resolve(false)
		}, HEALTH_CHECK_TIMEOUT_MS)

		const onPong = (message: unknown) => {
			if (message === OFFSCREEN_PONG) {
				chrome.runtime.onMessage.removeListener(onPong)
				clearTimeout(timer)
				resolve(true)
			}
			return false
		}

		chrome.runtime.onMessage.addListener(onPong)
		chrome.runtime.sendMessage(OFFSCREEN_PING).catch(() => {
			// No receiver — offscreen is definitely dead
			chrome.runtime.onMessage.removeListener(onPong)
			clearTimeout(timer)
			resolve(false)
		})
	})
}

/**
 * Close any existing offscreen document, ignoring errors.
 */
async function closeOffscreen() {
	try {
		await chrome.offscreen.closeDocument()
	} catch {
		// Already closed or Chrome cleaned it up
	}
}

/**
 * Create the offscreen document. Handles the Chrome ghost bug where
 * getContexts() returns empty but createDocument() throws "already exists".
 */
async function createOffscreen() {
	try {
		await chrome.offscreen.createDocument({
			url: path,
			reasons: ["WORKERS"],
			justification: "Offscreen document is used for running PXE in it",
		})
	} catch (err) {
		if (String(err).includes("single offscreen document")) {
			// Ghost offscreen — close it and retry once
			await closeOffscreen()
			await chrome.offscreen.createDocument({
				url: path,
				reasons: ["WORKERS"],
				justification: "Offscreen document is used for running PXE in it",
			})
		} else {
			throw err
		}
	}
}

export async function ensureOffscreenRunning() {
	const existingContexts = await chrome.runtime.getContexts({
		contextTypes: ["OFFSCREEN_DOCUMENT"],
		documentUrls: [offscreenUrl],
	})

	if (existingContexts.length > 0) {
		// Offscreen exists — verify it's actually responsive
		if (await isOffscreenHealthy()) {
			return
		}
		// Zombie offscreen — kill it and recreate below
		await closeOffscreen()
	}

	if (!offscreenPromise) {
		offscreenPromise = new Promise((resolve, reject) => {
			resolveOffscreenPromise = resolve
			rejectOffscreenPromise = reject
		})
		offscreenTimeout = setTimeout(onOffscreenTimeout, READY_TIMEOUT_MS)
		chrome.runtime.onMessage.addListener(onOffscreenReady)
		try {
			await createOffscreen()
		} catch (err) {
			clearTimeout(offscreenTimeout)
			chrome.runtime.onMessage.removeListener(onOffscreenReady)
			offscreenPromise = null
			throw err
		}
	}

	await offscreenPromise
}

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/storage/entity_storage.ts && printf '\\n---\\n' && sed -n '1,220p' packages/extension/src/wallet/storage/value-storage.ts && printf '\\n---INDEX---\\n' && sed -n '1,220p' packages/extension/src/wallet/storage/index.ts" in (project root)
exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/base/utils.ts && printf '\\n---BG SERVICE---\\n' && sed -n '1,240p' packages/extension/src/wallet/base/background/service.ts && printf '\\n---BG CLIENT---\\n' && sed -n '1,240p' packages/extension/src/wallet/base/background/client.ts" in (project root)
 succeeded in 0ms:
import type { StorageArea } from "@/core/ports"

import { StorageType } from "."

/**
 * Minimal storage surface EntityStorage actually uses. Both
 * `chrome.storage.StorageArea` (legacy path) and our port's `StorageArea`
 * (injected path, used by tests via FakeBrowserApi) satisfy it.
 */
type MinimalArea = {
	get(keys?: string | string[] | null): Promise<Record<string, unknown>>
	set(items: Record<string, unknown>): Promise<void>
	remove(keys: string | string[]): Promise<void>
}

export class EntityStorage<T> {
	private readonly storage: MinimalArea
	private readonly root: string

	/**
	 * Two constructor shapes:
	 * 1. Legacy — pass a `StorageType` enum value; reaches into `chrome.storage`.
	 * 2. Injected — pass a `StorageArea` port; used by tests and the future
	 *    composition root.
	 */
	public constructor(root: string, areaOrType: StorageType | StorageArea = StorageType.Local) {
		this.root = root
		if (typeof areaOrType === "number") {
			this.storage = areaOrType === StorageType.Local ? chrome.storage.local : chrome.storage.session
		} else {
			this.storage = areaOrType as MinimalArea
		}
	}

	public async getVersion(): Promise<number> {
		const res = await this.storage.get(this.root)
		return this.root in res ? JSON.parse(res[this.root] as string) : 0
	}

	public setVersion(version: number): Promise<void> {
		return this.storage.set({ [this.root]: JSON.stringify(version) })
	}

	public async contains(id: string): Promise<boolean> {
		const key = `${this.root}@${id}`
		const res = await this.storage.get(key)
		return key in res
	}

	public async get(id: string): Promise<T | undefined> {
		const key = `${this.root}@${id}`
		const res = await this.storage.get(key)
		if (key in res) {
			return JSON.parse(res[key] as string)
		}
		return undefined
	}

	public set(id: string, entity: T): Promise<void> {
		return this.storage.set({ [`${this.root}@${id}`]: JSON.stringify(entity) })
	}

	public delete(id: string): Promise<void> {
		return this.storage.remove(`${this.root}@${id}`)
	}

	public async getAll(): Promise<Array<[string, T]>> {
		const path = `${this.root}@`
		const res = await this.storage.get(null)
		return Object.entries(res)
			.filter(([k, _]) => k.startsWith(path))
			.map(([k, v]) => [k.substring(path.length), JSON.parse(v as string)])
	}

	public async getKeys(): Promise<Array<string>> {
		const path = `${this.root}@`
		const res = await this.storage.get(null)
		return Object.keys(res)
			.filter((k) => k.startsWith(path))
			.map((k) => k.substring(path.length))
	}

	public async getValues(): Promise<Array<T>> {
		const path = `${this.root}@`
		const res = await this.storage.get(null)
		return Object.entries(res)
			.filter(([k, _]) => k.startsWith(path))
			.map(([_, v]) => JSON.parse(v as string))
	}

	public async findByPredicate(predicate: (entity: T) => boolean): Promise<Array<{ key: string; entity: T }>> {
		const allEntities = await this.getAll()
		const foundEntities = allEntities.filter(([, entity]) => predicate(entity)).map(([key, entity]) => ({ key, entity }))

		return foundEntities
	}
}

---
import type { StorageArea } from "@/core/ports"
import { StorageType } from "."

/**
 * Minimal storage surface ValueStorage actually uses. Both
 * `chrome.storage.StorageArea` (legacy path) and our port's `StorageArea`
 * (injected path, used by tests via FakeBrowserApi) satisfy it.
 */
type MinimalArea = {
	get(keys?: string | string[] | null): Promise<Record<string, unknown>>
	set(items: Record<string, unknown>): Promise<void>
	remove(keys: string | string[]): Promise<void>
}

export class ValueStorage<T> {
	private readonly storage: MinimalArea
	private readonly root: string

	/**
	 * Two constructor shapes — mirrors `EntityStorage` exactly:
	 * 1. Legacy — pass a `StorageType` enum value; reaches into `chrome.storage`.
	 * 2. Injected — pass a `StorageArea` port; used by tests and the future
	 *    composition root.
	 */
	constructor(root: string, areaOrType: StorageType | StorageArea = StorageType.Local) {
		this.root = root
		if (typeof areaOrType === "number") {
			this.storage = areaOrType === StorageType.Local ? chrome.storage.local : chrome.storage.session
		} else {
			this.storage = areaOrType as MinimalArea
		}
	}

	public async get(): Promise<T | undefined> {
		const res = await this.storage.get(this.root)
		if (this.root in res) {
			return JSON.parse(res[this.root] as string)
		}
		return undefined
	}

	public set(value: T): Promise<void> {
		return this.storage.set({ [this.root]: JSON.stringify(value) })
	}

	public delete(): Promise<void> {
		return this.storage.remove(this.root)
	}
}

---INDEX---
export enum StorageType {
	Local,
	Session,
}

export * from "./entity_storage"
export * from "./simple_storage"
export * from "./value-storage"

 succeeded in 0ms:
import { array_max } from "@/wallet/utils"

export const wrapParams = (params: unknown[]): Record<number, unknown> => {
	return params.reduce<Record<number, unknown>>((acc, v, i) => {
		acc[i] = v
		return acc
	}, {})
}

export const unwrapParams = <T>(params: T): T => {
	const keys = Object.keys(params as Record<number, unknown>).map((x) => +x)
	if (!keys.length) return [] as T

	const res = []
	const max = array_max(keys)
	for (let i = 0; i <= max; i++) {
		res.push((params as Record<number, unknown>)[i])
	}

	return res as T
}

---BG SERVICE---
import { type ILogger, LogLevel } from "@/wallet/logger"
import { sleep } from "@/wallet/utils"
import { getErrorMessage } from "@/wallet/utils/errors"
import { jsonSanitize } from "@/wallet/utils/serialization"
import type { EventsMap, MethodsMap, MethodsSpec, IService, EventsSpec, ServiceCollection } from "../."
import { WalletError } from "../errors"
import { MessageType, type EventMessage, type RequestMessage, type ResponseMessage } from "../messages"
import { unwrapParams } from "../utils"

export abstract class Service<TRequests extends MethodsMap, TEvents extends EventsMap = {}> implements IService {
	public readonly name: string
	protected readonly logger: ILogger
	private readonly clients: chrome.runtime.Port[] = []
	private get events() {
		return this as unknown as EventsSpec<TEvents>
	}
	private get requests() {
		return this as unknown as MethodsSpec<TRequests>
	}
	private initialized = false

	protected constructor(name: string, logger: ILogger) {
		this.name = name
		this.logger = logger
		chrome.runtime.onConnect.addListener(this.onConnect)
		this.logDebug("Service created")
	}

	protected async init(_services: ServiceCollection): Promise<void> {
		// to be overridden in derived classes
	}

	public async start(services: ServiceCollection) {
		if (this.initialized) return
		await this.init(services)
		this.initialized = true
		this.logDebug("Service started")
	}

	private readonly onConnect = (client: chrome.runtime.Port) => {
		if (client.name !== this.name) {
			return
		}
		client.onDisconnect.addListener(this.onDisconnect)
		client.onMessage.addListener(this.onMessage)
		this.clients.push(client)
		this.logDebug(`Client connected. Total: ${this.clients.length}`)
	}

	private readonly onDisconnect = (client: chrome.runtime.Port) => {
		client.onDisconnect.removeListener(this.onDisconnect)
		client.onMessage.removeListener(this.onMessage)
		const index = this.clients.indexOf(client)
		if (index === -1) {
			this.logWarn("Unknown client disconnected")
			return
		}
		this.clients.splice(index, 1)
		this.logDebug(`Client disconnected. Total: ${this.clients.length}`)
	}

	private readonly onMessage = async (message: RequestMessage<TRequests>, client: chrome.runtime.Port) => {
		if (message?.type !== MessageType.Request || !message.content) {
			this.logWarn("Invalid message received", message)
			return
		}
		const { requestId, method, params: wrappedParams } = message.content
		if (!requestId || !(method in this.requests) || typeof wrappedParams !== "object") {
			this.logWarn("Invalid request received", message)
			return
		}
		const params = unwrapParams(wrappedParams)
		this.logDebug("Request received", requestId, method, params)
		let response: ResponseMessage<TRequests>
		try {
			const result = await this.requests[method](...params)
			this.logDebug("Request processed", requestId, result)
			response = {
				type: MessageType.Response,
				content: {
					requestId,
					result: jsonSanitize(result),
				},
			}
		} catch (error) {
			const errorMessage = getErrorMessage(error)
			this.logDebug("Request failed", requestId, errorMessage)
			// WalletError subclasses round-trip as structured payloads so the
			// client can reconstruct the original class + code + details.
			const errorPayload = error instanceof WalletError ? error.toPayload() : undefined
			response = {
				type: MessageType.Response,
				content: {
					requestId,
					error: errorMessage,
					...(errorPayload ? { errorPayload } : {}),
				},
			}
		}
		this.send(response, client)
		this.logDebug("Response sent", response)
	}

	protected emit<T extends keyof TEvents>(event: T, payload: TEvents[T]) {
		const message: EventMessage<TEvents> = {
			type: MessageType.Event,
			content: {
				event,
				payload: jsonSanitize(payload),
			},
		}
		for (const client of this.clients) {
			this.send(message, client)
		}
		this.events[event].invoke(payload)
		this.logDebug("Event sent", message)
	}

	private send(message: unknown, client: chrome.runtime.Port) {
		try {
			client.postMessage(message)
		} catch (error) {
			if (this.clients.includes(client)) {
				this.logError("Failed to send message", getErrorMessage(error))
			}
		}
	}

	protected async ensureInitialized() {
		if (this.initialized) {
			return
		}
		let restMs = 30_000
		while (!this.initialized && restMs > 0) {
			await sleep(500)
			restMs -= 500
		}
		if (!this.initialized) {
			throw new Error("Service not initialized")
		}
	}

	protected logDebug(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Debug, ...data)
	}

	protected logInfo(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Info, ...data)
	}

	protected logWarn(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Warn, ...data)
	}

	protected logError(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Error, ...data)
	}

	public async backup(): Promise<unknown> {
		// can be overridden in derived classes if necessary
		return null
	}

	public async restore(..._args: unknown[]): Promise<unknown> {
		// can be overridden in derived classes if necessary
		return null
	}
}

---BG CLIENT---
import { type ILogger, LogLevel } from "@/wallet/logger"
import { sleep } from "@/wallet/utils"
import { EventHandler } from "@/wallet/utils/event-handler"
import { getErrorMessage } from "@/wallet/utils/errors"
import { jsonSanitize } from "@/wallet/utils/serialization"
import type { EventsMap, EventsSpec, MethodsMap } from "../."
import { RpcTimeoutError, walletErrorFromPayload } from "../errors"
import { MessageType, type EventMessage, type RequestMessage, type ResponseMessage } from "../messages"
import { wrapParams } from "../utils"

/** Default upper bound on any RPC request. Individual calls can override.
 *
 *  30s was too tight: PXE-backed views (getGasBalances, simulateTx on
 *  a cold PXE, etc.) routinely run past that on local networks and a
 *  freshly-unlocked wallet. The timeout exists to catch a wedged SW, not
 *  to police slow-but-healthy calls — 60s gives real work room to finish
 *  while still surfacing a hang. */
export const DEFAULT_RPC_TIMEOUT_MS = 60_000

/** Stored per-request resolver set. The timeout handle is cleared on terminal state. */
type PendingRequest = {
	resolve: (result: unknown) => void
	reject: (error: unknown) => void
	timeoutHandle?: ReturnType<typeof setTimeout>
}

export abstract class ServiceClient<TRequests extends MethodsMap, TEvents extends EventsMap = {}> {
	public onConnected: EventHandler<void> = new EventHandler()
	public onDisconnected: EventHandler<void> = new EventHandler()

	private readonly name: string
	private readonly service: string
	private readonly logger: ILogger
	private readonly defaultTimeoutMs: number

	private state: ClientState = ClientState.Disconnected
	private readonly requests: Map<number, PendingRequest> = new Map()
	private nextRequestId = 1
	private port?: chrome.runtime.Port

	protected constructor(service: string, logger: ILogger, name?: string, options?: { requestTimeoutMs?: number }) {
		this.name = name ?? `${service}-client`
		this.service = service
		this.logger = logger
		this.defaultTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS
	}

	public async connect() {
		if (this.state !== ClientState.Disconnected) {
			return
		}
		this.state = ClientState.Connecting
		while (this.state === ClientState.Connecting) {
			try {
				this.port = chrome.runtime.connect(undefined, { name: this.service })
				this.port.onDisconnect.addListener(this.onDisconnect)
				this.port.onMessage.addListener(this.onMessage)
				this.state = ClientState.Connected
				this.logDebug("Connected")
				this.onConnected.invoke()
				return
			} catch (error) {
				this.logError("Failed to connect", getErrorMessage(error))
				await sleep(1000)
			}
		}
	}

	public disconnect() {
		this.state = ClientState.Disconnecting
		if (this.port) {
			this.port.onMessage.removeListener(this.onMessage)
			this.port.onDisconnect.removeListener(this.onDisconnect)
			this.port.disconnect()
			this.port = undefined
		}
		if (this.requests.size) {
			this.requests.forEach((entry) => {
				if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle)
				entry.reject(new Error("Client disconnected"))
			})
			this.requests.clear()
		}
		this.state = ClientState.Disconnected
		this.logDebug("Disconnected")
		this.onDisconnected.invoke()
	}

	private readonly onDisconnect = () => {
		this.disconnect()
		this.connect()
	}

	private readonly onMessage = (message: ResponseMessage<TRequests> | EventMessage<TEvents>) => {
		if ((message?.type !== MessageType.Response && message.type !== MessageType.Event) || !message.content) {
			this.logWarn("Invalid message received", message)
			return
		}
		if (message.type === MessageType.Response) {
			const { requestId, result, error, errorPayload } = message.content
			const entry = this.requests.get(requestId)
			if (!entry) {
				this.logWarn("Invalid response received", message.content)
				return
			}
			if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle)
			this.requests.delete(requestId)
			if (error !== undefined || errorPayload !== undefined) {
				// Structured payload takes precedence so `instanceof WalletError`
				// (and subclass) checks work on the client. Fall back to a plain
				// Error when the service threw something that wasn't a WalletError.
				const rejection = errorPayload ? walletErrorFromPayload(errorPayload) : new Error(error ?? "Unknown error")
				entry.reject(rejection)
				this.logDebug("Request rejected", message.content)
			} else {
				entry.resolve(result)
				this.logDebug("Request resolved", message.content)
			}
			this.logDebug("Pending requests", this.requests.size)
		} else {
			const { event, payload } = message.content
			this.logDebug("Event received", event, payload)
			;(this as EventsSpec<TEvents>)[event].invoke(payload)
		}
	}

	protected async request<T extends keyof TRequests>(method: T, ...params: Parameters<TRequests[T]>): Promise<ReturnType<TRequests[T]>> {
		while (this.state !== ClientState.Connected) {
			if (this.state === ClientState.Disconnected) {
				this.connect()
				continue
			}
			await sleep(300)
		}
		const requestId = this.getRequestId()
		const request: RequestMessage<TRequests> = {
			type: MessageType.Request,
			content: {
				requestId,
				method: method,
				params: jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>,
			},
		}

		const methodName = String(method)
		const timeoutMs = this.defaultTimeoutMs
		const start = Date.now()
		this.logDebug(`→ ${methodName}`)

		const warnTimer = setTimeout(() => {
			this.logWarn(`Request pending >10s: ${methodName} (id: ${requestId})`)
		}, 10_000)

		const promise = new Promise<ReturnType<TRequests[T]>>((resolve, reject) => {
			// Hard timeout — rejects the pending request with a typed error so
			// callers can distinguish "the service worker is wedged" from
			// "the service worker replied with an error". Clears itself on
			// terminal state (response / disconnect).
			const timeoutHandle = setTimeout(() => {
				const entry = this.requests.get(requestId)
				if (!entry) return
				this.requests.delete(requestId)
				entry.reject(new RpcTimeoutError(`RPC '${methodName}' timed out after ${timeoutMs}ms`, { requestId, methodName }))
				this.logWarn(`Request timed out: ${methodName} (id: ${requestId}, ${timeoutMs}ms)`)
			}, timeoutMs)

			this.requests.set(requestId, {
				resolve: resolve as (result: unknown) => void,
				reject,
				timeoutHandle,
			})
		})
		this.port!.postMessage(request)

		return promise.finally(() => {
			clearTimeout(warnTimer)
			this.logDebug(`← ${methodName} (${Date.now() - start}ms)`)
		})
	}

	private getRequestId() {
		return this.nextRequestId++
	}

	protected logDebug(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Debug, ...data)
	}

	protected logInfo(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Info, ...data)
	}

	protected logWarn(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Warn, ...data)
	}

	protected logError(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Error, ...data)
	}

	public async backup(): Promise<unknown> {
		return this.request("backup" as keyof TRequests, ...([] as unknown as Parameters<TRequests[keyof TRequests]>))
	}

	public async restore(..._args: unknown[]): Promise<unknown> {
		return this.request("restore" as keyof TRequests, ...(_args as unknown as Parameters<TRequests[keyof TRequests]>))
	}
}

enum ClientState {
	Connecting,
	Connected,
	Disconnecting,
	Disconnected,
}

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/base/zod-helpers.ts && printf '\\n---ZOD TEST---\\n' && sed -n '1,220p' packages/extension/src/wallet/base/zod-helpers.test.ts" in (project root)
 succeeded in 0ms:
/**
 * Thin Zod wrappers for the RPC boundary.
 *
 * Services pair a `paramsSchema` + `resultSchema` per method (in their
 * `spec.ts`) and call these helpers at the wire boundary:
 *
 *   - client-side, before sending:   validateParams(...)
 *   - client-side, after receiving:  validateResult(...)
 *   - service-side, on entry:        validateParams(...)
 *
 * On failure both helpers throw `ValidationError` (a WalletError subclass)
 * so the structured-error round-trip from M1-RT.A preserves subclass
 * identity across the JSON boundary.
 *
 * This module is intentionally small. Schemas live next to the types they
 * describe, not here. Rolling out to more services is one file change
 * per service with no plumbing in the base classes.
 */

import type { ZodType } from "zod"
import { ValidationError } from "./errors"

/** Shorten a Zod issue path for error messages. Empty paths become "<root>". */
function formatPath(path: readonly (string | number)[]): string {
	return path.length === 0 ? "<root>" : path.join(".")
}

/** Compact human-readable summary across all issues in a failed parse. */
function summariseIssues(issues: readonly { path: readonly (string | number)[]; message: string }[]): string {
	return issues.map((i) => `${formatPath(i.path)}: ${i.message}`).join("; ")
}

/**
 * Validate the tuple of positional params a caller sent for `method`.
 * Returns the parsed tuple (lets downstream code work with the narrowed
 * type). Throws `ValidationError` on any issue.
 */
export function validateParams<T>(schema: ZodType<T>, params: unknown, method: string): T {
	const result = schema.safeParse(params)
	if (!result.success) {
		throw new ValidationError(`Invalid params for ${method}: ${summariseIssues(result.error.issues)}`, {
			method,
			issues: result.error.issues,
		})
	}
	return result.data
}

/**
 * Validate the value a method is about to return (or has just received).
 * Used client-side to catch service bugs / wire corruption before the
 * value reaches UI code.
 */
export function validateResult<T>(schema: ZodType<T>, value: unknown, method: string): T {
	const result = schema.safeParse(value)
	if (!result.success) {
		throw new ValidationError(`Invalid result from ${method}: ${summariseIssues(result.error.issues)}`, {
			method,
			issues: result.error.issues,
		})
	}
	return result.data
}

---ZOD TEST---
import { describe, expect, test } from "vitest"
import { z } from "zod"
import { ValidationError } from "./errors"
import { validateParams, validateResult } from "./zod-helpers"

describe("validateParams", () => {
	const schema = z.tuple([z.string().min(1), z.number().int().nonnegative()])

	test("returns the parsed tuple on success", () => {
		const out = validateParams(schema, ["hello", 42], "testMethod")
		expect(out).toEqual(["hello", 42])
	})

	test("throws ValidationError on malformed input", () => {
		expect(() => validateParams(schema, ["", 42], "testMethod")).toThrow(ValidationError)
	})

	test("ValidationError message includes the method name", () => {
		try {
			validateParams(schema, ["", 42], "addNetwork")
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError)
			expect((err as Error).message).toContain("addNetwork")
		}
	})

	test("ValidationError details carries the method + issue list", () => {
		try {
			validateParams(schema, [""], "addNetwork")
		} catch (err) {
			const details = (err as ValidationError).details as { method: string; issues: unknown[] }
			expect(details.method).toBe("addNetwork")
			expect(Array.isArray(details.issues)).toBe(true)
			expect(details.issues.length).toBeGreaterThan(0)
		}
	})

	test("multiple issues surface in the message", () => {
		try {
			validateParams(schema, ["", -1], "x")
		} catch (err) {
			const msg = (err as Error).message
			// Two issues expected: path "0" and path "1".
			expect(msg).toContain("0")
			expect(msg).toContain("1")
		}
	})

	test("empty tuple schema + empty input passes", () => {
		const emptySchema = z.tuple([])
		expect(() => validateParams(emptySchema, [], "noArgs")).not.toThrow()
	})
})

describe("validateResult", () => {
	const schema = z.object({ id: z.string(), count: z.number().int() })

	test("returns the parsed value on success", () => {
		const out = validateResult(schema, { id: "a", count: 1 }, "m")
		expect(out).toEqual({ id: "a", count: 1 })
	})

	test("throws ValidationError when the response shape is wrong", () => {
		expect(() => validateResult(schema, { id: "a", count: "nope" }, "m")).toThrow(ValidationError)
	})

	test("message cites the method for cross-commit debuggability", () => {
		try {
			validateResult(schema, null, "getNetwork")
		} catch (err) {
			expect((err as Error).message).toContain("getNetwork")
		}
	})

	test("ValidationError is both an Error and a WalletError subclass", async () => {
		// Import asynchronously so we don't couple this file to the error hierarchy.
		const { WalletError } = await import("./errors")
		try {
			validateResult(schema, "not an object", "m")
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError)
			expect(err).toBeInstanceOf(WalletError)
			expect(err).toBeInstanceOf(Error)
		}
	})
})

exec
/bin/zsh -lc "sed -n '1,240p' packages/extension/src/wallet/base/offscreen/service.ts && printf '\\n---OFFSCREEN CLIENT---\\n' && sed -n '1,260p' packages/extension/src/wallet/base/offscreen/client.ts && printf '\\n---MESSAGES---\\n' && sed -n '1,240p' packages/extension/src/wallet/base/messages.ts && printf '\\n---ERRORS---\\n' && sed -n '1,240p' packages/extension/src/wallet/base/errors.ts" in (project root)
 succeeded in 0ms:
import { type ILogger, LogLevel } from "@/wallet/logger"
import { sleep } from "@/wallet/utils"
import { getErrorMessage } from "@/wallet/utils/errors"
import { jsonSanitize } from "@/wallet/utils/serialization"
import { OFFSCREEN_KEEPALIVE } from "@/wallet/utils/offscreen"
import type { EventsMap, MethodsMap, MethodsSpec, IService, EventsSpec, ServiceCollection } from "../."
import { MessageType } from "../messages"
import { unwrapParams } from "../utils"
import type { EventMessage, RequestMessage, ResponseMessage } from "./messages"

/** Send keepalive pings every 20s to prevent Chrome from killing the service worker. */
const KEEPALIVE_INTERVAL_MS = 20_000

export abstract class Service<TRequests extends MethodsMap, TEvents extends EventsMap = {}> implements IService {
	public readonly name: string
	private readonly logger: ILogger
	private get events() {
		return this as unknown as EventsSpec<TEvents>
	}
	private get requests() {
		return this as unknown as MethodsSpec<TRequests>
	}
	private initialized = false

	protected constructor(name: string, logger: ILogger) {
		this.name = name
		this.logger = logger
		chrome.runtime.onMessage.addListener(this.onMessageListener)
		this.logDebug("Service created")
	}

	protected async init(_services: ServiceCollection): Promise<void> {
		// to be overridden in derived classes
	}

	public async start(services: ServiceCollection) {
		if (this.initialized) return
		await this.init(services)
		this.initialized = true
		this.logDebug("Service started")
	}

	private readonly onMessageListener = (message: RequestMessage<TRequests>): boolean => {
		if (message.to === this.name) {
			this.onMessage(message) // fire and forget
		}
		return false
	}

	private readonly onMessage = async (message: RequestMessage<TRequests>) => {
		if (message?.type !== MessageType.Request || !message.from || !message.content) {
			this.logWarn("Invalid message received", message)
			return
		}
		const { requestId, method, params: wrappedParams } = message.content
		if (!requestId || !(method in this.requests) || typeof wrappedParams !== "object") {
			this.logWarn("Invalid request received", message)
			return
		}
		const params = unwrapParams(wrappedParams)
		this.logDebug("Request received", requestId, method, params)

		// Keep the service worker alive during long operations (PXE proof gen, etc.).
		// Chrome kills idle SWs after 30s — sending any message resets that timer.
		const keepalive = setInterval(() => {
			chrome.runtime.sendMessage(OFFSCREEN_KEEPALIVE).catch(() => {})
		}, KEEPALIVE_INTERVAL_MS)

		let response: ResponseMessage<TRequests>
		try {
			const result = await this.requests[method](...params)
			this.logDebug("Request processed", requestId, result)
			response = {
				type: MessageType.Response,
				content: {
					requestId,
					result: jsonSanitize(result),
				},
				from: this.name,
				to: message.from,
			}
		} catch (error) {
			const errorMessage = getErrorMessage(error)
			this.logDebug("Request failed", requestId, errorMessage)
			response = {
				type: MessageType.Response,
				content: {
					requestId,
					error: errorMessage,
				},
				from: this.name,
				to: message.from,
			}
		} finally {
			clearInterval(keepalive)
		}
		try {
			await chrome.runtime.sendMessage(response)
			this.logDebug("Response sent", response)
		} catch {
			// Service worker is dead — response is lost. The client-side timeout
			// (in offscreen/client.ts) will reject the caller's promise.
		}
	}

	protected emit<T extends keyof TEvents>(event: T, payload: TEvents[T]) {
		const message: EventMessage<TEvents> = {
			type: MessageType.Event,
			content: {
				event,
				payload: jsonSanitize(payload),
			},
			from: this.name,
		}
		chrome.runtime.sendMessage(message).catch(() => {
			// Service worker is dead — event is lost.
		})
		this.events[event].invoke(payload)
		this.logDebug("Event sent", message)
	}

	protected async ensureInitialized() {
		if (this.initialized) {
			return
		}
		let restMs = 30_000
		while (!this.initialized && restMs > 0) {
			await sleep(500)
			restMs -= 500
		}
		if (!this.initialized) {
			throw new Error("Service not initialized")
		}
	}

	protected logDebug(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Debug, ...data)
	}

	protected logInfo(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Info, ...data)
	}

	protected logWarn(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Warn, ...data)
	}

	protected logError(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Error, ...data)
	}
}

---OFFSCREEN CLIENT---
import { type ILogger, LogLevel } from "@/wallet/logger"
import { getRandomHex } from "@/wallet/utils"
import { ensureOffscreenRunning } from "@/wallet/utils/offscreen"
import { jsonSanitize } from "@/wallet/utils/serialization"
import { MessageType } from "../messages"
import type { EventsMap, EventsSpec, MethodsMap } from "../."
import type { EventMessage, RequestMessage, ResponseMessage } from "./messages"
import { wrapParams } from "../utils"

/** Timeout for offscreen requests (ms). PXE operations can take 60s+ (fetch timeout + proof gen). */
const REQUEST_TIMEOUT_MS = 90_000

export abstract class ServiceClient<TRequests extends MethodsMap, TEvents extends EventsMap = {}> {
	private readonly uid: string
	private readonly name: string
	private readonly service: string
	private readonly logger: ILogger

	private readonly requests: Map<number, [(result: unknown) => void, (error: string) => void]> = new Map()
	private readonly requestTimers: Map<number, NodeJS.Timeout> = new Map()
	private nextRequestId = 1
	private connected = false

	protected constructor(service: string, logger: ILogger, name?: string) {
		this.uid = getRandomHex(8)
		this.name = name ?? `${service}-client`
		this.service = service
		this.logger = logger
	}

	public connect() {
		if (this.connected) return
		chrome.runtime.onMessage.addListener(this.onMessageListener)
		this.connected = true
		this.logDebug("Connected")
	}

	public disconnect() {
		if (!this.connected) return
		this.connected = false
		chrome.runtime.onMessage.removeListener(this.onMessageListener)
		this.requestTimers.forEach((timer) => clearTimeout(timer))
		this.requestTimers.clear()
		if (this.requests.size) {
			this.requests.forEach(([_, reject]) => reject("Client disconnected"))
			this.requests.clear()
		}
		this.logDebug("Disconnected")
	}

	private readonly onMessageListener = (message: ResponseMessage<TRequests> | EventMessage<TEvents>): boolean => {
		if (message.to === this.uid || (message.type === MessageType.Event && message.from === this.service && message.to === undefined)) {
			this.onMessage(message) // fire and forget
		}
		return false
	}

	private readonly onMessage = (message: ResponseMessage<TRequests> | EventMessage<TEvents>) => {
		if (
			(message?.type !== MessageType.Response && message.type !== MessageType.Event) ||
			message.from !== this.service ||
			!message.content
		) {
			this.logWarn("Invalid message received", message)
			return
		}
		if (message.type === MessageType.Response) {
			const { requestId, result, error } = message.content
			const requestPromise = this.requests.get(requestId)
			if (!requestPromise) {
				this.logWarn("Invalid response received", message.content)
				return
			}
			const [resolve, reject] = requestPromise
			if (error !== undefined) {
				reject(error)
				this.logDebug("Request rejected", message.content)
			} else {
				resolve(result)
				this.logDebug("Request resolved", message.content)
			}
			this.requests.delete(requestId)
			const timer = this.requestTimers.get(requestId)
			if (timer) {
				clearTimeout(timer)
				this.requestTimers.delete(requestId)
			}
			this.logDebug("Pending requests", this.requests.size)
		} else {
			const { event, payload } = message.content
			this.logDebug("Event received", event, payload)
			;(this as EventsSpec<TEvents>)[event].invoke(payload)
		}
	}

	/**
	 * Non-overridable template: runs base transport-readiness
	 * (`ensureOffscreenRunning()`), then invokes the subclass
	 * `onReady()` hook. Called from every request before the message
	 * is sent so no subclass can forget to prepare the transport.
	 */
	private async ensureReady(): Promise<void> {
		await ensureOffscreenRunning()
		await this.onReady()
	}

	/**
	 * Overridable hook: runs AFTER base transport-readiness for any
	 * subclass-specific post-transport setup. Default is no-op. Do NOT
	 * call `ensureOffscreenRunning()` from an override — the base has
	 * already done it by the time this is invoked.
	 */
	protected async onReady(): Promise<void> {
		// no-op by default
	}

	protected async request<T extends keyof TRequests>(method: T, ...params: Parameters<TRequests[T]>): Promise<ReturnType<TRequests[T]>> {
		if (!this.connected) {
			this.connect()
		}
		await this.ensureReady()
		const request: RequestMessage<TRequests> = {
			type: MessageType.Request,
			content: {
				requestId: this.getRequestId(),
				method: method,
				params: jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>,
			},
			from: this.uid,
			to: this.service,
		}
		const requestId = request.content.requestId
		const promise = new Promise<ReturnType<TRequests[T]>>((resolve, reject) => {
			this.requests.set(requestId, [resolve as (result: unknown) => void, reject])
			const timer = setTimeout(() => {
				if (this.requests.delete(requestId)) {
					this.requestTimers.delete(requestId)
					const methodName = String(method)
					this.logError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${methodName}`)
					reject(`Offscreen request timed out: ${methodName}`)
				}
			}, REQUEST_TIMEOUT_MS)
			this.requestTimers.set(requestId, timer)
		})
		await chrome.runtime.sendMessage(request)
		this.logDebug("Request sent", request)
		this.logDebug("Pending requests", this.requests.size)
		return promise
	}

	private getRequestId() {
		return this.nextRequestId++
	}

	protected logDebug(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Debug, ...data)
	}

	protected logInfo(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Info, ...data)
	}

	protected logWarn(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Warn, ...data)
	}

	protected logError(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Error, ...data)
	}
}

---MESSAGES---
import type { EventsMap, MethodsMap } from "."
import type { WalletErrorPayload } from "./errors"

export enum MessageType {
	Event = 1,
	Request = 2,
	Response = 3,
}
export type EventMessage<T extends EventsMap> = {
	type: MessageType.Event
	content: EventContent<T>
}

export type EventContent<T extends EventsMap> = {
	[E in keyof T]: {
		event: E
		payload: T[E]
	}
}[keyof T]

export type RequestMessage<T extends MethodsMap> = {
	type: MessageType.Request
	content: RequestContent<T>
}

export type RequestContent<T extends MethodsMap> = {
	[M in keyof T]: {
		requestId: number
		method: M
		params: Parameters<T[M]>
	}
}[keyof T]

export type ResponseMessage<T extends MethodsMap> = {
	type: MessageType.Response
	content: ResponseContent<T>
}

export type ResponseContent<T extends MethodsMap> = {
	[M in keyof T]: {
		requestId: number
		result?: ReturnType<T[M]>
		/** Flat error message. Present on any failure — kept for logging + for
		 *  older clients that read only this field. */
		error?: string
		/** Structured WalletError payload. Present only when the service threw
		 *  a WalletError subclass; absent for plain Error / string throws. */
		errorPayload?: WalletErrorPayload
	}
}[keyof T]

---ERRORS---
/**
 * Structured errors for the RPC boundary.
 *
 * Historically services caught any thrown value and serialized it via
 * `getErrorMessage(e)` — a flat string on the wire. The client rejected
 * with that string, so consumers lost the error class, the error code, and
 * any contextual details.
 *
 * `WalletError` replaces that. Thrown on the service side, serialized via
 * `toPayload()`, reconstructed on the client via `walletErrorFromPayload()`
 * so `instanceof` checks survive the JSON boundary. Non-WalletError throws
 * still flatten to a message string (backward-compatible fall-through); the
 * client then rejects with `new Error(message)` instead of a raw string.
 */

export interface WalletErrorPayload {
	/** Stable machine-readable code. Subclasses declare their own. */
	code: string
	message: string
	details?: unknown
}

/** Base class for structured errors that cross the RPC boundary. */
export class WalletError extends Error {
	public readonly code: string
	public readonly details?: unknown

	public constructor(code: string, message: string, details?: unknown) {
		super(message)
		this.name = "WalletError"
		this.code = code
		this.details = details
		// Ensure `instanceof` works when errors are reconstructed across
		// workers/JSON boundaries. Subclasses repeat this in their ctors.
		Object.setPrototypeOf(this, WalletError.prototype)
	}

	public toPayload(): WalletErrorPayload {
		return { code: this.code, message: this.message, details: this.details }
	}
}

/**
 * Raised client-side when an RPC request exceeds its timeout. The service
 * side never throws this — it originates in `BackgroundServiceClient`.
 */
export class RpcTimeoutError extends WalletError {
	public static readonly CODE = "RPC_TIMEOUT"

	public constructor(message: string, details?: unknown) {
		super(RpcTimeoutError.CODE, message, details)
		this.name = "RpcTimeoutError"
		Object.setPrototypeOf(this, RpcTimeoutError.prototype)
	}
}

/** User explicitly rejected a prompt (approval, passkey, etc). */
export class UserRejectedError extends WalletError {
	public static readonly CODE = "USER_REJECTED"

	public constructor(message = "User rejected the request", details?: unknown) {
		super(UserRejectedError.CODE, message, details)
		this.name = "UserRejectedError"
		Object.setPrototypeOf(this, UserRejectedError.prototype)
	}
}

/** Request payload failed validation at the RPC boundary. */
export class ValidationError extends WalletError {
	public static readonly CODE = "VALIDATION"

	public constructor(message: string, details?: unknown) {
		super(ValidationError.CODE, message, details)
		this.name = "ValidationError"
		Object.setPrototypeOf(this, ValidationError.prototype)
	}
}

/**
 * Wrong password supplied to an unlock / reauth flow. Clients can `instanceof`
 * this to render a "wrong password" state without string-matching on the
 * message. Matched alongside a legacy-message fallback for older wire formats.
 */
export class InvalidPasswordError extends WalletError {
	public static readonly CODE = "INVALID_PASSWORD"
	public static readonly LEGACY_MESSAGE = "Invalid profile password"

	public constructor(message: string = InvalidPasswordError.LEGACY_MESSAGE, details?: unknown) {
		super(InvalidPasswordError.CODE, message, details)
		this.name = "InvalidPasswordError"
		Object.setPrototypeOf(this, InvalidPasswordError.prototype)
	}
}

/**
 * Reconstruct a WalletError (concrete subclass if the code is recognised)
 * from a wire payload. Unknown codes produce a plain `WalletError` with
 * the code preserved so telemetry / log analysis can still group them.
 */
export function walletErrorFromPayload(payload: WalletErrorPayload): WalletError {
	switch (payload.code) {
		case RpcTimeoutError.CODE:
			return new RpcTimeoutError(payload.message, payload.details)
		case UserRejectedError.CODE:
			return new UserRejectedError(payload.message, payload.details)
		case ValidationError.CODE:
			return new ValidationError(payload.message, payload.details)
		case InvalidPasswordError.CODE:
			return new InvalidPasswordError(payload.message, payload.details)
		default:
			return new WalletError(payload.code, payload.message, payload.details)
	}
}

codex
The next pass is on package-manager and plugin behavior: workspace resolution, Vitest/TS config, and whether the auto-import/CRX assumptions in the plans match the actual toolchain versions in this repo.
exec
/bin/zsh -lc "sed -n '1,220p' package.json && printf '\\n---ROOT TSCONFIG---\\n' && (test -f tsconfig.json && sed -n '1,220p' tsconfig.json || true) && printf '\\n---EXT PKG---\\n' && sed -n '1,240p' packages/extension/package.json && printf '\\n---EXT VITEST---\\n' && sed -n '1,240p' packages/extension/vitest.config.ts && printf '\\n---VITE ENV---\\n' && sed -n '1,120p' packages/extension/src/types/vite-env.d.ts" in (project root)
 succeeded in 0ms:
{
	"name": "nulo",
	"private": true,
	"workspaces": ["packages/*"],
	"scripts": {
		"dev": "bun run --cwd packages/extension dev",
		"dev:playground": "bun run --cwd packages/playground dev",
		"dev:landing": "bun run --cwd packages/landing dev",
		"build": "bun run --cwd packages/extension build",
		"build:chrome": "bun run --cwd packages/extension build:chrome",
		"build:firefox": "bun run --cwd packages/extension build:firefox",
		"test": "bun run --cwd packages/extension test",
		"test:e2e": "bun run --cwd packages/extension test:e2e",
		"test:e2e:network": "bun run --cwd packages/extension vitest run --config vitest.e2e.network.config.ts",
		"test:e2e:all": "bun run --cwd packages/extension vitest run --config vitest.e2e.all.config.ts",
		"lint": "biome check",
		"lint:fix": "biome check --fix",
		"format": "biome format --write",
		"check": "biome check",
		"typecheck": "vue-tsc --project packages/extension/tsconfig.json --noEmit",
		"prepare": "git config core.hooksPath .githooks"
	},
	"devDependencies": {
		"@biomejs/biome": "^2.1.4",
		"@commitlint/cli": "^20.5.0",
		"@commitlint/config-conventional": "^20.5.0"
	},
	"patchedDependencies": {
		"@aztec/accounts@4.2.0-nightly.20260413": "patches/@aztec%2Faccounts@4.2.0-nightly.20260413.patch"
	}
}

---ROOT TSCONFIG---
{
	"files": [],
	"references": [
		{ "path": "packages/extension" },
		{ "path": "packages/playground" },
		{ "path": "packages/landing" }
	]
}

---EXT PKG---
{
	"name": "@nulo/extension",
	"private": true,
	"displayName": "Nulo",
	"description": "User-friendly self-custody wallet for Aztec network, preserving your privacy and revealing the power of account abstraction.",
	"version": "0.12.4",
	"sentinel": "7",
	"scripts": {
		"build:full": "bun run build:chrome && bun run build:firefox",
		"build": "cross-env NODE_OPTIONS=--max-old-space-size=16000 vite build -c vite.chrome.config.mts",
		"build:chrome": "cross-env NODE_OPTIONS=--max-old-space-size=16000 vite build -c vite.chrome.config.mts",
		"build:firefox": "cross-env NODE_OPTIONS=--max-old-space-size=16000 vite build -c vite.firefox.config.mts",
		"dev:full": "concurrently \"bun run dev:chrome\" \"bun run dev:firefox\"",
		"dev": "vite -c vite.chrome.config.mts",
		"dev:chrome": "vite -c vite.chrome.config.mts",
		"dev:firefox": "vite build --mode development --watch -c vite.firefox.config.mts",
		"preview": "vite preview",
		"lint": "biome check src/",
		"lint:fix": "biome check src/ --fix",
		"format": "biome format src/ --write",
		"check": "biome check src/",
		"typecheck": "vue-tsc --noEmit",
		"test": "vitest",
		"test:e2e": "vitest run --config vitest.e2e.config.ts",
		"test:e2e:all": "vitest run --config vitest.e2e.all.config.ts"
	},
	"dependencies": {
		"@alejoamiras/aztec-accelerator": "4.2.0-nightly.20260413.1",
		"@aztec/accounts": "4.2.0-nightly.20260413",
		"@aztec/aztec.js": "4.2.0-nightly.20260413",
		"@aztec/bb.js": "4.2.0-nightly.20260413",
		"@aztec/constants": "4.2.0-nightly.20260413",
		"@aztec/entrypoints": "4.2.0-nightly.20260413",
		"@aztec/foundation": "4.2.0-nightly.20260413",
		"@aztec/kv-store": "4.2.0-nightly.20260413",
		"@aztec/noir-acvm_js": "4.2.0-nightly.20260413",
		"@aztec/noir-contracts.js": "4.2.0-nightly.20260413",
		"@aztec/noir-noirc_abi": "4.2.0-nightly.20260413",
		"@aztec/protocol-contracts": "4.2.0-nightly.20260413",
		"@aztec/pxe": "4.2.0-nightly.20260413",
		"@aztec/simulator": "4.2.0-nightly.20260413",
		"@aztec/stdlib": "4.2.0-nightly.20260413",
		"@aztec/wallet-sdk": "4.2.0-nightly.20260413",
		"@codemirror/autocomplete": "^6.0.0",
		"@codemirror/commands": "^6.0.0",
		"@codemirror/lang-json": "^6.0.2",
		"@codemirror/language": "^6.0.0",
		"@codemirror/search": "^6.0.0",
		"@codemirror/state": "^6.0.0",
		"@codemirror/view": "^6.0.0",
		"@defi-wonderland/aztec-standards": "4.2.0-aztecnr-rc.2",
		"@lezer/highlight": "^1.0.0",
		"@replit/codemirror-indentation-markers": "^6.5.3",
		"@wonderland/aztec-fee-payment": "4.2.0-aztecnr-rc.2",
		"bignumber.js": "^9.3.1",
		"codemirror": "^6.0.2",
		"focus-trap": "^7.6.5",
		"lean-qr": "^2.5.0",
		"pako": "^2.1.0",
		"luxon": "^3.7.1",
		"pinia": "^3.0.3",
		"vue": "^3.5.18",
		"vue-router": "^4.5.1",
		"webextension-polyfill": "^0.12.0",
		"zod": "^3.23.8"
	},
	"devDependencies": {
		"@aztec/ethereum": "4.2.0-nightly.20260413",
		"@aztec/wallets": "4.2.0-nightly.20260413",
		"@crxjs/vite-plugin": "^2.1.0",
		"@types/node": "^24.2.1",
		"@types/webextension-polyfill": "^0.12.3",
		"@vitejs/plugin-vue": "^6.0.1",
		"@vue/compiler-sfc": "^3.5.18",
		"@webext-core/fake-browser": "^1.3.4",
		"chrome-types": "^0.1.370",
		"concurrently": "^9.2.0",
		"cross-env": "^10.0.0",
		"globals": "^16.3.0",
		"jsdom": "^26.1.0",
		"postcss": "^8.5.6",
		"puppeteer": "^24.37.5",
		"sass": "^1.90.0",
		"typescript": "^5.9.2",
		"unplugin-auto-import": "^20.0.0",
		"unplugin-vue-components": "^29.0.0",
		"unplugin-vue-router": "^0.15.0",
		"vite": "^7.1.1",
		"vite-plugin-node-polyfills": "^0.24.0",
		"vite-plugin-pages": "^0.33.1",
		"vite-plugin-static-copy": "^3.1.1",
		"vite-plugin-vue-devtools": "^8.0.0",
		"vitest": "^3.2.4",
		"vue-tsc": "^3.0.5",
		"webext-bridge": "^6.0.1"
	}
}

---EXT VITEST---
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: "./tests/vitest.setup.ts",
		exclude: ["tests/e2e/**", "node_modules/**"],
	},
})

---VITE ENV---
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pages/client" />

declare const __VERSION__: string
declare const __SENTINEL__: string
declare const __AZTEC_VERSION__: string
declare const __NAME__: string
declare const __DISPLAY_NAME__: string

exec
/bin/zsh -lc "node -p \"const p=require('./packages/extension/package.json'); JSON.stringify({crx:p.devDependencies['@crxjs/vite-plugin'], auto:p.devDependencies['unplugin-auto-import'], comps:p.devDependencies['unplugin-vue-components'], vite:p.devDependencies['vite'], sass:p.devDependencies['sass'], vitest:p.devDependencies['vitest']}, null, 2)\"" in (project root)
 succeeded in 0ms:
{
  "crx": "^2.1.0",
  "auto": "^20.0.0",
  "comps": "^29.0.0",
  "vite": "^7.1.1",
  "sass": "^1.90.0",
  "vitest": "^3.2.4"
}

exec
/bin/zsh -lc "if [ -d node_modules ]; then rg -n \"dirs:|globs:|glob\\(|fast-glob|tinyglobby|scanDirs|srcDir|root\" node_modules/unplugin-auto-import node_modules/unplugin-vue-components node_modules/@crxjs/vite-plugin -S; else echo 'no node_modules'; fi" in (project root)
 exited 2 in 0ms:
rg: node_modules/unplugin-auto-import: No such file or directory (os error 2)
rg: node_modules/unplugin-vue-components: No such file or directory (os error 2)
rg: node_modules/@crxjs/vite-plugin: No such file or directory (os error 2)

web search: 
web search: dependency-cruiser latest npm version
exec
/bin/zsh -lc 'rg -n "wrapParams|unwrapParams" packages/extension/src -S' in (project root)
 succeeded in 0ms:
packages/extension/src/wallet/base/utils.ts:3:export const wrapParams = (params: unknown[]): Record<number, unknown> => {
packages/extension/src/wallet/base/utils.ts:10:export const unwrapParams = <T>(params: T): T => {
packages/extension/src/wallet/base/offscreen/service.ts:8:import { unwrapParams } from "../utils"
packages/extension/src/wallet/base/offscreen/service.ts:60:		const params = unwrapParams(wrappedParams)
packages/extension/src/wallet/base/offscreen/client.ts:8:import { wrapParams } from "../utils"
packages/extension/src/wallet/base/offscreen/client.ts:127:				params: jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>,
packages/extension/src/wallet/base/background/service.ts:8:import { unwrapParams } from "../utils"
packages/extension/src/wallet/base/background/service.ts:72:		const params = unwrapParams(wrappedParams)
packages/extension/src/wallet/base/background/client.ts:9:import { wrapParams } from "../utils"
packages/extension/src/wallet/base/background/client.ts:141:				params: jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>,

exec
/bin/zsh -lc "rg -n \"validateParams|validateResult|zod-helpers|from \\\"zod\\\"|from 'zod'\" packages/extension/src -S" in (project root)
 succeeded in 0ms:
packages/extension/src/wallet/utils/schemas.ts:9:import z from "zod"
packages/extension/src/wallet/services/operation-journal/service.ts:4:import { validateParams } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/operation-journal/service.ts:48:		validateParams(OperationJournalMethodSchemas.createOperation.params, [input], "createOperation")
packages/extension/src/wallet/services/operation-journal/service.ts:75:		validateParams(OperationJournalMethodSchemas.updateOperationState.params, [id, state], "updateOperationState")
packages/extension/src/wallet/services/operation-journal/service.ts:93:		validateParams(OperationJournalMethodSchemas.getOperation.params, [id], "getOperation")
packages/extension/src/wallet/services/operation-journal/service.ts:99:		validateParams(OperationJournalMethodSchemas.getOperations.params, [filter], "getOperations")
packages/extension/src/wallet/services/operation-journal/service.ts:107:		validateParams(OperationJournalMethodSchemas.deleteOperation.params, [id], "deleteOperation")
packages/extension/src/wallet/services/operation-journal/client.ts:3:import { validateParams, validateResult } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/operation-journal/client.ts:29:		validateParams(OperationJournalMethodSchemas.createOperation.params, [input], "createOperation")
packages/extension/src/wallet/services/operation-journal/client.ts:31:		return validateResult(OperationJournalMethodSchemas.createOperation.result, result, "createOperation")
packages/extension/src/wallet/services/operation-journal/client.ts:35:		validateParams(OperationJournalMethodSchemas.updateOperationState.params, [id, state], "updateOperationState")
packages/extension/src/wallet/services/operation-journal/client.ts:37:		return validateResult(OperationJournalMethodSchemas.updateOperationState.result, result, "updateOperationState")
packages/extension/src/wallet/services/operation-journal/client.ts:41:		validateParams(OperationJournalMethodSchemas.getOperation.params, [id], "getOperation")
packages/extension/src/wallet/services/operation-journal/client.ts:43:		return validateResult(OperationJournalMethodSchemas.getOperation.result, result, "getOperation")
packages/extension/src/wallet/services/operation-journal/client.ts:47:		validateParams(OperationJournalMethodSchemas.getOperations.params, [filter], "getOperations")
packages/extension/src/wallet/services/operation-journal/client.ts:49:		return validateResult(OperationJournalMethodSchemas.getOperations.result, result, "getOperations")
packages/extension/src/wallet/services/operation-journal/client.ts:53:		validateParams(OperationJournalMethodSchemas.deleteOperation.params, [id], "deleteOperation")
packages/extension/src/wallet/services/operation-journal/spec.ts:14:import { z } from "zod"
packages/extension/src/wallet/services/pxe/service.ts:25:import z from "zod"
packages/extension/src/wallet/services/pxe/client.ts:17:import z from "zod"
packages/extension/src/wallet/services/execution/authwit-discoverer.ts:45:import z from "zod"
packages/extension/src/wallet/services/execution/service.ts:35:import z from "zod"
packages/extension/src/wallet/base/zod-helpers.test.ts:2:import { z } from "zod"
packages/extension/src/wallet/base/zod-helpers.test.ts:4:import { validateParams, validateResult } from "./zod-helpers"
packages/extension/src/wallet/base/zod-helpers.test.ts:6:describe("validateParams", () => {
packages/extension/src/wallet/base/zod-helpers.test.ts:10:		const out = validateParams(schema, ["hello", 42], "testMethod")
packages/extension/src/wallet/base/zod-helpers.test.ts:15:		expect(() => validateParams(schema, ["", 42], "testMethod")).toThrow(ValidationError)
packages/extension/src/wallet/base/zod-helpers.test.ts:20:			validateParams(schema, ["", 42], "addNetwork")
packages/extension/src/wallet/base/zod-helpers.test.ts:29:			validateParams(schema, [""], "addNetwork")
packages/extension/src/wallet/base/zod-helpers.test.ts:40:			validateParams(schema, ["", -1], "x")
packages/extension/src/wallet/base/zod-helpers.test.ts:51:		expect(() => validateParams(emptySchema, [], "noArgs")).not.toThrow()
packages/extension/src/wallet/base/zod-helpers.test.ts:55:describe("validateResult", () => {
packages/extension/src/wallet/base/zod-helpers.test.ts:59:		const out = validateResult(schema, { id: "a", count: 1 }, "m")
packages/extension/src/wallet/base/zod-helpers.test.ts:64:		expect(() => validateResult(schema, { id: "a", count: "nope" }, "m")).toThrow(ValidationError)
packages/extension/src/wallet/base/zod-helpers.test.ts:69:			validateResult(schema, null, "getNetwork")
packages/extension/src/wallet/base/zod-helpers.test.ts:79:			validateResult(schema, "not an object", "m")
packages/extension/src/wallet/base/zod-helpers.ts:7: *   - client-side, before sending:   validateParams(...)
packages/extension/src/wallet/base/zod-helpers.ts:8: *   - client-side, after receiving:  validateResult(...)
packages/extension/src/wallet/base/zod-helpers.ts:9: *   - service-side, on entry:        validateParams(...)
packages/extension/src/wallet/base/zod-helpers.ts:20:import type { ZodType } from "zod"
packages/extension/src/wallet/base/zod-helpers.ts:38:export function validateParams<T>(schema: ZodType<T>, params: unknown, method: string): T {
packages/extension/src/wallet/base/zod-helpers.ts:54:export function validateResult<T>(schema: ZodType<T>, value: unknown, method: string): T {
packages/extension/src/wallet/services/network/service.ts:4:import { validateParams } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/network/service.ts:101:		validateParams(NetworkMethodSchemas.getNetworks.params, [chainId], "getNetworks")
packages/extension/src/wallet/services/network/service.ts:113:		validateParams(NetworkMethodSchemas.getNetwork.params, [id], "getNetwork")
packages/extension/src/wallet/services/network/service.ts:127:		validateParams(NetworkMethodSchemas.addNetwork.params, [name, rpcUrl], "addNetwork")
packages/extension/src/wallet/services/network/service.ts:145:		validateParams(NetworkMethodSchemas.updateNetwork.params, [id, name, rpcUrl], "updateNetwork")
packages/extension/src/wallet/services/network/service.ts:171:		validateParams(NetworkMethodSchemas.deleteNetwork.params, [id], "deleteNetwork")
packages/extension/src/wallet/services/network/service.ts:192:		validateParams(NetworkMethodSchemas.setDefault.params, [id], "setDefault")
packages/extension/src/wallet/services/network/service.ts:222:		validateParams(NetworkMethodSchemas.getNodeStatus.params, [id], "getNodeStatus")
packages/extension/src/wallet/services/network/spec.ts:1:import { z } from "zod"
packages/extension/src/wallet/services/network/client.ts:3:import { validateParams, validateResult } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/network/client.ts:27:		validateParams(NetworkMethodSchemas.getOrInitNetworks.params, [], "getOrInitNetworks")
packages/extension/src/wallet/services/network/client.ts:29:		return validateResult(NetworkMethodSchemas.getOrInitNetworks.result, result, "getOrInitNetworks")
packages/extension/src/wallet/services/network/client.ts:33:		validateParams(NetworkMethodSchemas.getNetworks.params, [chainId], "getNetworks")
packages/extension/src/wallet/services/network/client.ts:35:		return validateResult(NetworkMethodSchemas.getNetworks.result, result, "getNetworks")
packages/extension/src/wallet/services/network/client.ts:39:		validateParams(NetworkMethodSchemas.getNetwork.params, [id], "getNetwork")
packages/extension/src/wallet/services/network/client.ts:41:		return validateResult(NetworkMethodSchemas.getNetwork.result, result, "getNetwork")
packages/extension/src/wallet/services/network/client.ts:45:		validateParams(NetworkMethodSchemas.addNetwork.params, [name, rpcUrl], "addNetwork")
packages/extension/src/wallet/services/network/client.ts:47:		return validateResult(NetworkMethodSchemas.addNetwork.result, result, "addNetwork")
packages/extension/src/wallet/services/network/client.ts:51:		validateParams(NetworkMethodSchemas.updateNetwork.params, [id, name, rpcUrl], "updateNetwork")
packages/extension/src/wallet/services/network/client.ts:53:		return validateResult(NetworkMethodSchemas.updateNetwork.result, result, "updateNetwork")
packages/extension/src/wallet/services/network/client.ts:57:		validateParams(NetworkMethodSchemas.deleteNetwork.params, [id], "deleteNetwork")
packages/extension/src/wallet/services/network/client.ts:59:		return validateResult(NetworkMethodSchemas.deleteNetwork.result, result, "deleteNetwork")
packages/extension/src/wallet/services/network/client.ts:63:		validateParams(NetworkMethodSchemas.setDefault.params, [id], "setDefault")
packages/extension/src/wallet/services/network/client.ts:65:		return validateResult(NetworkMethodSchemas.setDefault.result, result, "setDefault")
packages/extension/src/wallet/services/network/client.ts:69:		validateParams(NetworkMethodSchemas.getNodeStatus.params, [id], "getNodeStatus")
packages/extension/src/wallet/services/network/client.ts:71:		return validateResult(NetworkMethodSchemas.getNodeStatus.result, result, "getNodeStatus")

exec
/bin/zsh -lc "rg -n \"from \\\"@/wallet/storage\\\"|from \\\"@/wallet/base\\\"|from \\\"@/wallet/base/background\\\"|from \\\"@/wallet/base/offscreen\\\"|from \\\"@/wallet/base/zod-helpers\\\"|from \\\"@/wallet/base/errors\\\"|from \\\"@/wallet/base/messages\\\"\" packages/extension/src -S" in (project root)
 succeeded in 0ms:
packages/extension/src/offscreen/index.ts:1:import { ServiceCollection } from "@/wallet/base"
packages/extension/src/wallet/services/account-state/service.ts:3:import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/account-state/service.ts:4:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/account-state/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/account-state/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/account-state/spec.ts:3:import type { Restored } from "@/wallet/base"
packages/extension/src/wallet/utils/serialization.test.ts:2:import { InvalidPasswordError, UserRejectedError, WalletError } from "@/wallet/base/errors"
packages/extension/src/wallet/services/log-viewer/service.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/log-viewer/service.ts:2:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/log-viewer/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/log-viewer/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/config/store.ts:1:import { StorageType, ValueStorage } from "@/wallet/storage"
packages/extension/src/wallet/services/network/service.ts:2:import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/network/service.ts:3:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/network/service.ts:4:import { validateParams } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/network/service.ts:9:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/network/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/network/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/network/client.ts:3:import { validateParams, validateResult } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/auth-registry/service.ts:2:import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/auth-registry/service.ts:3:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/auth-registry/service.ts:11:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/passkey/service.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/passkey/service.ts:2:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/contact/service.ts:2:import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/contact/service.ts:3:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/contact/service.ts:6:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/logger/service.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/logger/service.ts:2:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/contact/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/contact/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/note/service.ts:4:import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/note/service.ts:5:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/logger/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/logger/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/passkey/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/passkey/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/popup/pages/auth.vue:15:import { InvalidPasswordError } from "@/wallet/base/errors"
packages/extension/src/wallet/services/auth-registry/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/auth-registry/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/note/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/note/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/wallet-sdk/background.ts:29:import type { ServiceCollection } from "@/wallet/base"
packages/extension/src/wallet/services/contact/service.test.ts:13:import { ServiceCollection, type IService } from "@/wallet/base"
packages/extension/src/wallet/services/config/service.ts:1:import type { Restored, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/config/service.ts:2:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/operation-journal/service.ts:2:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/operation-journal/service.ts:3:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/operation-journal/service.ts:4:import { validateParams } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/operation-journal/service.ts:6:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/operation-journal/service.test.ts:10:import { ServiceCollection } from "@/wallet/base"
packages/extension/src/wallet/services/operation-journal/service.test.ts:11:import { ValidationError } from "@/wallet/base/errors"
packages/extension/src/wallet/services/dapp-interaction/service.ts:2:import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/dapp-interaction/service.ts:3:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/base/background/client.test.ts:19:import { RpcTimeoutError, UserRejectedError, ValidationError, WalletError } from "@/wallet/base/errors"
packages/extension/src/wallet/base/background/client.test.ts:20:import { MessageType, type ResponseMessage } from "@/wallet/base/messages"
packages/extension/src/wallet/services/transaction/service.ts:2:import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/transaction/service.ts:3:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/transaction/service.ts:10:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/token/service.ts:2:import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/token/service.ts:3:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/token/service.ts:10:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/config/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/config/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/dapp-interaction/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/dapp-interaction/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/token-balance/service.ts:2:import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/token-balance/service.ts:3:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/operation-journal/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/operation-journal/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/operation-journal/client.ts:3:import { validateParams, validateResult } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/profile/service.ts:5:import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/profile/service.ts:6:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/profile/service.ts:7:import { InvalidPasswordError } from "@/wallet/base/errors"
packages/extension/src/wallet/services/token/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/token/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/transaction/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/transaction/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/token-balance/balance-repository.ts:14:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/execution/service.ts:59:import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/execution/service.ts:60:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/profile/client.test.ts:12:import { MessageType, type ResponseMessage } from "@/wallet/base/messages"
packages/extension/src/wallet/services/token-balance/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/token-balance/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/execution/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/execution/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/profile/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/profile/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/account/service.ts:4:import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/account/service.ts:5:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/account/service.ts:7:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/dapp-session/service.ts:1:import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/dapp-session/service.ts:2:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/dapp-session/service.ts:5:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/profile/session-manager.ts:52:import { StorageType, ValueStorage } from "@/wallet/storage"
packages/extension/src/wallet/services/profile/repository.ts:19:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/task/service.ts:1:import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/task/service.ts:2:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/profile/service.integration.test.ts:21:import { ServiceCollection } from "@/wallet/base"
packages/extension/src/wallet/services/profile/service.integration.test.ts:22:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/profile/service.integration.test.ts:24:import { InvalidPasswordError } from "@/wallet/base/errors"
packages/extension/src/wallet/services/dapp-session/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/dapp-session/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/account/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/account/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/fpc/service.ts:3:import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/fpc/service.ts:4:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/fpc/service.ts:8:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/task/client.test.ts:2:import { type EventMessage, MessageType } from "@/wallet/base/messages"
packages/extension/src/wallet/services/fpc/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/fpc/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/task/service.test.ts:2:import { ServiceCollection } from "@/wallet/base"
packages/extension/src/wallet/services/task/client.ts:1:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/task/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/pxe/service.ts:28:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/pxe/service.ts:29:import { Service } from "@/wallet/base/offscreen"
packages/extension/src/wallet/services/pxe/client.ts:19:import type { ServiceSpec } from "@/wallet/base"
packages/extension/src/wallet/services/pxe/client.ts:21:import { ServiceClient } from "@/wallet/base/offscreen"

exec
/bin/zsh -lc "rg -n \"@use|@import\" packages/extension/src/components packages/extension/src/popup/components packages/extension/src/assets/styles -g '"'!**/*.js'"' -S" in (project root)
exec
/bin/zsh -lc 'rg -n "wallet/services|ServiceClient|@/wallet/services|@nulo/" packages/extension/src/components packages/extension/src/popup/components packages/extension/src/components/ui packages/extension/src/composables -S' in (project root)
 succeeded in 0ms:
packages/extension/src/assets/styles/_base.scss:1:@use "./flex" as *;
packages/extension/src/assets/styles/_base.scss:2:@use "./text" as *;
packages/extension/src/assets/styles/_base.scss:5:@import "/node_modules/vite-plugin-vue-devtools/src//overlay/devtools-overlay.css";

 succeeded in 0ms:
packages/extension/src/components/Header.vue:4:import { LogViewerServiceClient } from "@/wallet/services/log-viewer/client"
packages/extension/src/components/Header.vue:5:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/components/Header.vue:6:import { TaskServiceClient } from "@/wallet/services/task/client"
packages/extension/src/components/Header.vue:27:const logViewerService = new LogViewerServiceClient()
packages/extension/src/components/Header.vue:30:const configService = new ConfigServiceClient()
packages/extension/src/components/Header.vue:48:const taskService = new TaskServiceClient()
packages/extension/src/composables/configClient.ts:1:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/composables/configClient.ts:4:const client = new ConfigServiceClient("shared-config")
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:12:import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:13:import { ExecutionServiceClient } from "@/wallet/services/execution/client"
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:14:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:220:const fpcService = new FpcServiceClient()
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:224:const executionService = new ExecutionServiceClient()
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:226:const tokenBalanceService = new TokenBalanceServiceClient()
packages/extension/src/components/ui/Popup/PopupCard.vue:4:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/components/ui/Popup/PopupCard.vue:16:const configService = new ConfigServiceClient()
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:13:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:14:import { LogViewerServiceClient } from "@/wallet/services/log-viewer/client"
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:27:const logViewerService = new LogViewerServiceClient()
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:30:const configService = new ConfigServiceClient()
packages/extension/src/popup/components/modules/activity/TransactionCard.vue:6:import { OriginType, TxStatus, TxExecutionResult } from "@/wallet/services/transaction/client"
packages/extension/src/popup/components/popups/EditTokenPopup.vue:6:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/EditTokenPopup.vue:7:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/popups/EditTokenPopup.vue:38:const tokenService = new TokenServiceClient()
packages/extension/src/popup/components/popups/EditTokenPopup.vue:48:const tokenBalanceService = new TokenBalanceServiceClient()
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue:6:import { ExecutionServiceClient } from "@/wallet/services/execution/client"
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue:7:import { TransactionServiceClient } from "@/wallet/services/transaction/client"
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue:8:import { NuloFeePaymentMethod } from "@/wallet/services/account/contracts"
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue:9:import { TxStatus } from "@/wallet/services/transaction/spec"
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue:47:const executionService = new ExecutionServiceClient()
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue:48:const transactionService = new TransactionServiceClient()
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:13:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:14:import { LogViewerServiceClient } from "@/wallet/services/log-viewer/client"
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:27:const logViewerService = new LogViewerServiceClient()
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:30:const configService = new ConfigServiceClient()
packages/extension/src/components/ui/Popup/PopupCard.vue:4:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/components/ui/Popup/PopupCard.vue:16:const configService = new ConfigServiceClient()
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:10:import { OperationJournalServiceClient } from "@/wallet/services/operation-journal/client"
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:11:import { TaskServiceClient } from "@/wallet/services/task/client"
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:12:import { ContentKind, TaskStatus } from "@/wallet/services/task/spec"
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:13:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:14:import { OriginType, TxStatus } from "@/wallet/services/transaction/spec"
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:61:const tokenService = new TokenServiceClient()
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:101:const taskService = new TaskServiceClient()
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:110:const journalService = new OperationJournalServiceClient()
packages/extension/src/popup/components/modules/general/BalanceView.vue:12:import { ContentKind } from "@/wallet/services/task/spec"
packages/extension/src/popup/components/modules/general/BalanceView.vue:13:import { TaskServiceClient } from "@/wallet/services/task/client"
packages/extension/src/popup/components/modules/general/BalanceView.vue:14:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/modules/general/BalanceView.vue:15:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/modules/general/BalanceView.vue:123:const taskService = new TaskServiceClient()
packages/extension/src/popup/components/modules/general/BalanceView.vue:168:const tokenBalanceService = new TokenBalanceServiceClient()
packages/extension/src/popup/components/modules/general/BalanceView.vue:189:const tokenService = new TokenServiceClient()
packages/extension/src/popup/components/popups/EditContactPopup.vue:6:import { ContactServiceClient } from "@/wallet/services/contact/client"
packages/extension/src/popup/components/popups/EditContactPopup.vue:27:const contactService = new ContactServiceClient()
packages/extension/src/popup/components/modules/general/TokensView.vue:7:import { ContentKind } from "@/wallet/services/task/spec"
packages/extension/src/popup/components/modules/general/TokensView.vue:8:import { TaskServiceClient } from "@/wallet/services/task/client"
packages/extension/src/popup/components/modules/general/TokensView.vue:9:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/modules/general/TokensView.vue:45:const taskService = new TaskServiceClient()
packages/extension/src/popup/components/modules/general/TokensView.vue:129:const tokenBalanceService = new TokenBalanceServiceClient()
packages/extension/src/popup/components/popups/NewContactPopup.vue:6:import { ContactServiceClient } from "@/wallet/services/contact/client"
packages/extension/src/popup/components/popups/NewContactPopup.vue:25:const contactService = new ContactServiceClient()
packages/extension/src/popup/components/popups/ChangeAuthwitsRegistryPopup.vue:6:import { AuthRegistryServiceClient } from "@/wallet/services/auth-registry/client"
packages/extension/src/popup/components/popups/ChangeAuthwitsRegistryPopup.vue:27:const authwitsService = new AuthRegistryServiceClient()
packages/extension/src/popup/components/popups/NewSenderPopup.vue:5:import { AccountStateServiceClient } from "@/wallet/services/account-state/client"
packages/extension/src/popup/components/popups/NewSenderPopup.vue:87:			accountStateClientService = new AccountStateServiceClient()
packages/extension/src/popup/components/popups/SelectTokenPopup.vue:3:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/popups/SelectTokenPopup.vue:26:const tokenService = new TokenServiceClient()
packages/extension/src/popup/components/popups/NewTokenPopup/NewTokenPopup.vue:6:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/NewTokenPopup/NewTokenPopup.vue:7:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/popups/NewTokenPopup/NewTokenPopup.vue:34:const tokenService = new TokenServiceClient()
packages/extension/src/popup/components/popups/NewTokenPopup/NewTokenPopup.vue:47:const tokenBalanceService = new TokenBalanceServiceClient()
packages/extension/src/popup/components/popups/SelectFpcPopup.vue:3:import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"
packages/extension/src/popup/components/popups/SelectFpcPopup.vue:4:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/SelectFpcPopup.vue:75:		fpcService = new FpcServiceClient()
packages/extension/src/popup/components/popups/SelectFpcPopup.vue:79:		tokenBalanceService = new TokenBalanceServiceClient()
packages/extension/src/popup/components/popups/SelectProfilePopup.vue:6:import { ProfileServiceClient } from "@/wallet/services/profile/client"
packages/extension/src/popup/components/popups/SelectProfilePopup.vue:21:const profileService = new ProfileServiceClient()
packages/extension/src/popup/components/popups/AccountsPopup.vue:3:import { AccountType } from "@/wallet/services/account/client"
packages/extension/src/popup/components/popups/EditFpcPopup.vue:3:import { FpcServiceClient } from "@/wallet/services/fpc/client"
packages/extension/src/popup/components/popups/EditFpcPopup.vue:97:			fpcService = new FpcServiceClient()
packages/extension/src/popup/components/popups/ImportPopup.vue:4:import { AccountServiceClient } from "@/wallet/services/account/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:5:import { AccountStateServiceClient } from "@/wallet/services/account-state/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:6:import { AuthRegistryServiceClient } from "@/wallet/services/auth-registry/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:7:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:8:import { ContactServiceClient } from "@/wallet/services/contact/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:9:import { FpcServiceClient } from "@/wallet/services/fpc/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:10:import { NetworkServiceClient } from "@/wallet/services/network/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:11:import { ProfileServiceClient } from "@/wallet/services/profile/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:12:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:13:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:14:import { TransactionServiceClient } from "@/wallet/services/transaction/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:15:import { EncryptionKey } from "@/wallet/services/profile/encryption/encryption-key"
packages/extension/src/popup/components/popups/ImportPopup.vue:406:		const profileService = new ProfileServiceClient()
packages/extension/src/popup/components/popups/ImportPopup.vue:433:		const networkService = new NetworkServiceClient()
packages/extension/src/popup/components/popups/ImportPopup.vue:487:		const accountService = new AccountServiceClient()
packages/extension/src/popup/components/popups/ImportPopup.vue:508:		const tokenService = new TokenServiceClient()
packages/extension/src/popup/components/popups/ImportPopup.vue:524:			new TransactionServiceClient(),
packages/extension/src/popup/components/popups/ImportPopup.vue:525:			new TokenBalanceServiceClient(),
packages/extension/src/popup/components/popups/ImportPopup.vue:526:			new AccountStateServiceClient(),
packages/extension/src/popup/components/popups/ImportPopup.vue:527:			new AuthRegistryServiceClient(),
packages/extension/src/popup/components/popups/ImportPopup.vue:528:			new FpcServiceClient(),
packages/extension/src/popup/components/popups/ImportPopup.vue:529:			new ContactServiceClient(),
packages/extension/src/popup/components/popups/ImportPopup.vue:530:			new ConfigServiceClient(),
packages/extension/src/popup/components/popups/NewAccountPopup.vue:3:import { AccountType } from "@/wallet/services/account/client"
packages/extension/src/popup/components/popups/NewFpcPopup.vue:9:import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"
packages/extension/src/popup/components/popups/NewFpcPopup.vue:10:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/NewFpcPopup.vue:137:			fpcService = new FpcServiceClient()
packages/extension/src/popup/components/popups/NewFpcPopup.vue:143:			tokenBalanceService = new TokenBalanceServiceClient()
packages/extension/src/popup/components/popups/SelectBalanceTypePopup.vue:3:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/SelectBalanceTypePopup.vue:45:const tokenBalanceService = new TokenBalanceServiceClient()
packages/extension/src/popup/components/popups/StealthPromoPopup.vue:6:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/popup/components/popups/StealthPromoPopup.vue:12:const configService = new ConfigServiceClient()
packages/extension/src/popup/components/popups/ImportContactsPopup.vue:3:import { ContactServiceClient } from "@/wallet/services/contact/client"
packages/extension/src/popup/components/popups/ImportContactsPopup.vue:26:const contactService = new ContactServiceClient()
packages/extension/src/popup/components/popups/TokenMetadataPopup.vue:3:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/popups/TokenMetadataPopup.vue:29:const tokenService = new TokenServiceClient()
packages/extension/src/popup/components/popups/RevokeAuthwitsPopup.vue:6:import { AuthRegistryServiceClient, MAX_REVOKES_PER_TX } from "@/wallet/services/auth-registry/client"
packages/extension/src/popup/components/popups/RevokeAuthwitsPopup.vue:29:const authwitsService = new AuthRegistryServiceClient()
packages/extension/src/popup/components/popups/EditProfilePopup.vue:3:import { ProfileServiceClient } from "@/wallet/services/profile/client"
packages/extension/src/popup/components/popups/EditProfilePopup.vue:69:			profileService = new ProfileServiceClient()
packages/extension/src/popup/components/popups/ChangeProfilePasswordPopup.vue:3:import { ProfileServiceClient } from "@/wallet/services/profile/client"
packages/extension/src/popup/components/popups/ChangeProfilePasswordPopup.vue:75:			profileService = new ProfileServiceClient()
packages/extension/src/popup/components/popups/RegisterPopup/RegisterPopup.vue:9:import { AccountServiceClient } from "@/wallet/services/account/client"
packages/extension/src/popup/components/popups/RegisterPopup/RegisterPopup.vue:10:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/popup/components/popups/RegisterPopup/RegisterPopup.vue:21:const configService = new ConfigServiceClient()
packages/extension/src/popup/components/popups/RegisterPopup/RegisterPopup.vue:115:	managers.account = new AccountServiceClient()

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/tsconfig.json" in (project root)
 succeeded in 0ms:
{
	"compilerOptions": {
		"incremental": true,
		"target": "ESNext",
		"jsx": "preserve",
		"lib": ["ESNext", "DOM", "WebWorker"],
		"useDefineForClassFields": true,
		"module": "ESNext",
		"moduleResolution": "Bundler",
		"paths": {
			"@/*": ["./src/*"],
			"~/*": ["./src/*"],
			"src/*": ["./src/*"],
			"@assets/*": ["./src/assets/*"]
		},
		"resolveJsonModule": true,
		"types": ["webextension-polyfill", "chrome-types"],
		"strict": true,
		"noEmit": true,
		"esModuleInterop": true,
		"isolatedModules": true,
		"skipLibCheck": true
	},
	"include": ["package.json", "vite.config.ts", "src/**/*.ts", "src/**/*.d.ts", "src/**/*.tsx", "src/**/*.vue"]
}

exec
/bin/zsh -lc 'rg -n "@assets/|src/assets/|assets/" packages/extension/src -S' in (project root)
 succeeded in 0ms:
packages/extension/src/assets/styles/_base.scss:186:	src: local("ClashDisplay-Medium"), url("./assets/fonts/ClashDisplay-Medium.ttf");
packages/extension/src/assets/styles/_base.scss:194:	src: url("@/assets/fonts/InterVariable.woff2") format("woff2");
packages/extension/src/assets/styles/_base.scss:203:		url("@/assets/fonts/SpaceGrotesk-latin.woff2") format("woff2"),
packages/extension/src/assets/styles/_base.scss:204:		url("@/assets/fonts/SpaceGrotesk-latin-ext.woff2") format("woff2");
packages/extension/src/assets/styles/_base.scss:212:	src: url("@/assets/fonts/JetBrainsMono-latin.woff2") format("woff2");
packages/extension/src/assets/styles/_base.scss:220:	src: url("@/assets/fonts/MaterialSymbolsOutlined.woff2") format("woff2");
packages/extension/src/wallet/services/rpc/types.ts:8:	logo: chrome.runtime.getURL("/src/assets/logo.png"),
packages/extension/src/shims/bb-fetch-code.ts:8: * The WASM files are copied to /assets/ by vite-plugin-static-copy from libs/@aztec/bb.js/.
packages/extension/src/shims/bb-fetch-code.ts:13:const DEFAULT_WASM_PATH = "/assets/barretenberg.wasm.gz"
packages/extension/src/components/core/Icon.vue:4:import icons from "@/assets/icons.json"
packages/extension/src/wallet/services/wallet-sdk/background.ts:96:			walletIcon: chrome.runtime.getURL("/src/assets/logo.png"),
packages/extension/src/composables/externalImage.ts:2:import privacyPlaceholder from "@/assets/privacy-placeholder.svg"
packages/extension/src/setup/index.ts:5:// import "@/assets/styles/base.scss"
packages/extension/src/popup/app.vue:28:import LogoIcon from "@/assets/logo.svg?raw"
packages/extension/src/popup/index.ts:24:import "@/assets/styles/_base.scss"

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/services/rpc/types.ts && printf '\\n---WALLET SDK BG---\\n' && sed -n '1,220p' packages/extension/src/wallet/services/wallet-sdk/background.ts" in (project root)
 succeeded in 0ms:
import packageJson from "../../../../package.json"
const { version } = packageJson

export const NuloWalletInfo: WalletInfo = {
	name: "Nulo",
	description:
		"User-friendly self-custody wallet for Aztec network, preserving your privacy and revealing the power of account abstraction.",
	logo: chrome.runtime.getURL("/src/assets/logo.png"),
	url: "https://nulo.sh",
	version,
	capabilities: ["batch_execution"],
}

export type WalletInfo = {
	name: string
	description: string
	logo: string
	url: string
	version: string
	capabilities: string[]
}

export enum RpcMethod {
	get_wallet_info = "get_wallet_info",
	get_session = "get_session",
	close_session = "close_session",
	execute = "execute",
}

export enum RpcEvent {
	session_updated = "session_updated",
	session_closed = "session_closed",
}

---WALLET SDK BG---
/**
 * Wallet-SDK Background Integration
 *
 * Sets up the `BackgroundConnectionHandler` from `@aztec/wallet-sdk` in the
 * extension's service worker. This replaces the old `RpcService` + content
 * script proxy system with the standardized wallet-sdk discovery / key-exchange
 * / encrypted-channel protocol.
 *
 * ## How it works
 *
 * 1. **Discovery**: A dApp broadcasts a discovery request via postMessage.
 *    The content script forwards it to the background. We receive it via
 *    `onPendingDiscovery` and either auto-approve (returning user with valid
 *    session) or show a popup for user approval via `DappInteractionService`.
 *
 * 2. **Key Exchange**: After approval, the wallet-sdk performs ECDH P-256 key
 *    exchange to establish an AES-256-GCM encrypted channel.
 *
 * 3. **Wallet Messages**: Once connected, the dApp sends method calls (e.g.
 *    `sendTx`, `simulateTx`) encrypted over the channel. We decrypt them
 *    and route to `WalletSdkDispatcher` which delegates to `ExecutionService`.
 *
 * 4. **Responses**: Results are encrypted and sent back through the channel.
 */

import { BackgroundConnectionHandler, type PendingDiscovery, type ActiveSession } from "@aztec/wallet-sdk/extension/handlers"
import type { WalletMessage, WalletResponse } from "@aztec/wallet-sdk/types"

import type { ServiceCollection } from "@/wallet/base"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { ExecutionService } from "@/wallet/services/execution/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { DappInteractionService } from "@/wallet/services/dapp-interaction/service"
import type { DiscoveryParams } from "@/wallet/services/dapp-interaction/spec"
import { DappSessionService, AccessLevel } from "@/wallet/services/dapp-session/service"
import { WalletSdkDispatcher } from "./dispatcher"
import { DiscoveryQueue } from "./discovery-queue"
import type { SessionContext } from "./types"
import { formatCaipChain } from "@/wallet/utils/caip"
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@/wallet/logger"
import type { Fr } from "@aztec/foundation/curves/bn254"
import packageJson from "../../../../package.json"

/**
 * Initialize the wallet-sdk BackgroundConnectionHandler and wire it
 * to the extension's service layer.
 *
 * Call this after `services.start()` in the service worker entry point.
 */
export function initWalletSdkHandler(services: ServiceCollection, logger: ILogger): BackgroundConnectionHandler {
	const networkService: NetworkService = services.get(NetworkService.name)
	const accountService: AccountService = services.get(AccountService.name)
	const executionService: ExecutionService = services.get(ExecutionService.name)
	const profileService: ProfileService = services.get(ProfileService.name)
	const dappInteractionService: DappInteractionService = services.get(DappInteractionService.name)
	const dappSessionService: DappSessionService = services.get(DappSessionService.name)

	const dispatcher = new WalletSdkDispatcher(
		networkService,
		accountService,
		executionService,
		profileService,
		dappInteractionService,
		dappSessionService,
		logger,
	)

	/** Track origins of new connections (user-approved via popup) to show verification after key exchange */
	const pendingVerification = new Set<string>()

	/**
	 * Guard against concurrent discoveries for the same origin (prevents
	 * duplicate connect popups). Stores a promise that resolves when the
	 * connect popup completes, so duplicate discoveries wait for the session
	 * to exist before being approved.
	 */
	const pendingDiscoveryPromises = new Map<string, Promise<void>>()

	/**
	 * Per-session message queue — ensures messages from the same dApp session
	 * are processed sequentially (FIFO). Without this, the fire-and-forget
	 * onWalletMessage callback processes messages concurrently, causing race
	 * conditions (e.g. executeUtility runs before registerContract completes).
	 */
	const sessionQueues = new Map<string, Promise<void>>()

	let discoveryQueue: DiscoveryQueue

	const handler = new BackgroundConnectionHandler(
		{
			walletId: "nulo",
			walletName: "Nulo",
			walletVersion: packageJson.version,
			walletIcon: chrome.runtime.getURL("/src/assets/logo.png"),
		},
		{
			sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
			addContentListener: (listener) => {
				// biome-ignore lint/suspicious/noExplicitAny: Chrome message listener provides untyped messages
				chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender) => {
					listener(message, sender)
					return undefined
				})
			},
		},
		{
			onPendingDiscovery: (discovery) => {
				handleDiscovery(
					discovery,
					handler,
					profileService,
					dappInteractionService,
					dappSessionService,
					pendingVerification,
					pendingDiscoveryPromises,
					discoveryQueue,
					logger,
				)
			},

			onSessionEstablished: async (session) => {
				const dappSession = await dappSessionService.tryGetDappSessionByOrigin(session.origin)
				if (dappSession) {
					await dappSessionService.setVerificationHash(dappSession.id, session.verificationHash)
				}

				const isNewConnection = pendingVerification.has(session.origin)
				if (isNewConnection) pendingVerification.delete(session.origin)

				const needsVerification = isNewConnection || (dappSession && !dappSession.trustedVerification)

				if (needsVerification && dappSession) {
					chrome.windows.create({
						type: "popup",
						url: chrome.runtime.getURL(
							`src/popup/index.html#/windows/verify?sessionId=${dappSession.id}&isReconnect=${!isNewConnection}`,
						),
						height: 800,
						width: 400,
					})
				}
			},

			onSessionTerminated: (sessionId) => {
				sessionQueues.delete(sessionId)
				decryptQueues.delete(sessionId)
			},

			onWalletMessage: (session, message) => {
				const key = session.sessionId
				const prev = sessionQueues.get(key) ?? Promise.resolve()
				const next = prev.then(() => handleWalletMessage(session, message, handler, dispatcher, profileService, logger))
				sessionQueues.set(
					key,
					next.catch(() => {}),
				)
			},
		},
	)

	discoveryQueue = new DiscoveryQueue(handler, logger)

	/**
	 * Serialize decryption per-session to prevent message reordering.
	 * The wallet-sdk uses `void this.handleEncryptedMessage(...)` (fire-and-forget),
	 * so two messages can have their decryptions race.
	 * TODO: Remove this monkey-patch if wallet-sdk adds a proper serialization API.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: monkey-patching private method on BackgroundConnectionHandler to serialize decryption
	const origDecrypt = (handler as any).handleEncryptedMessage.bind(handler)
	const decryptQueues = new Map<string, Promise<void>>()
	// biome-ignore lint/suspicious/noExplicitAny: monkey-patching private method on BackgroundConnectionHandler to serialize decryption
	;(handler as any).handleEncryptedMessage = async (sessionId: string, encrypted: unknown) => {
		const prev = decryptQueues.get(sessionId) ?? Promise.resolve()
		const next = prev.then(() => origDecrypt(sessionId, encrypted))
		decryptQueues.set(
			sessionId,
			next.catch(() => {}),
		)
		return next
	}

	/** On unlock, drain any queued discovery requests */
	profileService.onActiveProfileChanged.add((profile) => {
		if (profile) {
			logger.log("wallet-sdk", LogLevel.Info, `Profile unlocked, draining discovery queue (${discoveryQueue.size} queued)`)
			discoveryQueue.drain(async (discovery) => {
				const p = await profileService.getActiveProfile()
				if (!p) {
					logger.log("wallet-sdk", LogLevel.Warn, "Wallet locked mid-drain, stopping")
					return false
				}
				logger.log(
					"wallet-sdk",
					LogLevel.Info,
					`Processing queued discovery: ${discovery.origin} (requestId: ${discovery.requestId})`,
				)
				await handleDiscovery(
					discovery,
					handler,
					profileService,
					dappInteractionService,
					dappSessionService,
					pendingVerification,
					pendingDiscoveryPromises,
					discoveryQueue,
					logger,
				)
				logger.log("wallet-sdk", LogLevel.Info, `Queued discovery processed: ${discovery.origin}`)
				return true
			})
		} else {
			logger.log("wallet-sdk", LogLevel.Info, `Profile locked (${discoveryQueue.size} in queue)`)
		}
	})

	// Terminate sessions when a tab is closed
	chrome.tabs.onRemoved.addListener((tabId) => {

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/services/pxe/service.ts && printf '\\n---PXE CLIENT---\\n' && sed -n '1,220p' packages/extension/src/wallet/services/pxe/client.ts && printf '\\n---CHAIN RUNTIME---\\n' && sed -n '1,260p' packages/extension/src/wallet/services/pxe/chain-runtime.ts" in (project root)
 succeeded in 0ms:
import type { PackedPrivateEvent, PXE } from "@aztec/pxe/client/bundle"
import { Fr } from "@aztec/foundation/curves/bn254"
import { type ContractArtifact, ContractArtifactSchema, EventSelector, FunctionCall } from "@aztec/stdlib/abi"
import { AuthWitness } from "@aztec/stdlib/auth-witness"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import {
	type ContractInstanceWithAddress,
	ContractInstanceWithAddressSchema,
	getContractInstanceFromInstantiationParams,
	type CompleteAddress,
	type PartialAddress,
} from "@aztec/stdlib/contract"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { NoteDao } from "@aztec/stdlib/note"
import type { NotesFilter } from "./spec"
import {
	SimulationOverrides,
	TxExecutionRequest,
	type TxProvingResult,
	type TxSimulationResult,
	type UtilityExecutionResult,
	type TxProfileResult,
} from "@aztec/stdlib/tx"
import type { SimulateTxOpts, ExecuteUtilityOpts, ProfileTxOpts } from "@aztec/pxe/client/bundle"
import z from "zod"

const AccessScopesSchema = z.array(AztecAddress.schema)
import type { ServiceSpec } from "@/wallet/base"
import { Service } from "@/wallet/base/offscreen"
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import type { Network } from "@/wallet/services/network/client"
import { ProfileServiceClient, type ProfileInfo } from "@/wallet/services/profile/client"
import { ReadWriteGuard } from "@/wallet/utils"
import { type Methods, PXE_SERVICE_NAME } from "./spec"
import { type PrivateEventFilter, PrivateEventFilterSchema } from "@aztec/aztec.js/wallet"
import { NotesFilterSchema } from "@/wallet/utils/schemas"
import { ChainRuntimeRegistry, ProductionPxeFactory } from "./chain-runtime"
import { ArtifactRegistry, HttpRegistryFetcher } from "./artifact-registry"
import { loadProductionKnownArtifacts } from "./known-artifacts"

export * from "./spec"

export class PxeService extends Service<Methods> implements ServiceSpec<Methods> {
	public static name = PXE_SERVICE_NAME

	private readonly profiles = new ProfileServiceClient()
	private readonly config = new ConfigServiceClient()
	private readonly loggerClient = new LoggerServiceClient()
	private readonly guard = new ReadWriteGuard("pxe", this.loggerClient)
	private readonly registry = new ChainRuntimeRegistry(new ProductionPxeFactory())
	private readonly artifacts: ArtifactRegistry

	public constructor() {
		super(PXE_SERVICE_NAME, new LoggerServiceClient())
		// artifacts needs config + initial allowRegistry; init wires both.
		// Initialize with `true` so behavior matches pre-M2.3-b until init()
		// reads the persisted value from config.
		this.artifacts = new ArtifactRegistry(
			this.config,
			new HttpRegistryFetcher(this.loggerClient, PXE_SERVICE_NAME),
			loadProductionKnownArtifacts,
			true,
		)
	}

	protected async init() {
		// delete orphan PXE DBs
		const dbs = await indexedDB.databases()
		const pxes = dbs.filter((x) => x.name?.startsWith("pxe/"))
		if (pxes.length) {
			const profiles = await this.profiles.getProfiles()
			for (let i = pxes.length - 1; i >= 0; i--) {
				if (!profiles.some((x) => pxes[i].name!.startsWith(`pxe/${x.id}/`))) {
					await new Promise<void>((resolve, reject) => {
						const req = indexedDB.deleteDatabase(pxes[i].name!)
						req.onsuccess = () => resolve()
						req.onerror = () => reject(req.error)
						req.onblocked = () => {
							this.logWarn("deleteDatabase blocked (DB still in use):", pxes[i].name)
							resolve() // Skip — don't hang init forever
						}
					})
					pxes.splice(i, 1)
				}
			}
			if (!pxes.length) {
				const keyval = dbs.find((x) => x.name === "keyval-store")
				if (keyval) {
					await new Promise<void>((resolve, reject) => {
						const req = indexedDB.deleteDatabase(keyval.name!)
						req.onsuccess = () => resolve()
						req.onerror = () => reject(req.error)
						req.onblocked = () => {
							this.logWarn("deleteDatabase blocked (DB still in use): keyval-store")
							resolve()
						}
					})
				}
			}
		}

		this.profiles.onProfileDeleted.add(this.onProfileDeleted)
		this.profiles.onActiveProfileChanged.add(this.onActiveProfileChanged)
		await this.profiles.connect()

		// Sync the artifact policy's allowRegistry with the persisted
		// config value. Constructor seeded it optimistically; this
		// reconciles to disk. Further changes are handled by the
		// onUpdate subscription in ArtifactRegistry.
		const enabled = await this.config.getValue("contractRegistry")
		this.artifacts.setPolicy({ ...this.artifacts.getPolicy(), allowRegistry: Boolean(enabled) })
	}

	public async getContractInstance(
		network: Network,
		address: AztecAddress,
		opts?: { pxeOnly?: boolean },
	): Promise<ContractInstanceWithAddress | undefined> {
		address = await AztecAddress.schema.parseAsync(address)
		return this.withPxeRead("getContractInstance", network, async (pxe, node) => {
			let instance = await pxe.getContractInstance(address)
			if (!instance && !opts?.pxeOnly) {
				instance = await node.getContract(address)
				if (!instance) {
					await this.artifacts.ensureKnown()
					instance = this.artifacts.getKnownInstance(address.toString())
				}
			}
			return instance
		})
	}

	public async getContractArtifact(network: Network, id: Fr, opts?: { pxeOnly?: boolean }): Promise<ContractArtifact | undefined> {
		id = await Fr.schema.parseAsync(id)
		return this.withPxeRead("getContractArtifact", network, async (pxe) => {
			return this.artifacts.resolve(id, (classId) => pxe.getContractArtifact(classId), network, opts)
		})
	}

	public async registerAccount(network: Network, secretKey: Fr, partialAddress: PartialAddress): Promise<CompleteAddress> {
		return this.withPxeWrite("registerAccount", network, async (pxe) =>
			pxe.registerAccount(await Fr.schema.parseAsync(secretKey), await Fr.schema.parseAsync(partialAddress)),
		)
	}

	public async registerSender(network: Network, address: AztecAddress): Promise<AztecAddress> {
		return this.withPxeWrite("registerSender", network, async (pxe) =>
			pxe.registerSender(await AztecAddress.schema.parseAsync(address)),
		)
	}

	public async getSenders(network: Network): Promise<AztecAddress[]> {
		return this.withPxeRead("getSenders", network, (pxe) => pxe.getSenders())
	}

	public async removeSender(network: Network, address: AztecAddress): Promise<void> {
		return this.withPxeWrite("removeSender", network, async (pxe) => pxe.removeSender(await AztecAddress.schema.parseAsync(address)))
	}

	public async getRegisteredAccounts(network: Network): Promise<CompleteAddress[]> {
		return this.withPxeRead("getRegisteredAccounts", network, (pxe) => pxe.getRegisteredAccounts())
	}

	public async registerContractClass(network: Network, artifact: ContractArtifact): Promise<void> {
		return this.withPxeWrite("registerContractClass", network, async (pxe) =>
			pxe.registerContractClass(await ContractArtifactSchema.parseAsync(artifact)),
		)
	}

	public async registerContract(
		network: Network,
		contract: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact },
	): Promise<void> {
		return this.withPxeWrite("registerContract", network, async (pxe) =>
			pxe.registerContract({
				instance: await ContractInstanceWithAddressSchema.parseAsync(contract.instance),
				artifact: await ContractArtifactSchema.optional().parseAsync(contract.artifact),
			}),
		)
	}

	public async updateContract(network: Network, contractAddress: AztecAddress, artifact: ContractArtifact): Promise<void> {
		return this.withPxeWrite("updateContract", network, async (pxe) =>
			pxe.updateContract(await AztecAddress.schema.parseAsync(contractAddress), await ContractArtifactSchema.parseAsync(artifact)),
		)
	}

	public async getContracts(network: Network): Promise<AztecAddress[]> {
		return this.withPxeRead("getContracts", network, (pxe) => pxe.getContracts())
	}

	public async getNotes(network: Network, filter: NotesFilter): Promise<NoteDao[]> {
		return this.withPxeWrite("getNotes", network, async (pxe) => pxe.debug.getNotes(await NotesFilterSchema.parseAsync(filter)))
	}

	public async proveTx(network: Network, txRequest: TxExecutionRequest, scopes: AztecAddress[]): Promise<TxProvingResult> {
		return this.withPxeWrite("proveTx", network, async (pxe, node) => {
			// DEBUG: log PXE sync state before proving
			try {
				const header = await pxe.getSyncedBlockHeader()
				const nodeTip = await node.getBlockNumber()
				this.logDebug(`[SYNC-DEBUG] proveTx: PXE anchor block=${header.getBlockNumber()}, node tip=${nodeTip}`)
			} catch (e) {
				this.logDebug(`[SYNC-DEBUG] proveTx: failed to read sync state: ${e}`)
			}

			return pxe.proveTx(await TxExecutionRequest.schema.parseAsync(txRequest), await z.array(AztecAddress.schema).parseAsync(scopes))
		})
	}

	public async simulateTx(
		network: Network,
		txRequest: TxExecutionRequest,
		opts: SimulateTxOpts,
		stubAccountAddresses?: string[],
	): Promise<TxSimulationResult> {
		return this.withPxeWrite("simulateTx", network, async (pxe, node) => {
			// DEBUG: log PXE sync state before simulation
			try {

---PXE CLIENT---
import type { Fr } from "@aztec/foundation/curves/bn254"
import type { SimulateTxOpts, ExecuteUtilityOpts, ProfileTxOpts } from "@aztec/pxe/client/bundle"
import type { ContractArtifact, EventSelector, FunctionCall } from "@aztec/stdlib/abi"
import { ContractArtifactSchema } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import {
	CompleteAddress,
	type ContractInstanceWithAddress,
	type PartialAddress,
	ContractInstanceWithAddressSchema,
} from "@aztec/stdlib/contract"
import type { NoteDao } from "@aztec/stdlib/note"
import type { NotesFilter } from "./spec"
import { type TxExecutionRequest, TxProfileResult, TxProvingResult, TxSimulationResult, UtilityExecutionResult } from "@aztec/stdlib/tx"
import type { PrivateEventFilter } from "@aztec/aztec.js/wallet"
import type { PackedPrivateEvent } from "@aztec/pxe/client/bundle"
import z from "zod"
import type { ILogger } from "@/wallet/logger"
import type { ServiceSpec } from "@/wallet/base"
import type { Network } from "@/wallet/services/network/service"
import { ServiceClient } from "@/wallet/base/offscreen"
import { NoteDaoSchema, PackedPrivateEventSchema } from "@/wallet/utils/schemas"
import { type Methods, PXE_SERVICE_NAME } from "./spec"
import { type IPXE, PXEProxy } from "./proxy"

export * from "./proxy"
export * from "./spec"

export class PxeServiceClient extends ServiceClient<Methods> implements ServiceSpec<Methods> {
	public constructor(logger: ILogger) {
		super(PXE_SERVICE_NAME, logger)
	}

	public getPXE(network: Network): IPXE {
		return new PXEProxy(this, network)
	}

	public async getContractInstance(
		network: Network,
		address: AztecAddress,
		opts?: { pxeOnly?: boolean },
	): Promise<ContractInstanceWithAddress | undefined> {
		const result = await this.request("getContractInstance", network, address, opts)
		return await ContractInstanceWithAddressSchema.optional().parseAsync(result)
	}

	public async getContractArtifact(network: Network, id: Fr, opts?: { pxeOnly?: boolean }): Promise<ContractArtifact | undefined> {
		const result = await this.request("getContractArtifact", network, id, opts)
		return await ContractArtifactSchema.optional().parseAsync(result)
	}

	public async registerAccount(network: Network, secretKey: Fr, partialAddress: PartialAddress): Promise<CompleteAddress> {
		const result = await this.request("registerAccount", network, secretKey, partialAddress)
		return await CompleteAddress.schema.parseAsync(result)
	}

	public async registerSender(network: Network, address: AztecAddress): Promise<AztecAddress> {
		const result = await this.request("registerSender", network, address)
		return await AztecAddress.schema.parseAsync(result)
	}

	public async getSenders(network: Network): Promise<AztecAddress[]> {
		const result = await this.request("getSenders", network)
		return await z.array(AztecAddress.schema).parseAsync(result)
	}

	public async removeSender(network: Network, address: AztecAddress): Promise<void> {
		await this.request("removeSender", network, address)
	}

	public async getRegisteredAccounts(network: Network): Promise<CompleteAddress[]> {
		const result = await this.request("getRegisteredAccounts", network)
		return await z.array(CompleteAddress.schema).parseAsync(result)
	}

	public async registerContractClass(network: Network, artifact: ContractArtifact): Promise<void> {
		await this.request("registerContractClass", network, artifact)
	}

	public async registerContract(
		network: Network,
		contract: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact },
	): Promise<void> {
		await this.request("registerContract", network, contract)
	}

	public async updateContract(network: Network, contractAddress: AztecAddress, artifact: ContractArtifact): Promise<void> {
		await this.request("updateContract", network, contractAddress, artifact)
	}

	public async getContracts(network: Network): Promise<AztecAddress[]> {
		const result = await this.request("getContracts", network)
		return await z.array(AztecAddress.schema).parseAsync(result)
	}

	public async getNotes(network: Network, filter: NotesFilter): Promise<NoteDao[]> {
		const result = await this.request("getNotes", network, filter)
		// Schema rehydrates data fields (Fr, AztecAddress, etc.) after JSON round-trip from offscreen,
		// but produces plain objects, not NoteDao class instances. Cast is safe because consumers
		// (NoteService) only access data properties, never class methods like toBuffer/equals.
		return (await z.array(NoteDaoSchema).parseAsync(result)) as unknown as NoteDao[]
	}

	public async proveTx(network: Network, txRequest: TxExecutionRequest, scopes: AztecAddress[]): Promise<TxProvingResult> {
		const result = await this.request("proveTx", network, txRequest, scopes)
		return await TxProvingResult.schema.parseAsync(result)
	}

	public async profileTx(network: Network, txRequest: TxExecutionRequest, opts: ProfileTxOpts): Promise<TxProfileResult> {
		const result = await this.request("profileTx", network, txRequest, opts)
		return await TxProfileResult.schema.parseAsync(result)
	}

	public async simulateTx(
		network: Network,
		txRequest: TxExecutionRequest,
		opts: SimulateTxOpts,
		stubAccountAddresses?: string[],
	): Promise<TxSimulationResult> {
		const result = await this.request("simulateTx", network, txRequest, opts, stubAccountAddresses)
		return await TxSimulationResult.schema.parseAsync(result)
	}

	public async executeUtility(network: Network, call: FunctionCall, opts: ExecuteUtilityOpts): Promise<UtilityExecutionResult> {
		const result = await this.request("executeUtility", network, call, opts)
		return await UtilityExecutionResult.schema.parseAsync(result)
	}

	public async getPrivateEvents(
		network: Network,
		eventSelector: EventSelector,
		filter: PrivateEventFilter,
	): Promise<PackedPrivateEvent[]> {
		const result = await this.request("getPrivateEvents", network, eventSelector, filter)
		return await z.array(PackedPrivateEventSchema).parseAsync(result)
	}
}

---CHAIN RUNTIME---
import { getPXEConfig, type PXEConfig } from "@aztec/pxe/config"
import { createPXE, type PXE } from "@aztec/pxe/client/bundle"
import { WASMSimulator } from "@aztec/simulator/client"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { AcceleratorProver } from "@alejoamiras/aztec-accelerator"
import { AztecNodeFactoryAdapter } from "@/core/adapters/aztec-node-factory-adapter"
import type { NodeFactory } from "@/core/ports/node-factory-port"
import type { Network } from "@/wallet/services/network/client"

/**
 * Holds the `AztecNode` + `PXE` pair for a single chain bound to a
 * single profile. Created lazily on first access; torn down via
 * `dispose()` when the profile changes or the profile is deleted.
 *
 * The `ChainRuntime` is owned by `ChainRuntimeRegistry`; callers should
 * not construct it directly.
 */
export class ChainRuntime {
	public constructor(
		public readonly chainId: number,
		public readonly node: AztecNode,
		public readonly pxe: PXE,
		public readonly rpcUrl: string,
	) {}

	/**
	 * Shut down the PXE. `pxe.stop()` drains the job queue rather than
	 * aborting in-flight work (verified against upstream @aztec/pxe); so
	 * correctness across profile switch comes from the ReadWriteGuard's
	 * drain-on-write semantics, not teardown. This method just releases
	 * handles after the guard has ensured no readers remain.
	 */
	public async dispose(): Promise<void> {
		const stoppable = this.pxe as unknown as { stop?: () => Promise<void> }
		if (typeof stoppable.stop === "function") {
			try {
				await stoppable.stop()
			} catch {
				// Swallow: the caller is tearing down regardless; a failed stop
				// is not actionable here.
			}
		}
	}
}

/** Seam for unit tests: swap this out with a fake that returns a
 *  fixture `ChainRuntime` (e.g. with mock PXE / node) instead of
 *  running real PXE init. */
export interface PxeFactory {
	createChainRuntime(network: Network): Promise<ChainRuntime>
}

export class ProductionPxeFactory implements PxeFactory {
	private readonly nodeFactory: NodeFactory

	public constructor(nodeFactory?: NodeFactory) {
		this.nodeFactory = nodeFactory ?? new AztecNodeFactoryAdapter()
	}

	public async createChainRuntime(network: Network): Promise<ChainRuntime> {
		const node = this.nodeFactory.createNode(network.rpcUrl)
		const config = {
			...getPXEConfig(),
			dataDirectory: `pxe/${network.profileId}/${network.chainId}`,
			proverEnabled: true,
		} as PXEConfig
		// Pass an explicit WASMSimulator into both the prover AND the PXE
		// config so neither falls back to dynamic-import
		// `@aztec/simulator/client` at runtime. The dynamic-import fallback
		// (via the accelerator's `createLazySimulator`) fails under MV3
		// offscreen-document conditions even though the chunk is bundled,
		// throwing "No simulator provided and @aztec/simulator/client
		// could not be loaded." during `proveTx`. Static import makes the
		// simulator part of the main bundle graph and avoids that path.
		const simulator = new WASMSimulator()
		const prover = new AcceleratorProver({ simulator })
		const pxe = await createPXE(node, config, { proverOrOptions: prover, simulator })
		return new ChainRuntime(network.chainId, node, pxe, network.rpcUrl)
	}
}

/**
 * Per-(profileId, chainId) registry of `ChainRuntime` instances. Owns
 * the dedup-on-concurrent-init promise map so two callers asking for
 * the same chain at once share the init, not double-init.
 *
 * The registry is intended to be called from INSIDE the PxeService
 * ReadWriteGuard's read lock. Under that contract, `clear()` (called
 * from the write lock on profile switch / delete) never runs
 * concurrently with `getOrInit`, so there is no separate stale-init
 * race to handle here — the guard serializes it.
 */
export class ChainRuntimeRegistry {
	private readonly runtimes = new Map<string, ChainRuntime>()
	private readonly initPromises = new Map<string, Promise<ChainRuntime>>()

	public constructor(private readonly factory: PxeFactory) {}

	private key(profileId: string, chainId: number): string {
		return `${profileId}:${chainId}`
	}

	/** Returns the initialized runtime for `(profileId, chainId)` or
	 *  `undefined` if it hasn't been initialized yet. Never mutates
	 *  registry state. */
	public peek(profileId: string, chainId: number): ChainRuntime | undefined {
		return this.runtimes.get(this.key(profileId, chainId))
	}

	/** Lazy-init for `(network.profileId, network.chainId)`. Concurrent
	 *  callers share the same init promise. If the runtime exists but
	 *  its rpcUrl no longer matches (network re-bound), the existing
	 *  runtime is disposed and re-initialized under the new URL. */
	public async getOrInit(network: Network): Promise<ChainRuntime> {
		const k = this.key(network.profileId, network.chainId)
		const existing = this.runtimes.get(k)
		if (existing && existing.rpcUrl === network.rpcUrl) {
			return existing
		}
		if (existing && existing.rpcUrl !== network.rpcUrl) {
			this.runtimes.delete(k)
			await existing.dispose()
		}

		let promise = this.initPromises.get(k)
		if (!promise) {
			promise = this.factory
				.createChainRuntime(network)
				.then((runtime) => {
					this.runtimes.set(k, runtime)
					this.initPromises.delete(k)
					return runtime
				})
				.catch((err) => {
					this.initPromises.delete(k)
					throw err
				})
			this.initPromises.set(k, promise)
		}
		return promise
	}

	/** Dispose every runtime this registry owns. Must be called under
	 *  the PxeService write lock — otherwise concurrent reads may
	 *  observe a torn-down runtime. */
	public async clear(): Promise<void> {
		const runtimes = Array.from(this.runtimes.values())
		this.runtimes.clear()
		this.initPromises.clear()
		await Promise.all(runtimes.map((r) => r.dispose()))
	}
}

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/services/profile/encryption/encryption-key.ts && printf '\\n---PASSWORD BOX---\\n' && sed -n '1,220p' packages/extension/src/wallet/services/profile/password-secret-box.ts && printf '\\n---PASSKEY CRED---\\n' && sed -n '1,220p' packages/extension/src/wallet/services/passkey/credential.ts && printf '\\n---PASSKEY SPEC---\\n' && sed -n '1,220p' packages/extension/src/wallet/services/passkey/spec.ts" in (project root)
 succeeded in 0ms:
/** OWASP-recommended minimum for PBKDF2-SHA256 (2023). */
const PBKDF2_ITERATIONS = 600_000

/**
 * Provides functionality for password-based encryption and decryption.
 * Primarily used for encrypting secrets to be stored in the local storage.
 */
export class EncryptionKey {
	private constructor(private baseKey: CryptoKey) {}

	private deriveKey(salt: ArrayBuffer): Promise<CryptoKey> {
		return self.crypto.subtle.deriveKey(
			{
				name: "PBKDF2",
				salt,
				iterations: PBKDF2_ITERATIONS,
				hash: "SHA-256",
			},
			this.baseKey,
			{
				name: "AES-GCM",
				length: 256,
			},
			false,
			["encrypt", "decrypt"],
		)
	}

	/**
	 * Encrypts payload
	 * @param payload - Bytes to be encrypted
	 * @returns Encrypted bytes
	 */
	public async encrypt(payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
		const iv = self.crypto.getRandomValues(new Uint8Array(12))
		const salt = await self.crypto.subtle.digest("SHA-256", iv)
		const key = await this.deriveKey(salt)
		const buffer = await self.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload)

		const ct = new Uint8Array(buffer)
		const result = new Uint8Array(13 + ct.length)
		result.set([0], 0) // 1 byte version tag
		result.set(iv, 1) // 12 bytes initialization vector
		result.set(ct, 13) // ciphertext

		return result
	}

	/**
	 * Decrypts payload
	 * @param payload - Bytes to be decrypted
	 * @returns Decrypted bytes
	 */
	public async decrypt(payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
		if (payload.length < 13) {
			throw new Error("Invalid payload length")
		}
		if (payload[0] !== 0) {
			// version tag
			throw new Error("Invalid payload format")
		}
		const iv = payload.subarray(1, 13)
		const ct = payload.subarray(13, payload.length)

		const salt = await self.crypto.subtle.digest("SHA-256", iv)
		const key = await this.deriveKey(salt)
		const buffer = await self.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct)

		return new Uint8Array(buffer)
	}

	/**
	 * Creates EncryptionKey from user password
	 * @param password - User password
	 * @returns New instance of EncryptionKey
	 */
	public static async fromPassword(password: string): Promise<EncryptionKey> {
		const passhash = await EncryptionKey.getPasshash(password)
		return EncryptionKey.fromPasshash(passhash)
	}

	/**
	 * Creates EncryptionKey from user password hash
	 * @param passhash - Hash of the password
	 * @returns New instance of EncryptionKey
	 */
	public static async fromPasshash(passhash: ArrayBuffer): Promise<EncryptionKey> {
		const baseKey = await self.crypto.subtle.importKey("raw", passhash, "PBKDF2", false, ["deriveKey"])
		return new EncryptionKey(baseKey)
	}

	/**
	 * Calculates password hash
	 * @param password User password
	 * @returns Hash of the password
	 */
	public static async getPasshash(password: string): Promise<ArrayBuffer> {
		const utf8 = new TextEncoder()
		return await self.crypto.subtle.digest("SHA-256", utf8.encode(password))
	}

	/**
	 * Calculates SHA-256 hash of a string and returns hex
	 * @param input Any UTF-8 string
	 * @returns hex representation of the SHA-256 hash
	 */
	public static async getHashHex(input: string): Promise<string> {
		const encoder = new TextEncoder()
		const data = encoder.encode(input)
		const hashBuffer = await self.crypto.subtle.digest("SHA-256", data)
		const hashArray = new Uint8Array(hashBuffer)

		// Convert bytes to hex
		return [...hashArray].map((b) => b.toString(16).padStart(2, "0")).join("")
	}
}

---PASSWORD BOX---
/**
 * PasswordSecretBox — password-based encryption of the profile master secret.
 *
 * Extracted from ProfileService in M2.1-b. Pure class: no storage writes,
 * no session state, no passkeys, no locking. Wraps `EncryptionKey`
 * (PBKDF2 + AES-GCM) with the `ENCRYPTION_GUARD` round-trip check.
 *
 * ## Wrong-password semantics
 *
 * `unseal` / `unsealWithPasshash` / `reseal` **return `null`** when the
 * supplied credential can't decrypt the profile. They do NOT throw for
 * the wrong-password case. The facade is responsible for mapping
 * `null` into the specific per-callsite error the 31-method RPC
 * contract expects:
 *
 *   - `unlockProfile`           → `throw new InvalidPasswordError()`
 *   - `changeProfilePassword`   → `throw new Error("Invalid profile old password")`
 *   - `confirmProfileOperation` → `throw new InvalidPasswordError()`
 *                                 (then wrapped by the method's own
 *                                 catch block into a generic Error)
 *   - `exportPlain` (password)  → delegates to `confirmProfileOperation`
 *                                 above, which throws first
 *   - `exportMnemonic`          → `throw new Error("Invalid profile old password")`
 *   - `restorePasswordSession`  → silent close (SessionManager owns this)
 *
 * These strings / types are NOT compatibility-fluff; auth UI code
 * matches on `InvalidPasswordError` (`popup/pages/auth.vue:65-74`)
 * and the audit confirmed the error-shape differences are observable.
 *
 * ## Null vs throw
 *
 * Only wrong-password / corrupted-ciphertext failures return null.
 * Unexpected Web Crypto errors (e.g. `importKey` rejects the passhash
 * buffer as the wrong type, or the runtime has no subtle crypto)
 * propagate as thrown exceptions. Callers should not attempt to
 * distinguish those — they're system-level bugs, not user input.
 */

import type { ILogger } from "@/wallet/logger"
import { array_equals } from "@/wallet/utils"
import { EncryptionKey } from "./encryption/encryption-key"
import { ENCRYPTION_GUARD } from "./spec"

/** Encrypted form of the master secret as persisted on a Profile record.
 *
 *  Fields are base64-encoded. The encoding is FROZEN — the storage-layer
 *  tests and M2.6's V2 vector pin it, and every existing profile row on
 *  disk was written under this shape. Do not switch to hex / raw bytes
 *  without a migration. */
export type EncryptedProfileSecret = {
	/** Base64-encoded ciphertext of `ENCRYPTION_GUARD` under the key
	 *  derived from the profile password. On unseal this is decrypted
	 *  first and byte-compared to `ENCRYPTION_GUARD`; a mismatch means
	 *  the supplied password is wrong. */
	guard: string
	/** Base64-encoded ciphertext of the raw 32-byte master secret under
	 *  the same key as `guard`. */
	secret: string
}

/** Result of a successful `seal`. Returned to callers so they can persist
 *  `encrypted` on the `Profile` record and pass `passhash` into the
 *  SessionManager's `open` fast-path (avoiding a second PBKDF2). */
export type Sealed = {
	passhash: ArrayBuffer
	encrypted: EncryptedProfileSecret
}

export class PasswordSecretBox {
	public constructor(private readonly logger: ILogger) {}

	/** Encrypts `secret` under a key derived from `password`. Returns the
	 *  base64-encoded guard+secret pair for storage plus the passhash for
	 *  the immediate session-open. */
	public async seal(password: string, secret: Uint8Array<ArrayBuffer>): Promise<Sealed> {
		const passhash = await EncryptionKey.getPasshash(password)
		const key = await EncryptionKey.fromPasshash(passhash)
		const encrypted = await this.sealInternal(key, secret)
		return { passhash, encrypted }
	}

	/** Fast path for import flows where the caller already has a
	 *  passhash (e.g. `importEncrypted` derives the hash once and
	 *  re-uses it for both the decrypt-probe and the re-seal). */
	public async sealWithPasshash(passhash: ArrayBuffer, secret: Uint8Array<ArrayBuffer>): Promise<EncryptedProfileSecret> {
		const key = await EncryptionKey.fromPasshash(passhash)
		return this.sealInternal(key, secret)
	}

	/** Decrypts and returns the raw master secret, or `null` if the
	 *  password is wrong or the ciphertext is corrupted. */
	public async unseal(password: string, encrypted: EncryptedProfileSecret): Promise<Uint8Array<ArrayBuffer> | null> {
		const passhash = await EncryptionKey.getPasshash(password)
		const key = await EncryptionKey.fromPasshash(passhash)
		return this.unsealInternal(key, encrypted)
	}

	/** Fast path using a cached passhash. Used during session restore,
	 *  where PBKDF2 already ran on the initial unlock and the resulting
	 *  hash was persisted in the session record. */
	public async unsealWithPasshash(passhash: ArrayBuffer, encrypted: EncryptedProfileSecret): Promise<Uint8Array<ArrayBuffer> | null> {
		const key = await EncryptionKey.fromPasshash(passhash)
		return this.unsealInternal(key, encrypted)
	}

	/** Re-encrypts the master secret under a new password. Returns the
	 *  new encrypted blob + new passhash, or `null` if the old password
	 *  was wrong. Used by `changeProfilePassword`. */
	public async reseal(oldPassword: string, newPassword: string, encrypted: EncryptedProfileSecret): Promise<Sealed | null> {
		const oldPasshash = await EncryptionKey.getPasshash(oldPassword)
		const oldKey = await EncryptionKey.fromPasshash(oldPasshash)
		const secret = await this.unsealInternal(oldKey, encrypted)
		if (!secret) return null

		const newPasshash = await EncryptionKey.getPasshash(newPassword)
		const newKey = await EncryptionKey.fromPasshash(newPasshash)
		const newEncrypted = await this.sealInternal(newKey, secret)
		return { passhash: newPasshash, encrypted: newEncrypted }
	}

	/** Encrypt GUARD + secret under the given key. Shared between `seal`
	 *  and `reseal`. Returns the persistable base64 pair. */
	private async sealInternal(key: EncryptionKey, secret: Uint8Array<ArrayBuffer>): Promise<EncryptedProfileSecret> {
		const guard = await key.encrypt(ENCRYPTION_GUARD as Uint8Array<ArrayBuffer>)
		const encryptedSecret = await key.encrypt(secret)
		return {
			guard: Buffer.from(guard.buffer).toString("base64"),
			secret: Buffer.from(encryptedSecret.buffer).toString("base64"),
		}
	}

	/** Decrypt GUARD and verify; decrypt secret. Shared between `unseal`,
	 *  `unsealWithPasshash`, and `reseal`. Returns null on any
	 *  wrong-password / corrupted-ciphertext condition. */
	private async unsealInternal(key: EncryptionKey, encrypted: EncryptedProfileSecret): Promise<Uint8Array<ArrayBuffer> | null> {
		const guard = await this.tryDecrypt(key, Buffer.from(encrypted.guard, "base64") as Uint8Array<ArrayBuffer>)
		if (!guard || !array_equals(guard, ENCRYPTION_GUARD)) {
			return null
		}
		const secret = await this.tryDecrypt(key, Buffer.from(encrypted.secret, "base64") as Uint8Array<ArrayBuffer>)
		// At this point the GUARD decrypted cleanly, so the password IS
		// correct. A null here means the secret ciphertext is corrupted
		// (storage damage), which we still surface as null — the facade
		// maps it to "Profile storage corrupted" at the appropriate
		// callsite.
		return secret ?? null
	}

	/** Attempts to decrypt; returns undefined on any Web Crypto failure
	 *  (wrong key / bad tag / malformed payload). Matches the behavior
	 *  of the original `ProfileService.tryDecrypt` helper. */
	private async tryDecrypt(key: EncryptionKey, payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | undefined> {
		try {
			return await key.decrypt(payload)
		} catch {
			return undefined
		}
	}
}

---PASSKEY CRED---
import { Fr } from "@aztec/foundation/curves/bn254"
import type { PasskeyCredentialData } from "./spec"

const te = new TextEncoder()

// SECURITY: Domain separators in the key derivation chain. Changing these labels
// produces different keys and invalidates every existing passkey wallet.
const PASSKEY_KDF_LABEL = te.encode("nulo:kdf:v1")
const PASSKEY_MASTER_LABEL = te.encode("nulo:master:v1")

export class PasskeyCredential {
	public readonly id: string
	public readonly userHandle?: string
	private baseKey: CryptoKey
	private salt: ArrayBuffer

	private constructor(id: string, baseKey: CryptoKey, salt: ArrayBuffer, userHandle?: string) {
		this.id = id
		this.userHandle = userHandle
		this.baseKey = baseKey
		this.salt = salt
	}

	public static async create(params: PasskeyCredentialData): Promise<PasskeyCredential> {
		const ikm = Buffer.from(params.prf, "base64")
		const credential = Buffer.from(params.id, "base64")
		const saltInput = Buffer.concat([PASSKEY_KDF_LABEL, credential])
		const baseKey = await self.crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
		const salt = await self.crypto.subtle.digest("SHA-256", saltInput)
		return new PasskeyCredential(params.id, baseKey, salt, params.userHandle)
	}

	public async deriveMasterSecret(): Promise<Buffer<ArrayBuffer>> {
		const masterBits = await self.crypto.subtle.deriveBits(
			{ name: "HKDF", hash: "SHA-256", salt: this.salt, info: PASSKEY_MASTER_LABEL },
			this.baseKey,
			256,
		)
		const masterFr = Fr.fromBufferReduce(Buffer.from(new Uint8Array(masterBits)))
		return masterFr.toBuffer() as Buffer<ArrayBuffer>
	}
}

---PASSKEY SPEC---
export const PASSKEY_SERVICE_NAME = "passkey"
// SECURITY: Domain separator in the key derivation chain. Changing this label
// produces different keys and invalidates every existing passkey wallet.
export const PASSKEY_PRF_LABEL = "nulo:profile:v1"
export const PASSKEY_TIMEOUT = 60_000 * 3 // 3 minutes

export type PasskeyCredentialData = {
	id: string // base64
	prf: string // base64
	userHandle?: string // hex
}

export type PasskeyRequest =
	| {
			mode: "create"
			userHandle: string
	  }
	| {
			mode: "get"
			credentialId?: string
	  }

import type { PasskeyCredential } from "./credential"

export type PasskeyRequestPromise = {
	resolve: (r: PasskeyCredential) => void
	reject: (reason: string) => void
	request: PasskeyRequest
}

export type Methods = {
	/**
	 * Returns details for the pending request so the window can proceed.
	 * @param requestId Pending request identifier.
	 */
	getPendingRequest(requestId: string): PasskeyRequest

	/**
	 * Resolves a pending request, completing the promise.
	 * @param requestId Pending request identifier.
	 * @param result Credential data containing the credential id and PRF output (base64 strings).
	 */
	resolvePasskeyRequest(requestId: string, result: PasskeyCredentialData): void

	/**
	 * Rejects a pending request with a reason.
	 * @param requestId Pending request identifier.
	 * @param reason Human-readable reason for rejection.
	 */
	rejectPasskeyRequest(requestId: string, reason: string): void
}

exec
/bin/zsh -lc "sed -n '1,260p' packages/extension/src/wallet/services/passkey/service.ts" in (project root)
exec
/bin/zsh -lc 'rg -n "PASSKEY_PRF_LABEL|nulo:kdf:v1|nulo:master:v1|nulo:profile:v1|RP ID|rpId" packages/extension/src/wallet/services/passkey packages/extension/src/wallet/services/profile packages/extension/src/wallet/crypto -S' in (project root)
 succeeded in 0ms:
import type { ServiceSpec } from "@/wallet/base"
import { Service } from "@/wallet/base/background"
import type { ILogger } from "@/wallet/logger"
import { PASSKEY_SERVICE_NAME, type Methods, type PasskeyCredentialData, type PasskeyRequest } from "./spec"
import { PasskeyCredential } from "./credential"
import { getRandomHex } from "@/wallet/utils"
import type { WindowManager } from "@/wallet/services/window-manager/window-manager"

export * from "./spec"

/**
 * Hard timeout for a passkey popup. Bounds the worst case when neither the
 * user interacts nor `chrome.windows.onRemoved` fires (eg. extension reload,
 * popup crash, MV3 suspension races). 5 minutes is ample for WebAuthn UX.
 */
const PASSKEY_TIMEOUT_MS = 5 * 60 * 1000

type PendingPasskey = {
	request: PasskeyRequest
	handleId: string
}

export class PasskeyService extends Service<Methods> implements ServiceSpec<Methods> {
	public static name = PASSKEY_SERVICE_NAME

	private pending: Map<string, PendingPasskey> = new Map()

	public constructor(
		logger: ILogger,
		private readonly windowManager: WindowManager,
	) {
		super(PASSKEY_SERVICE_NAME, logger)
	}

	public async createKey(userHandle: string): Promise<PasskeyCredential> {
		return await this.openWindowAndWait({ mode: "create", userHandle })
	}

	public async getKey(credentialId?: string): Promise<PasskeyCredential> {
		return await this.openWindowAndWait({ mode: "get", credentialId })
	}

	public async getPendingRequest(requestId: string): Promise<PasskeyRequest> {
		const entry = this.pending.get(requestId)
		if (!entry) throw new Error("Invalid request id")
		return entry.request
	}

	public async resolvePasskeyRequest(requestId: string, result: PasskeyCredentialData): Promise<void> {
		const entry = this.pending.get(requestId)
		if (!entry) throw new Error("Invalid request id")
		this.pending.delete(requestId)
		const credential = await PasskeyCredential.create(result)
		this.logDebug("Passkey request resolved: ", credential.id)
		// Detach before settling: passkey popup closes after the user completes
		// the WebAuthn gesture; the onRemoved event can race with settle.
		this.windowManager.detach(entry.handleId)
		this.windowManager.settle(entry.handleId, credential)
	}

	public async rejectPasskeyRequest(requestId: string, reason: string): Promise<void> {
		const entry = this.pending.get(requestId)
		if (!entry) throw new Error("Invalid request id")
		this.pending.delete(requestId)
		this.logInfo("Passkey request rejected: ", reason)
		this.windowManager.cancel(entry.handleId, reason)
	}

	private async openWindowAndWait(request: PasskeyRequest): Promise<PasskeyCredential> {
		let id: string
		do {
			id = getRandomHex(8)
		} while (this.pending.has(id))

		const handle = this.windowManager.openAndAwait<PasskeyCredential>({
			url: chrome.runtime.getURL(`src/popup/index.html#/windows/passkey?requestId=${id}`),
			width: 500,
			height: 800,
			timeoutMs: PASSKEY_TIMEOUT_MS,
			kind: "passkey",
		})

		this.pending.set(id, { request, handleId: handle.handleId })

		return handle.promise.finally(() => {
			this.pending.delete(id)
		})
	}
}

 succeeded in 0ms:
packages/extension/src/wallet/crypto/key-vectors.test.ts:70:import { PASSKEY_PRF_LABEL } from "@/wallet/services/passkey/spec"
packages/extension/src/wallet/crypto/key-vectors.test.ts:176:	// ── V8: PASSKEY_PRF_LABEL spec constant ──────────────────────────
packages/extension/src/wallet/crypto/key-vectors.test.ts:183:	test("V8 — PASSKEY_PRF_LABEL is 'nulo:profile:v1'", () => {
packages/extension/src/wallet/crypto/key-vectors.test.ts:184:		expect(PASSKEY_PRF_LABEL).toBe("nulo:profile:v1")
packages/extension/src/wallet/services/passkey/spec.ts:4:export const PASSKEY_PRF_LABEL = "nulo:profile:v1"
packages/extension/src/wallet/services/passkey/credential.ts:8:const PASSKEY_KDF_LABEL = te.encode("nulo:kdf:v1")
packages/extension/src/wallet/services/passkey/credential.ts:9:const PASSKEY_MASTER_LABEL = te.encode("nulo:master:v1")

exec
/bin/zsh -lc "sed -n '1,260p' packages/extension/src/wallet/crypto/key-vectors.test.ts" in (project root)
 succeeded in 0ms:
/**
 * Cryptographic derivation test vectors — M2.6.
 *
 * Purpose
 * -------
 * Lock the cryptographic derivation invariants used to
 *   (a) encrypt the profile master secret at rest (`EncryptionKey`),
 *   (b) derive a passkey-wallet master secret from WebAuthn PRF +
 *       credentialId (`PasskeyCredential`),
 *   (c) derive the per-account signing key from that master secret
 *       (`deriveSigningKey` via `@aztec/stdlib/keys`).
 *
 * Any accidental drift during M2.1's ProfileService split — or a silent
 * upstream change in `@aztec/foundation` or `@aztec/stdlib` — fails one
 * of these tests before it locks every existing wallet on disk.
 *
 * On upgrading `@aztec/*` — the ritual
 * ------------------------------------
 * Some vectors are Aztec-stack sensitive: V3 (`Fr.fromBufferReduce`),
 * V7a (`deriveSigningKey` = sha512-to-grumpkin-scalar + domain
 * separator). When you bump `@aztec/foundation`, `@aztec/stdlib`, or
 * `@aztec/accounts`:
 *
 *   1. Run `bun run test`.
 *   2. If any vector in this file fails, **do not blindly regenerate**.
 *   3. Classify each failure:
 *        (a) Neutral wrap / rename — upstream just moved the code.
 *            Confirm the underlying math is equivalent (independent
 *            recomputation or published reference). Then regenerate
 *            the fixture constant in this file and commit with
 *            "chore(crypto): regenerate fixtures for @aztec X.Y.Z —
 *            verified equivalent".
 *        (b) Backward-compatible primitive optimization — output bytes
 *            are identical. Test shouldn't fail; if it did, investigate
 *            why (endianness, serialization-order change).
 *        (c) Breaking derivation change — output bytes differ for the
 *            same inputs. **Stop and think.** This means existing
 *            wallets will derive different keys and brick. Pin the old
 *            version until a migration exists, or write the migration.
 *            V7a is the canary for this class — if it fails, the
 *            signing key of every wallet on disk just changed.
 *   4. Document the decision in the commit message.
 *
 * Aztec-independent vectors (V1, V2, V6, V8, V9, P1) survive any
 * `@aztec/*` bump — they exercise Web Crypto or constants only.
 *
 * Break-it-to-prove-it
 * --------------------
 * Each vector was validated by temporarily breaking the constant it
 * pins and confirming the test fails. See the per-vector header
 * comment for what's locked.
 *
 * Deferred vectors (see M2.6 plan notes)
 * --------------------------------------
 * V4 (poseidon2Hash account secret), V7b (NuloAccount.address), V10
 * (passkey → address full chain), and P2 (Barretenberg Poseidon2
 * cross-check) all require `@aztec/bb.js` WASM poseidon2, which
 * crashes in the vitest jsdom environment with
 * `BBApiException: std::bad_cast` on the WASM boundary. These belong
 * in an e2e-level fixture or a slow-test suite that spawns BB for
 * real. Tracked as a follow-up; unit-level locks V1-V9 still catch
 * the bulk of regressions M2.1 could introduce.
 */

import { describe, expect, test } from "vitest"
import { Fr } from "@aztec/foundation/curves/bn254"
import { deriveSigningKey } from "@aztec/stdlib/keys"
import { EncryptionKey } from "@/wallet/services/profile/encryption/encryption-key"
import { PasskeyCredential } from "@/wallet/services/passkey/credential"
import { PASSKEY_PRF_LABEL } from "@/wallet/services/passkey/spec"
import { AccountType } from "@/wallet/services/account/spec"

/** Reusable hex helper — keeps fixture constants readable. */
const toHex = (buf: ArrayBuffer | Uint8Array) => {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}
const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)))

describe("M2.6 — cryptographic derivation vectors", () => {
	// ── V1: password hash ────────────────────────────────────────────
	//
	// Locks: SHA-256(UTF-8(password)). Platform Web Crypto, no Aztec dep.
	// Break it: change `getPasshash` from SHA-256 to SHA-384, this fails.
	test("V1 — getPasshash('hunter2') matches fixture", async () => {
		const passhash = await EncryptionKey.getPasshash("hunter2")
		expect(toHex(passhash)).toBe("f52fbd32b2b3b86ff88ef6c490628285f482af15ddcb29541f94bcf526a3f6c7")
	})

	// ── V2: AES-GCM round-trip with fixed IV ─────────────────────────
	//
	// Locks: PBKDF2-SHA256 at 600_000 iterations, salt = SHA-256(iv),
	// AES-GCM-256, 13-byte prefix [version][iv].
	// The committed ciphertext was captured by running the current
	// encrypt() with the same password, plaintext, and IV. Two
	// assertions hold it in place:
	//   (a) decrypt(COMMITTED_CIPHERTEXT) === PLAINTEXT (verifies the
	//       full decrypt chain against a real stored value), and
	//   (b) encrypt(PLAINTEXT, mocked IV) === COMMITTED_CIPHERTEXT
	//       (verifies encrypt's prefix assembly + AES tag emission).
	// Break it: change PBKDF2_ITERATIONS — both assertions fail.
	const V2_PASSWORD = "hunter2"
	const V2_PLAINTEXT_HEX = "deadbeefcafebabe0011223344556677"
	const V2_IV_HEX = "aaaaaaaaaaaaaaaaaaaaaaaa" // 12 bytes of 0xAA
	const V2_CIPHERTEXT_HEX = "00aaaaaaaaaaaaaaaaaaaaaaaabbf9b797c51cbfaff2e2be5c04eee5303a5eac28711a196e271c960d5ab16a49"

	test("V2a — decrypt(COMMITTED_CIPHERTEXT, password) === PLAINTEXT", async () => {
		const key = await EncryptionKey.fromPassword(V2_PASSWORD)
		const plaintext = await key.decrypt(fromHex(V2_CIPHERTEXT_HEX))
		expect(toHex(plaintext)).toBe(V2_PLAINTEXT_HEX)
	}, 10_000)

	test("V2b — encrypt(PLAINTEXT, mocked IV) === COMMITTED_CIPHERTEXT", async () => {
		const originalGRV = self.crypto.getRandomValues.bind(self.crypto)
		const iv = fromHex(V2_IV_HEX)
		// biome-ignore lint/suspicious/noExplicitAny: narrow mock with explicit restore in finally
		const grv = self.crypto.getRandomValues as any
		self.crypto.getRandomValues = ((target: Uint8Array) => {
			target.set(iv.slice(0, target.length))
			return target
		}) as typeof self.crypto.getRandomValues
		try {
			const key = await EncryptionKey.fromPassword(V2_PASSWORD)
			const ct = await key.encrypt(fromHex(V2_PLAINTEXT_HEX))
			expect(toHex(ct)).toBe(V2_CIPHERTEXT_HEX)
		} finally {
			self.crypto.getRandomValues = originalGRV
			void grv
		}
	}, 10_000)

	// ── V3: passkey master-secret derivation ─────────────────────────
	//
	// Locks: HKDF-SHA256, salt = SHA-256(PASSKEY_KDF_LABEL || credentialId),
	// info = PASSKEY_MASTER_LABEL, 256 output bits reduced through
	// Fr.fromBufferReduce (big-endian, mod BN254 Fr modulus).
	// AZTEC-SENSITIVE: depends on Fr.fromBufferReduce semantics.
	// Break it: change PASSKEY_KDF_LABEL — fails.
	// Input PRF is 32 clean bytes base64-encoded; credentialId is a
	// short base64 identifier mimicking a real WebAuthn credential.
	const V3_PRF_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
	const V3_CREDENTIAL_ID_B64 = "dGVzdC1jcmVkZW50aWFsLWlk"

	test("V3 — PasskeyCredential master secret matches fixture", async () => {
		const credential = await PasskeyCredential.create({ id: V3_CREDENTIAL_ID_B64, prf: V3_PRF_B64 })
		const master = await credential.deriveMasterSecret()
		expect(toHex(master)).toBe("2db78e1a82bbf002bd36281f079f797fe194ee2b04249df6e44efb30e879919a")
	})

	// ── V6: getHashHex (backup checksum) ─────────────────────────────
	//
	// Used by ImportPopup + export/full.vue to verify backup integrity.
	// If byte→hex encoding drifts (case change, TextEncoder swap,
	// SHA-256 substitution), backup import silently fails.
	// Platform Web Crypto, no Aztec dep.
	test("V6 — getHashHex('hunter2') matches fixture", async () => {
		const hex = await EncryptionKey.getHashHex("hunter2")
		expect(hex).toBe("f52fbd32b2b3b86ff88ef6c490628285f482af15ddcb29541f94bcf526a3f6c7")
	})

	// ── V7a: deriveSigningKey(secret) ────────────────────────────────
	//
	// The signing key is what actually signs transactions. This is the
	// primary canary for upstream drift: `deriveSigningKey` resolves to
	// `sha512ToGrumpkinScalar([secret, DomainSeparator.IVSK_M])`.
	// Upstream has a TODO to replace IVSK_M with a dedicated signing
	// separator (AztecProtocol/aztec-packages#5837). When that lands,
	// this vector fails loudly — that's the signal to migrate.
	// AZTEC-SENSITIVE.
	test("V7a — deriveSigningKey(fixedSecret) matches fixture", () => {
		const secret = Fr.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000042")
		const signingKey = deriveSigningKey(secret)
		expect(signingKey.toString()).toBe("0x14a31cb4d33a144675e70634830292153f78e8318e51f26a2f212783eb0a3cbc")
	})

	// ── V8: PASSKEY_PRF_LABEL spec constant ──────────────────────────
	//
	// This label is passed to `navigator.credentials.get` as the PRF
	// eval info. Changing it detaches PRF output from every existing
	// passkey wallet — same severity as changing PASSKEY_KDF_LABEL,
	// but V3 starts AFTER the WebAuthn call, so label drift in the
	// call site alone wouldn't trip V3.
	test("V8 — PASSKEY_PRF_LABEL is 'nulo:profile:v1'", () => {
		expect(PASSKEY_PRF_LABEL).toBe("nulo:profile:v1")
	})

	// ── V9: AccountType.Nulo_v1 numeric value ────────────────────────
	//
	// The enum value feeds into poseidon2Hash([master, chainId, type,
	// index]) as the 3rd arg. Flipping Nulo_v1 from 0 to 1 changes
	// every derived account secret. The spec.ts file has a
	// "NEVER change it" SECURITY comment but a paranoid unit lock
	// catches a drive-by refactor before it breaks wallets.
	test("V9 — AccountType.Nulo_v1 === 0", () => {
		expect(AccountType.Nulo_v1).toBe(0)
	})

	// ── P1: HKDF-SHA256 RFC 5869 Appendix A.1 ────────────────────────
	//
	// Cross-checks the platform HKDF implementation against a
	// canonical external reference, independent of our labels or
	// input shapes. If V3 fails AND P1 passes, the bug is in our
	// label/input construction. If both fail, the platform HKDF
	// changed (upgrade browser / Node).
	test("P1 — HKDF-SHA256 RFC 5869 A.1 matches", async () => {
		const ikm = fromHex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b")
		const salt = fromHex("000102030405060708090a0b0c")
		const info = fromHex("f0f1f2f3f4f5f6f7f8f9")
		const expected = "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"

		const baseKey = await self.crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
		const bits = await self.crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, baseKey, 42 * 8)
		expect(toHex(bits)).toBe(expected)
	})
})

exec
/bin/zsh -lc 'rg -n "''^import .*@/wallet/base|''^import .*@/wallet/utils|''^import .*@/core/ports|''^import .*@/wallet/logger|''^import .*@/wallet/services|''^import .*zod" packages/extension/src/wallet/services/profile/encryption/encryption-key.ts packages/extension/src/wallet/services/profile/password-secret-box.ts packages/extension/src/wallet/services/passkey/credential.ts packages/extension/src/wallet/crypto/key-vectors.test.ts -S' in (project root)
 succeeded in 0ms:
packages/extension/src/wallet/crypto/key-vectors.test.ts:68:import { EncryptionKey } from "@/wallet/services/profile/encryption/encryption-key"
packages/extension/src/wallet/crypto/key-vectors.test.ts:69:import { PasskeyCredential } from "@/wallet/services/passkey/credential"
packages/extension/src/wallet/crypto/key-vectors.test.ts:70:import { PASSKEY_PRF_LABEL } from "@/wallet/services/passkey/spec"
packages/extension/src/wallet/crypto/key-vectors.test.ts:71:import { AccountType } from "@/wallet/services/account/spec"
packages/extension/src/wallet/services/profile/password-secret-box.ts:39:import type { ILogger } from "@/wallet/logger"
packages/extension/src/wallet/services/profile/password-secret-box.ts:40:import { array_equals } from "@/wallet/utils"

exec
/bin/zsh -lc "rg -n \"from \\\"@/wallet/base/offscreen\\\"|from \\\"@/wallet/base/background\\\"|from \\\"@/wallet/base/messages\\\"|from \\\"@/wallet/base/errors\\\"|from \\\"@/wallet/base/zod-helpers\\\"|from \\\"zod\\\"|from 'zod'\" packages/extension/src/wallet/services/pxe packages/extension/src/wallet/services/network packages/extension/src/wallet/services/operation-journal packages/extension/src/wallet/services/wallet-sdk packages/extension/src/wallet/services/rpc packages/extension/src/wallet/services/account -S" in (project root)
 succeeded in 0ms:
packages/extension/src/wallet/services/account/service.ts:5:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/account/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/pxe/service.ts:25:import z from "zod"
packages/extension/src/wallet/services/pxe/service.ts:29:import { Service } from "@/wallet/base/offscreen"
packages/extension/src/wallet/services/operation-journal/service.ts:3:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/operation-journal/service.ts:4:import { validateParams } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/network/service.ts:3:import { Service } from "@/wallet/base/background"
packages/extension/src/wallet/services/network/service.ts:4:import { validateParams } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/operation-journal/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/operation-journal/client.ts:3:import { validateParams, validateResult } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/operation-journal/spec.ts:14:import { z } from "zod"
packages/extension/src/wallet/services/network/client.ts:2:import { ServiceClient } from "@/wallet/base/background"
packages/extension/src/wallet/services/network/client.ts:3:import { validateParams, validateResult } from "@/wallet/base/zod-helpers"
packages/extension/src/wallet/services/pxe/client.ts:17:import z from "zod"
packages/extension/src/wallet/services/pxe/client.ts:21:import { ServiceClient } from "@/wallet/base/offscreen"
packages/extension/src/wallet/services/network/spec.ts:1:import { z } from "zod"
packages/extension/src/wallet/services/operation-journal/service.test.ts:11:import { ValidationError } from "@/wallet/base/errors"

exec
/bin/zsh -lc 'rg -n "@/wallet/services/profile/encryption/encryption-key|@/wallet/services/profile/password-secret-box|@/wallet/services/passkey/credential|PASSKEY_PRF_LABEL|@/wallet/services/passkey/spec" packages/extension/src -S' in (project root)
 succeeded in 0ms:
packages/extension/src/popup/windows/passkey/index.vue:13:import { PASSKEY_PRF_LABEL, type PasskeyCredentialData, type PasskeyRequest, PASSKEY_TIMEOUT } from "@/wallet/services/passkey/spec"
packages/extension/src/popup/windows/passkey/index.vue:31:	const prfInput = await crypto.subtle.digest("SHA-256", te.encode(PASSKEY_PRF_LABEL))
packages/extension/src/popup/windows/passkey/index.vue:84:	const prfInput = await crypto.subtle.digest("SHA-256", te.encode(PASSKEY_PRF_LABEL))
packages/extension/src/wallet/services/passkey/spec.ts:4:export const PASSKEY_PRF_LABEL = "nulo:profile:v1"
packages/extension/src/wallet/crypto/key-vectors.test.ts:68:import { EncryptionKey } from "@/wallet/services/profile/encryption/encryption-key"
packages/extension/src/wallet/crypto/key-vectors.test.ts:69:import { PasskeyCredential } from "@/wallet/services/passkey/credential"
packages/extension/src/wallet/crypto/key-vectors.test.ts:70:import { PASSKEY_PRF_LABEL } from "@/wallet/services/passkey/spec"
packages/extension/src/wallet/crypto/key-vectors.test.ts:176:	// ── V8: PASSKEY_PRF_LABEL spec constant ──────────────────────────
packages/extension/src/wallet/crypto/key-vectors.test.ts:183:	test("V8 — PASSKEY_PRF_LABEL is 'nulo:profile:v1'", () => {
packages/extension/src/wallet/crypto/key-vectors.test.ts:184:		expect(PASSKEY_PRF_LABEL).toBe("nulo:profile:v1")
packages/extension/src/wallet/services/profile/passkey-recovery-coordinator.test.ts:12:import type { PasskeyCredential } from "@/wallet/services/passkey/credential"
packages/extension/src/wallet/services/profile/service.integration.test.ts:25:import type { PasskeyCredential } from "@/wallet/services/passkey/credential"
packages/extension/src/popup/components/popups/ImportPopup.vue:15:import { EncryptionKey } from "@/wallet/services/profile/encryption/encryption-key"
packages/extension/src/popup/pages/settings/security/export/full.vue:25:import { EncryptionKey } from "@/wallet/services/profile/encryption/encryption-key"

codex
I’ve found a few plan drift points beyond the explicit questions: some “UI primitives” already depend on service clients, and the passkey constants are not arranged the way M3.2 assumes. I’m checking those dependencies now so I can separate blockers from just plan cleanups.
exec
/bin/zsh -lc 'rg -n "@/assets|@assets|@/wallet/services|ConfigServiceClient|LogViewerServiceClient|TaskServiceClient" packages/extension/src/components packages/extension/src/components/ui packages/extension/src/popup/components -S' in (project root)
 succeeded in 0ms:
packages/extension/src/components/Header.vue:4:import { LogViewerServiceClient } from "@/wallet/services/log-viewer/client"
packages/extension/src/components/Header.vue:5:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/components/Header.vue:6:import { TaskServiceClient } from "@/wallet/services/task/client"
packages/extension/src/components/Header.vue:27:const logViewerService = new LogViewerServiceClient()
packages/extension/src/components/Header.vue:30:const configService = new ConfigServiceClient()
packages/extension/src/components/Header.vue:48:const taskService = new TaskServiceClient()
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:12:import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:13:import { ExecutionServiceClient } from "@/wallet/services/execution/client"
packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:14:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/components/core/Icon.vue:4:import icons from "@/assets/icons.json"
packages/extension/src/popup/components/modules/activity/TransactionCard.vue:6:import { OriginType, TxStatus, TxExecutionResult } from "@/wallet/services/transaction/client"
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:13:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:14:import { LogViewerServiceClient } from "@/wallet/services/log-viewer/client"
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:27:const logViewerService = new LogViewerServiceClient()
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:30:const configService = new ConfigServiceClient()
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue:6:import { ExecutionServiceClient } from "@/wallet/services/execution/client"
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue:7:import { TransactionServiceClient } from "@/wallet/services/transaction/client"
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue:8:import { NuloFeePaymentMethod } from "@/wallet/services/account/contracts"
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue:9:import { TxStatus } from "@/wallet/services/transaction/spec"
packages/extension/src/popup/components/modules/general/BalanceView.vue:12:import { ContentKind } from "@/wallet/services/task/spec"
packages/extension/src/popup/components/modules/general/BalanceView.vue:13:import { TaskServiceClient } from "@/wallet/services/task/client"
packages/extension/src/popup/components/modules/general/BalanceView.vue:14:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/modules/general/BalanceView.vue:15:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/modules/general/BalanceView.vue:123:const taskService = new TaskServiceClient()
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:13:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:14:import { LogViewerServiceClient } from "@/wallet/services/log-viewer/client"
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:27:const logViewerService = new LogViewerServiceClient()
packages/extension/src/components/ui/JsonViewer/LogsViewer.vue:30:const configService = new ConfigServiceClient()
packages/extension/src/popup/components/modules/general/TokensView.vue:7:import { ContentKind } from "@/wallet/services/task/spec"
packages/extension/src/popup/components/modules/general/TokensView.vue:8:import { TaskServiceClient } from "@/wallet/services/task/client"
packages/extension/src/popup/components/modules/general/TokensView.vue:9:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/modules/general/TokensView.vue:45:const taskService = new TaskServiceClient()
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:10:import { OperationJournalServiceClient } from "@/wallet/services/operation-journal/client"
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:11:import { TaskServiceClient } from "@/wallet/services/task/client"
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:12:import { ContentKind, TaskStatus } from "@/wallet/services/task/spec"
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:13:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:14:import { OriginType, TxStatus } from "@/wallet/services/transaction/spec"
packages/extension/src/popup/components/modules/general/RecentActivityView.vue:101:const taskService = new TaskServiceClient()
packages/extension/src/components/ui/Popup/PopupCard.vue:4:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/components/ui/Popup/PopupCard.vue:16:const configService = new ConfigServiceClient()
packages/extension/src/components/ui/Popup/PopupCard.vue:4:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/components/ui/Popup/PopupCard.vue:16:const configService = new ConfigServiceClient()
packages/extension/src/popup/components/popups/EditTokenPopup.vue:6:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/EditTokenPopup.vue:7:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/popups/NewSenderPopup.vue:5:import { AccountStateServiceClient } from "@/wallet/services/account-state/client"
packages/extension/src/popup/components/popups/AccountsPopup.vue:3:import { AccountType } from "@/wallet/services/account/client"
packages/extension/src/popup/components/popups/RevokeAuthwitsPopup.vue:6:import { AuthRegistryServiceClient, MAX_REVOKES_PER_TX } from "@/wallet/services/auth-registry/client"
packages/extension/src/popup/components/popups/TokenMetadataPopup.vue:3:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/popups/EditProfilePopup.vue:3:import { ProfileServiceClient } from "@/wallet/services/profile/client"
packages/extension/src/popup/components/popups/SelectTokenPopup.vue:3:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/popups/StealthPromoPopup.vue:6:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/popup/components/popups/StealthPromoPopup.vue:12:const configService = new ConfigServiceClient()
packages/extension/src/popup/components/popups/ImportPopup.vue:4:import { AccountServiceClient } from "@/wallet/services/account/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:5:import { AccountStateServiceClient } from "@/wallet/services/account-state/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:6:import { AuthRegistryServiceClient } from "@/wallet/services/auth-registry/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:7:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:8:import { ContactServiceClient } from "@/wallet/services/contact/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:9:import { FpcServiceClient } from "@/wallet/services/fpc/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:10:import { NetworkServiceClient } from "@/wallet/services/network/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:11:import { ProfileServiceClient } from "@/wallet/services/profile/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:12:import { TokenServiceClient } from "@/wallet/services/token/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:13:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:14:import { TransactionServiceClient } from "@/wallet/services/transaction/client"
packages/extension/src/popup/components/popups/ImportPopup.vue:15:import { EncryptionKey } from "@/wallet/services/profile/encryption/encryption-key"
packages/extension/src/popup/components/popups/ImportPopup.vue:530:			new ConfigServiceClient(),
packages/extension/src/popup/components/popups/RegisterPopup/RegisterPopup.vue:9:import { AccountServiceClient } from "@/wallet/services/account/client"
packages/extension/src/popup/components/popups/RegisterPopup/RegisterPopup.vue:10:import { ConfigServiceClient } from "@/wallet/services/config/client"
packages/extension/src/popup/components/popups/RegisterPopup/RegisterPopup.vue:21:const configService = new ConfigServiceClient()
packages/extension/src/popup/components/popups/ImportContactsPopup.vue:3:import { ContactServiceClient } from "@/wallet/services/contact/client"
packages/extension/src/popup/components/popups/EditFpcPopup.vue:3:import { FpcServiceClient } from "@/wallet/services/fpc/client"
packages/extension/src/popup/components/popups/SelectBalanceTypePopup.vue:3:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/ChangeAuthwitsRegistryPopup.vue:6:import { AuthRegistryServiceClient } from "@/wallet/services/auth-registry/client"
packages/extension/src/popup/components/popups/NewAccountPopup.vue:3:import { AccountType } from "@/wallet/services/account/client"
packages/extension/src/popup/components/popups/ChangeProfilePasswordPopup.vue:3:import { ProfileServiceClient } from "@/wallet/services/profile/client"
packages/extension/src/popup/components/popups/NewFpcPopup.vue:9:import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"
packages/extension/src/popup/components/popups/NewFpcPopup.vue:10:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/SelectFpcPopup.vue:3:import { FpcServiceClient, FpcType } from "@/wallet/services/fpc/client"
packages/extension/src/popup/components/popups/SelectFpcPopup.vue:4:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/SelectProfilePopup.vue:6:import { ProfileServiceClient } from "@/wallet/services/profile/client"
packages/extension/src/popup/components/popups/NewContactPopup.vue:6:import { ContactServiceClient } from "@/wallet/services/contact/client"
packages/extension/src/popup/components/popups/EditContactPopup.vue:6:import { ContactServiceClient } from "@/wallet/services/contact/client"
packages/extension/src/popup/components/popups/NewTokenPopup/NewTokenPopup.vue:6:import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
packages/extension/src/popup/components/popups/NewTokenPopup/NewTokenPopup.vue:7:import { TokenServiceClient } from "@/wallet/services/token/client"

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/components/ui/Popup/PopupCard.vue && printf '\\n---\\n' && sed -n '1,220p' packages/extension/src/components/ui/JsonViewer/LogsViewer.vue && printf '\\n---\\n' && sed -n '1,220p' packages/extension/src/components/Header.vue && printf '\\n---\\n' && sed -n '1,180p' packages/extension/src/components/core/Icon.vue" in (project root)
 succeeded in 0ms:
<script setup>
/** Utils */
import { Config } from "@/wallet/config"
import { ConfigServiceClient } from "@/wallet/services/config/client"

const props = defineProps({
	large: {
		type: Boolean,
		default: false,
	},
	displaceIdx: {
		type: Number,
	},
})

const configService = new ConfigServiceClient()
configService.onUpdate.add(onSettingUpdate)

const showFullscreen = ref(new Config().showPopupFullscreen)

function onSettingUpdate(setting) {
	if (setting.key === "showPopupFullscreen") {
		showFullscreen.value = setting.value
	}
}

onMounted(async () => {
	showFullscreen.value = await configService.getValue("showPopupFullscreen")
	if (window.innerHeight > 600) {
		showFullscreen.value = true
	}
})

onBeforeUnmount(() => {
	configService.disconnect()
})
</script>

<template>
	<Flex
		align="center"
		direction="column"
		:class="[$style.wrapper, large && $style.large, displaceIdx > 1 && $style.displace]"
		:style="{
			'--displace': displaceIdx - 1,
			flex: showFullscreen ? '10' : null,
		}"
	>
		<div @click="showFullscreen = !showFullscreen" :class="$style.handle_zone">
			<div :class="$style.bar" />
		</div>

		<Flex direction="column" gap="16" wide :style="{ minHeight: 0 }">
			<slot />
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	overflow: auto;

	background: var(--nulo-surface);
	border-top: 2px solid var(--nulo-accent);

	transition: all 0.2s var(--bezier);

	&.large {
		flex: 10;
	}

	&.displace {
		transform: translateY(15px);
	}

	&::-webkit-scrollbar {
		display: none;
	}
}

.handle_zone {
	display: flex;
	align-items: center;
	justify-content: center;

	width: 100%;
	padding: 10px 0 14px 0;

	cursor: pointer;
}

.bar {
	width: 40px;
	height: 3px;

	background: var(--nulo-outline);

	transition: background 0.2s var(--bezier);
}

.handle_zone:hover .bar {
	background: var(--nulo-secondary);
}

.handle_zone:active .bar {
	background: var(--nulo-accent);
}
</style>

---
<script setup>
/** Vendor */
import { onMounted, ref } from "vue"
import { EditorView } from "codemirror"
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state"
import { keymap, highlightActiveLine, Decoration } from "@codemirror/view"
import { defaultKeymap } from "@codemirror/commands"
import { searchKeymap } from "@codemirror/search"

/** Utils */
import { Config } from "@/wallet/config"
import { LogLevel } from "@/wallet/logger"
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { LogViewerServiceClient } from "@/wallet/services/log-viewer/client"
import { capitalize, downloadFile } from "@/utils"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Services */
import { createLoggerTheme } from "./creator.js"

const editorRef = ref(null)
let view = null

const logViewerService = new LogViewerServiceClient()
logViewerService.onLog.add(onLogAdded)

const configService = new ConfigServiceClient()
configService.onUpdate.add(onSettingUpdate)

const logs = ref([])

function getLogLevelName(level) {
	switch (level) {
		case LogLevel.Debug:
			return "DEBUG"
		case LogLevel.Info:
			return "INFO"
		case LogLevel.Warn:
			return "WARN"
		case LogLevel.Error:
			return "ERROR"
		default:
			return level
	}
}

const sources = [
	"account",
	"account-state",
	"auth-registry",
	"config",
	"contact",
	"dapp-interaction",
	"dapp-session",
	"execution",
	"faucet",
	"fpc",
	"log-viewer",
	"logger",
	"network",
	"note",
	"profile",
	"pxe",
	"rpc",
	"task",
	"token",
	"token-balance",
	"transaction",
	"wallet-sdk",
	"passkey",
]
	.flatMap((x) => [x, `${x}-client`])
	.concat(["wallet", "ui"])
const allowedSources = computed(() => new Set(Object.keys(filters.source).filter((k) => filters.source[k])))
const levels = ["DEBUG", "INFO", "WARN", "ERROR"]
const allowedLevels = computed(
	() =>
		new Set(
			Object.keys(filters.level)
				.filter((k) => filters.level[k])
				.map((l) => getLogLevelName(l)),
		),
)
const allOptionsSelected = computed(() => {
	return {
		source: allowedSources.value?.size === sources.length,
		level: allowedLevels.value?.size === levels.length,
	}
})

const filteredLogs = computed(() => logs.value.filter((log) => isLogInclude(log)))

const AUTO_SCROLL_TIMEOUT_MS = 30_000
const SCROLL_DISABLE_THRESHOLD = 20
const MAX_LOGS_DIFF = 100
const maxLogsCount = ref(new Config().debugMode ? 10_000 : 1_000)

const shouldAutoScroll = ref(true)
const showScrollBtn = ref(false)
let scrollTimeout = null

const popovers = reactive({
	source: false,
	level: false,
})
const filters = reactive({
	source: Object.fromEntries(sources.map((b) => [b, true])),
	level: Object.fromEntries(levels.map((b) => [b, true])),
})
const searchTerm = ref("")

const handleOpenPopover = (name) => {
	popovers[name] = true
}
const onPopoverClose = (name) => {
	popovers[name] = false
	if (name === "source") {
		searchTerm.value = ""
	}
}
function updateFilter(filter, value) {
	filters[filter][value] = !filters[filter][value]
	updateEditorContent()
}
function handleSelectAll(filter) {
	const value = allOptionsSelected.value[filter]
	for (const f of Object.keys(filters[filter])) {
		filters[filter][f] = !value
	}
	updateEditorContent()
}
function isLogInclude(log) {
	const sourceOk = allowedSources.value.has(log.source)
	const levelOk = allowedLevels.value.has(getLogLevelName(log.level))

	return sourceOk && levelOk
}
function getDisplayName(kind, value) {
	switch (kind) {
		case "source":
			if (value === "undefined") return `(${value})`

			return value
				.split("-")
				.map((v) => {
					if (v === "fpc" || v === "pxe" || v === "rpc") return v.toUpperCase()

					return capitalize(v)
				})
				.join(" ")
		default:
			return capitalize(value.toLowerCase())
	}
}

function onLogAdded(log) {
	logs.value.push(log)

	if (logs.value.length > maxLogsCount.value + MAX_LOGS_DIFF) {
		logs.value.splice(0, MAX_LOGS_DIFF)
	}

	if (!isLogInclude(log)) return

	if (view) {
		const doc = view.state.doc

		if (filteredLogs.value.length > maxLogsCount.value + MAX_LOGS_DIFF) {
			view.dispatch({
				changes: {
					from: doc.line(1).from,
					to: doc.line(MAX_LOGS_DIFF).to + 1,
					insert: "",
				},
			})
		}

		const newLine = `${formatSingleLog(log)}\n`
		view.dispatch({
			changes: {
				from: doc.length,
				insert: newLine,
			},
		})

		if (shouldAutoScroll.value) {
			scrollToBottom()
		} else {
			showScrollBtn.value = true
		}
	}
}

function enableAutoScroll() {
	clearTimeout(scrollTimeout)
	shouldAutoScroll.value = true
}
function disableAutoScroll() {
	clearTimeout(scrollTimeout)
	shouldAutoScroll.value = false

	scrollTimeout = setTimeout(() => {
		shouldAutoScroll.value = true
	}, AUTO_SCROLL_TIMEOUT_MS)
}
function updateShouldAutoScroll() {
	const el = view?.scrollDOM
	if (!el) return

	const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_DISABLE_THRESHOLD

	if (isAtBottom) {
		showScrollBtn.value = false
		enableAutoScroll()
	} else {
		showScrollBtn.value = true
		disableAutoScroll()

---
<script setup>
import { Config } from "@/wallet/config"
import { LogLevel } from "@/wallet/logger"
import { LogViewerServiceClient } from "@/wallet/services/log-viewer/client"
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { TaskServiceClient } from "@/wallet/services/task/client"

/** Utils */
import { managers } from "@/utils/core"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const route = useRoute()

const handleLockWallet = () => {
	if (!appStore.isLogined) return
	appStore.isLogined = false
	managers.profile.lockActiveProfile()
}

const logViewerService = new LogViewerServiceClient()
logViewerService.onLog.add(onLogAdded)

const configService = new ConfigServiceClient()
configService.onUpdate.add(onSettingUpdate)

const defaultConfig = new Config()
const indicateFailures = ref(defaultConfig.indicateFailures)
const showNode = ref(defaultConfig.showNode)
const stealthMode = ref(defaultConfig.stealthMode)

const HEADER_INDICATION_DURATION = 5_000
let headerIndicateFailureTimer = null
let headerIndicateTaskTimer = null

const MENU_INDICATION_DURATION = 60_000
let menuIndicateFailureTimer = null
let menuIndicateTaskTimer = null

const tasks = ref([])
const activeTasksCount = ref(0)
const taskService = new TaskServiceClient()
taskService.onTaskCreated.add(onTaskCreated)
taskService.onTaskUpdated.add(onTaskUpdated)
taskService.onTaskDeleted.add(processTask)
async function onTaskCreated(task) {
	if (task.parentId) return

	tasks.value.push(task)
}
function processTask(task) {
	const idx = tasks.value.findIndex((t) => t.id === task.id)
	if (idx !== -1) {
		tasks.value.splice(idx, 1)
	}
}
function onTaskUpdated(task) {
	if (!task.finishedAt || task.parentId) return

	processTask(task)
}

const currentFailureType = ref("")
const highlightColor = computed(() => {
	if (currentFailureType.value === "error") {
		return "var(--red)"
	} else if (currentFailureType.value === "warning") {
		return "var(--yellow)"
	} else if (activeTasksCount.value) {
		return "" // "var(--green)"
	} else {
		return ""
	}
})

function handleWalletFailure(type, logId) {
	currentFailureType.value = type

	// Header
	if (headerIndicateFailureTimer) {
		clearTimeout(headerIndicateFailureTimer)
		headerIndicateFailureTimer = null
	}

	headerIndicateFailureTimer = setTimeout(() => {
		currentFailureType.value = ""
		activeTasksCount.value = tasks.value?.length || 0
		cacheStore.activeTasksCount = activeTasksCount.value
		headerIndicateFailureTimer = null
	}, HEADER_INDICATION_DURATION)

	// Menu
	if (menuIndicateFailureTimer) {
		clearTimeout(menuIndicateFailureTimer)
		menuIndicateFailureTimer = null
	}
	cacheStore.failureLog = {
		id: logId,
		color: highlightColor.value,
	}

	menuIndicateFailureTimer = setTimeout(() => {
		cacheStore.failureLog = null
		menuIndicateFailureTimer = null
	}, MENU_INDICATION_DURATION)
}

function onLogAdded(log) {
	switch (log.level) {
		case LogLevel.Warn:
			handleWalletFailure("warning", log.id)
			break
		case LogLevel.Error:
			handleWalletFailure("error", log.id)
			break

		default:
			break
	}
}

function onSettingUpdate(setting) {
	switch (setting.key) {
		case "indicateFailures":
			indicateFailures.value = setting.value
			break
		case "showNode":
			showNode.value = setting.value
			break
		case "stealthMode":
			stealthMode.value = setting.value
			break

		default:
			break
	}
}

const handleOpenPopup = (target) => {
	if (!appStore.isLogined) return
	popupStore.open(target)
}

watch(
	() => indicateFailures.value,
	() => {
		if (!indicateFailures.value) {
			logViewerService.disconnect()
		} else {
			logViewerService.connect()
		}
	},
)
watch(
	() => tasks.value?.length,
	(newValue) => {
		if (!newValue) {
			if (headerIndicateTaskTimer) {
				clearTimeout(headerIndicateTaskTimer)
				headerIndicateTaskTimer = null
			}

			headerIndicateTaskTimer = setTimeout(() => {
				activeTasksCount.value = 0
				headerIndicateTaskTimer = null
			}, HEADER_INDICATION_DURATION)

			menuIndicateTaskTimer = setTimeout(() => {
				cacheStore.activeTasksCount = null
				menuIndicateTaskTimer = null
			}, MENU_INDICATION_DURATION)

			return
		}

		if (menuIndicateTaskTimer) {
			clearTimeout(menuIndicateTaskTimer)
			menuIndicateTaskTimer = null
		}

		activeTasksCount.value = newValue
		cacheStore.activeTasksCount = newValue
	},
)

onMounted(async () => {
	indicateFailures.value = await configService.getValue("indicateFailures")
	showNode.value = await configService.getValue("showNode")
	stealthMode.value = await configService.getValue("stealthMode")

	tasks.value = (await taskService.getTasks()).filter((t) => !t.parentId && !t.finishedAt)
	activeTasksCount.value = tasks.value?.length

	if (indicateFailures.value) {
		logViewerService.connect()
	}
})

onBeforeUnmount(() => {
	configService.disconnect()
	logViewerService.disconnect()
	taskService.disconnect()
})
</script>

<template>
	<header v-if="!appStore._isHomeScreenOpened && route.name !== 'popup-auth'" :class="$style.wrapper">
		<button
			v-if="appStore.isLogined"
			type="button"
			@click="handleOpenPopup('accounts')"
			data-testid="account-selector"
			aria-label="Switch account"
			:class="$style.account_chip"

---
<script setup>
import { computed } from "vue"

import icons from "@/assets/icons.json"

const props = defineProps({
	name: { type: String, required: true, default: "warning" },
	size: { type: [String, Number], default: "16" },
	color: { type: String, default: null },
	hoverColor: { type: String, required: false },
	rotate: { type: [String, Number], default: 0 },
	fill: { type: Boolean, default: false },
	scale: { type: [String, Number], default: 1 },
	loading: { type: Boolean, default: false },
})

const styles = computed(() => {
	const s = {
		minWidth: `${props.size}px`,
		minHeight: `${props.size}px`,
		transformBox: "view-box",
		transformOrigin: "center center",
		transform: "",
	}

	const ops = []
	if (props.rotate) ops.push(`rotate(${props.rotate}deg)`)
	if (props.scale !== 1) ops.push(`scale(${props.scale})`)
	if (ops.length) s.transform = ops.join(" ")

	return s
})

const classes = computed(() => {
	const iconClasses = []

	if (props.color) iconClasses.push(`fill--${props.color}`)

	return iconClasses
})

const hoverColorVar = computed(() => {
	return `var(--txt-${props.hoverColor})`
})

const getIcon = () => {
	return icons[props.name.charAt(0).toLowerCase() + props.name.slice(1)]
}

const isSplitted = () => {
	return typeof icons[props.name.charAt(0).toLowerCase() + props.name.slice(1)] === "object"
}
</script>

<template>
	<svg
		viewBox="0 0 24 24"
		:width="size"
		:height="size"
		:style="styles"
		:class="[...classes, props.hoverColor && $style.hovered, loading && $style.loading]"
		role="img"
	>
		<path v-if="!isSplitted(name)" :d="getIcon(name)" />
		<template v-else>
			<path v-if="!Array.isArray(getIcon(name))" :d="getIcon(name)" :style="{ opacity: path.opacity }" />

			<template v-else>
				<path
					v-for="(icon, i) in getIcon(name)"
					:key="i"
					:d="icon.path"
					:style="{
						opacity: fill ? 1 : icon.opacity,
						fill: icon.color && icon.color,
					}"
				/>
			</template>
		</template>
	</svg>
</template>

<style module>
.hovered {
	transition: all 0.3s var(--bezier);

	&:hover {
		fill: v-bind(hoverColorVar);
	}
}

.loading {
	animation: skeleton 1s ease-in-out infinite;
}

@keyframes skeleton {
	0% {
		opacity: 1;
	}

	50% {
		opacity: 0.5;
	}

	100% {
		opacity: 1;
	}
}
</style>

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/tests/vitest.setup.ts" in (project root)
 succeeded in 0ms:
import { afterEach, beforeEach, type Mock, vi } from "vitest"

// The wallet logger prints via `console._<level>` (see
// src/wallet/logger/utils.ts). Those aliases are installed by
// src/utils/console-sniffer at SW / popup boot; unit tests don't import that
// module, so without this shim any test that triggers a logWarn/logError
// path explodes with "console._warn is not a function".
// biome-ignore lint/suspicious/noExplicitAny: runtime global augmentation for test shim
const _console = console as any
for (const method of ["trace", "debug", "log", "info", "warn", "error"] as const) {
	if (typeof _console[`_${method}`] !== "function") {
		_console[`_${method}`] = _console[method].bind(_console)
	}
}

export const emitPortMessage = (service: string, message: unknown) => {
	const listeners = portMessageListeners.get(service)
	if (listeners) {
		for (const listener of listeners) {
			listener(message)
		}
	}
}

export const capturePortMessage = (service: string) => {
	const fnMock = sendPortMessageMocks.get(service)
	if (!fnMock) {
		throw new Error(`Port for '${service}' hasn't been mocked`)
	}
	return fnMock
}

export const emitMessage = (message: unknown) => {
	for (const listener of messageListeners) {
		listener(message)
	}
}

export const captureMessage = () => {
	return sendMessageMock
}

type Fn = (...args: unknown[]) => void

const portMessageListeners = new Map<string, Fn[]>()
const sendPortMessageMocks = new Map<string, Mock<Fn>>()
const messageListeners: Fn[] = []
const sendMessageMock = vi.fn()

const mockPort = (service: string) => {
	if (sendPortMessageMocks.has(service)) {
		throw new Error(`Port for '${service}' has already been mocked`)
	}

	const postMessageMock = vi.fn()
	sendPortMessageMocks.set(service, postMessageMock)

	return {
		disconnect: vi.fn(),
		onMessage: {
			addListener: (listener: Fn) => {
				let listeners = portMessageListeners.get(service)
				if (!listeners) {
					listeners = []
					portMessageListeners.set(service, listeners)
				}
				listeners.push(listener)
			},
			removeListener: (listener: Fn) => {
				const listeners = portMessageListeners.get(service)
				if (listeners) {
					for (let i = listeners.length - 1; i >= 0; i--) {
						if (listeners[i] === listener) {
							listeners.splice(i, 1)
						}
					}
				}
			},
		},
		onDisconnect: {
			addListener: vi.fn(),
			removeListener: vi.fn(),
		},
		postMessage: postMessageMock,
	}
}

beforeEach(() => {
	vi.stubGlobal("chrome", {
		storage: {},
		runtime: {
			connect: vi.fn().mockImplementation((_, { name }) => mockPort(name)),
			getContexts: vi.fn(),
			getURL: vi.fn(),
			onConnect: {
				addListener: vi.fn(),
				removeListener: vi.fn(),
			},
			onMessage: {
				addListener: (listener: Fn) => {
					messageListeners.push(listener)
				},
				removeListener: (listener: Fn) => {
					for (let i = messageListeners.length - 1; i >= 0; i--) {
						if (messageListeners[i] === listener) {
							messageListeners.splice(i, 1)
						}
					}
				},
			},
			sendMessage: sendMessageMock,
		},
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
	portMessageListeners.clear()
	sendPortMessageMocks.clear()
	messageListeners.splice(0)
	sendMessageMock.mockClear()
})

exec
/bin/zsh -lc "rg -n \"abstracts/variables|variables|@use \\\"abstracts|@use 'abstracts|@use \\\"@/assets/styles|@use '@/assets/styles|@import \\\"@/assets/styles|@use \\\"\\./|@use \\\"\\.\\./\" packages/extension/src/components packages/extension/src/popup/components packages/extension/src/assets/styles -S" in (project root)
 succeeded in 0ms:
packages/extension/src/assets/styles/_base.scss:1:@use "./flex" as *;
packages/extension/src/assets/styles/_base.scss:2:@use "./text" as *;

exec
/bin/zsh -lc "if [ -d packages/extension/node_modules ]; then rg -n \"dirs:|globs:|fast-glob|tinyglobby|resolveDirs|resolver|root\" packages/extension/node_modules/unplugin-auto-import packages/extension/node_modules/unplugin-vue-components packages/extension/node_modules/@crxjs/vite-plugin -S; else echo 'no ext node_modules'; fi" in (project root)
 succeeded in 0ms:
packages/extension/node_modules/unplugin-vue-components/package.json:24:    "./resolvers": {
packages/extension/node_modules/unplugin-vue-components/package.json:25:      "import": "./dist/resolvers.js",
packages/extension/node_modules/unplugin-vue-components/package.json:26:      "require": "./dist/resolvers.cjs"
packages/extension/node_modules/unplugin-vue-components/package.json:93:    "tinyglobby": "^0.2.15",
packages/extension/node_modules/unplugin-auto-import/package.json:122:    "fast-glob": "^3.3.3",
packages/extension/node_modules/unplugin-vue-components/README.md:15:- 🌈 [Built-in resolvers](#importing-from-ui-libraries) for popular UI libraries.
packages/extension/node_modules/unplugin-vue-components/README.md:261:We have several built-in resolvers for popular UI libraries like **Vuetify**, **Ant Design Vue**, and **Element Plus**, where you can enable them by:
packages/extension/node_modules/unplugin-vue-components/README.md:265:- [Ant Design Vue](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/antdv.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:266:- [Arco Design Vue](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/arco.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:267:- [BootstrapVue](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/bootstrap-vue.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:268:- [Element Plus](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/element-plus.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:269:- [Element UI](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/element-ui.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:270:- [Headless UI](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/headless-ui.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:271:- [IDux](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/idux.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:272:- [Inkline](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/inkline.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:273:- [Ionic](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/ionic.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:274:- [Naive UI](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/naive-ui.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:275:- [Prime Vue](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/prime-vue.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:276:- [Quasar](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/quasar.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:277:- [TDesign](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/tdesign.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:278:  - [`@tdesign-vue-next/auto-import-resolver`](https://github.com/Tencent/tdesign-vue-next/blob/develop/packages/auto-import-resolver/README.md) - TDesign's own auto-import resolver
packages/extension/node_modules/unplugin-vue-components/README.md:279:- [Vant](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/vant.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:280:  - [`@vant/auto-import-resolver`](https://github.com/youzan/vant/blob/main/packages/vant-auto-import-resolver/README.md) - Vant's own auto-import resolver
packages/extension/node_modules/unplugin-vue-components/README.md:281:- [Varlet UI](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/varlet-ui.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:282:  - [`@varlet/import-resolver`](https://github.com/varletjs/varlet/blob/dev/packages/varlet-import-resolver/README.md) - Varlet's own auto-import resolver
packages/extension/node_modules/unplugin-vue-components/README.md:283:- [VEUI](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/veui.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:284:- [View UI](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/view-ui.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:285:- [Vuetify](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/vuetify.ts) &mdash; Prefer first-party plugins when possible: [v3 + vite](https://www.npmjs.com/package/vite-plugin-vuetify), [v3 + webpack](https://www.npmjs.com/package/webpack-plugin-vuetify), [v2 + webpack](https://npmjs.com/package/vuetify-loader)
packages/extension/node_modules/unplugin-vue-components/README.md:286:- [VueUse Components](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/vueuse.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:287:- [VueUse Directives](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/vueuse-directive.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:288:- [Dev UI](https://github.com/antfu/unplugin-vue-components/blob/main/src/core/resolvers/devui.ts)
packages/extension/node_modules/unplugin-vue-components/README.md:295:} from 'unplugin-vue-components/resolvers'
packages/extension/node_modules/unplugin-vue-components/README.md:301:  resolvers: [
packages/extension/node_modules/unplugin-vue-components/README.md:309:You can also write your own resolver quickly:
packages/extension/node_modules/unplugin-vue-components/README.md:313:  resolvers: [
packages/extension/node_modules/unplugin-vue-components/README.md:324:> [We no longer accept new resolvers](./src/core/resolvers/_READ_BEFORE_CONTRIBUTE.md).
packages/extension/node_modules/unplugin-vue-components/README.md:371:+ import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
packages/extension/node_modules/unplugin-vue-components/README.md:379:      // `customComponentsResolvers` has renamed to `resolver`
packages/extension/node_modules/unplugin-vue-components/README.md:381:+     resolvers: [
packages/extension/node_modules/unplugin-vue-components/README.md:404:  dirs: ['src/components'],
packages/extension/node_modules/unplugin-vue-components/README.md:413:  globs: ['src/components/*.vue'],
packages/extension/node_modules/unplugin-vue-components/README.md:418:  // resolvers for custom components
packages/extension/node_modules/unplugin-vue-components/README.md:419:  resolvers: [],
packages/extension/node_modules/unplugin-auto-import/README.md:301:  dirs: [
packages/extension/node_modules/unplugin-auto-import/README.md:303:    './composables', // only root modules
packages/extension/node_modules/unplugin-auto-import/README.md:350:  // Custom resolvers, compatible with `unplugin-vue-components`
packages/extension/node_modules/unplugin-auto-import/README.md:352:  resolvers: [
packages/extension/node_modules/unplugin-auto-import/README.md:481:From v0.8.0, `unplugin-auto-import` **uses** `unimport` underneath. `unimport` is designed to be a lower-level tool (it also powered Nuxt's auto import). You can think `unplugin-auto-import` is a wrapper of it that provides more user-friendly config APIs and capabilities like resolvers. Development of new features will mostly happen in `unimport` from now.
packages/extension/node_modules/@crxjs/vite-plugin/package.json:62:    "fast-glob": "^3.2.11",

exec
/bin/zsh -lc "find . -maxdepth 4 -type d \\( -name node_modules -o -name .bun \\) | sed -n '1,120p'" in (project root)
 succeeded in 0ms:
./node_modules
./node_modules/.bun
./node_modules/.bun/node-gyp-build@4.8.4/node_modules
./node_modules/.bun/arrify@2.0.1/node_modules
./node_modules/.bun/w3c-xmlserializer@5.0.0/node_modules
./node_modules/.bun/json-bigint@1.0.0/node_modules
./node_modules/.bun/css-what@6.2.2/node_modules
./node_modules/.bun/@aztec+simulator@4.2.0-nightly.20260413/node_modules
./node_modules/.bun/extract-zip@2.0.1/node_modules
./node_modules/.bun/form-data@4.0.5/node_modules
./node_modules/.bun/is-extglob@2.1.1/node_modules
./node_modules/.bun/compressible@2.0.18/node_modules
./node_modules/.bun/@vue+babel-plugin-jsx@1.5.0+b097dd6c05d04ee2/node_modules
./node_modules/.bun/@protobufjs+utf8@1.1.0/node_modules
./node_modules/.bun/crypto-browserify@3.12.1/node_modules
./node_modules/.bun/isows@1.0.7+4dd1b26dcc5f1664/node_modules
./node_modules/.bun/@google-cloud+storage@7.19.0/node_modules
./node_modules/.bun/@types+caseless@0.12.5/node_modules
./node_modules/.bun/lodash.times@4.3.2/node_modules
./node_modules/.bun/supports-color@7.2.0/node_modules
./node_modules/.bun/accepts@1.3.8/node_modules
./node_modules/.bun/builtin-status-codes@3.0.0/node_modules
./node_modules/.bun/execa@7.2.0/node_modules
./node_modules/.bun/webextension-polyfill@0.9.0/node_modules
./node_modules/.bun/bare-url@2.4.0/node_modules
./node_modules/.bun/@babel+plugin-syntax-typescript@7.28.6+b097dd6c05d04ee2/node_modules
./node_modules/.bun/@commitlint+parse@20.5.0/node_modules
./node_modules/.bun/@koa+cors@5.0.0/node_modules
./node_modules/.bun/qs@6.15.1/node_modules
./node_modules/.bun/@vue+compiler-core@3.5.32/node_modules
./node_modules/.bun/get-caller-file@2.0.5/node_modules
./node_modules/.bun/@types+request@2.48.13/node_modules
./node_modules/.bun/@aws+lambda-invoke-store@0.2.4/node_modules
./node_modules/.bun/json-parse-even-better-errors@2.3.1/node_modules
./node_modules/.bun/@aztec+accounts@4.2.0-nightly.20260413/node_modules
./node_modules/.bun/braces@3.0.3/node_modules
./node_modules/.bun/bn.js@4.12.3/node_modules
./node_modules/.bun/unplugin-utils@0.3.1/node_modules
./node_modules/.bun/@aztec+wallet-sdk@4.2.0-nightly.20260413/node_modules
./node_modules/.bun/@volar+language-core@2.4.28/node_modules
./node_modules/.bun/reduce-flatten@2.0.0/node_modules
./node_modules/.bun/is-nan@1.3.2/node_modules
./node_modules/.bun/pg-connection-string@2.12.0/node_modules
./node_modules/.bun/@replit+codemirror-indentation-markers@6.5.3+eb92dd1fe0360a2e/node_modules
./node_modules/.bun/@aztec+entrypoints@4.2.0-aztecnr-rc.2/node_modules
./node_modules/.bun/@aztec+noir-noirc_abi@4.2.0-aztecnr-rc.2/node_modules
./node_modules/.bun/idb@8.0.3/node_modules
./node_modules/.bun/@aztec+foundation@4.2.0-aztecnr-rc.2/node_modules
./node_modules/.bun/@webcomponents+custom-elements@1.6.0/node_modules
./node_modules/.bun/loupe@3.2.1/node_modules
./node_modules/.bun/@smithy+signature-v4@5.3.13/node_modules
./node_modules/.bun/@babel+plugin-syntax-jsx@7.28.6+b097dd6c05d04ee2/node_modules
./node_modules/.bun/ohash@2.0.11/node_modules
./node_modules/.bun/is-glob@4.0.3/node_modules
./node_modules/.bun/sass@1.99.0/node_modules
./node_modules/.bun/lodash.clonedeep@4.5.0/node_modules
./node_modules/.bun/pino-std-serializers@7.1.0/node_modules
./node_modules/.bun/@vue+devtools-core@8.1.1+e48bb9ca21a36da3/node_modules
./node_modules/.bun/es-object-atoms@1.1.1/node_modules
./node_modules/.bun/@protobufjs+float@1.0.2/node_modules
./node_modules/.bun/@commitlint+message@20.4.3/node_modules
./node_modules/.bun/teeny-request@9.0.0/node_modules
./node_modules/.bun/pathval@2.0.1/node_modules
./node_modules/.bun/@smithy+querystring-parser@4.2.13/node_modules
./node_modules/.bun/yauzl@2.10.0/node_modules
./node_modules/.bun/domain-browser@4.22.0/node_modules
./node_modules/.bun/math-intrinsics@1.1.0/node_modules
./node_modules/.bun/@babel+plugin-syntax-import-meta@7.10.4+b097dd6c05d04ee2/node_modules
./node_modules/.bun/js-tokens@9.0.1/node_modules
./node_modules/.bun/pac-resolver@7.0.1/node_modules
./node_modules/.bun/@msgpackr-extract+msgpackr-extract-darwin-arm64@3.0.3/node_modules
./node_modules/.bun/@aws-crypto+sha1-browser@5.2.0/node_modules
./node_modules/.bun/cosmiconfig@9.0.1/node_modules
./node_modules/.bun/side-channel-list@1.0.1/node_modules
./node_modules/.bun/@vue+shared@3.5.32/node_modules
./node_modules/.bun/@aztec+constants@4.2.0-aztecnr-rc.2/node_modules
./node_modules/.bun/@rollup+pluginutils@5.3.0/node_modules
./node_modules/.bun/@webext-core+fake-browser@1.3.4/node_modules
./node_modules/.bun/get-stream@6.0.1/node_modules
./node_modules/.bun/@nodelib+fs.walk@1.2.8/node_modules
./node_modules/.bun/@vitest+spy@3.2.4/node_modules
./node_modules/.bun/@aztec+key-store@4.2.0-nightly.20260413/node_modules
./node_modules/.bun/gensync@1.0.0-beta.2/node_modules
./node_modules/.bun/@smithy+node-http-handler@4.5.2/node_modules
./node_modules/.bun/semver@6.3.1/node_modules
./node_modules/.bun/@babel+helper-validator-identifier@7.28.5/node_modules
./node_modules/.bun/setimmediate@1.0.5/node_modules
./node_modules/.bun/vary@1.1.2/node_modules
./node_modules/.bun/@smithy+is-array-buffer@2.2.0/node_modules
./node_modules/.bun/@aztec+constants@4.2.0-nightly.20260413/node_modules
./node_modules/.bun/@opentelemetry+api@1.9.1/node_modules
./node_modules/.bun/pkg-dir@5.0.0/node_modules
./node_modules/.bun/@opentelemetry+sdk-metrics@1.30.1+e40b0dfdd726a224/node_modules
./node_modules/.bun/@commitlint+execute-rule@20.0.0/node_modules
./node_modules/.bun/entities@6.0.1/node_modules
./node_modules/.bun/command-line-usage@6.1.3/node_modules
./node_modules/.bun/sonic-boom@4.2.1/node_modules
./node_modules/.bun/fd-slicer@1.1.0/node_modules
./node_modules/.bun/define-data-property@1.1.4/node_modules
./node_modules/.bun/has-flag@3.0.0/node_modules
./node_modules/.bun/@vitest+runner@3.2.4/node_modules
./node_modules/.bun/@babel+types@7.29.0/node_modules
./node_modules/.bun/@aztec+telemetry-client@4.2.0-nightly.20260413/node_modules
./node_modules/.bun/browserify-aes@1.2.0/node_modules
./node_modules/.bun/text-decoder@1.2.7/node_modules
./node_modules/.bun/import-meta-resolve@4.2.0/node_modules
./node_modules/.bun/@aztec+foundation@4.2.0-nightly.20260413/node_modules
./node_modules/.bun/@scure+bip39@1.6.0/node_modules
./node_modules/.bun/@adraffy+ens-normalize@1.11.1/node_modules
./node_modules/.bun/postgres-date@1.0.7/node_modules
./node_modules/.bun/@babel+code-frame@7.29.0/node_modules
./node_modules/.bun/command-line-args@5.2.1/node_modules
./node_modules/.bun/@babel+helper-globals@7.28.0/node_modules
./node_modules/.bun/@parcel+watcher@2.5.6/node_modules
./node_modules/.bun/entities@7.0.1/node_modules
./node_modules/.bun/js-yaml@4.1.1/node_modules
./node_modules/.bun/balanced-match@4.0.4/node_modules
./node_modules/.bun/proxy-agent@6.5.0/node_modules
./node_modules/.bun/@types+deep-eql@4.0.2/node_modules
./node_modules/.bun/@aztec+stdlib@4.2.0-nightly.20260413/node_modules

exec
/bin/zsh -lc "ls -la | sed -n '1,120p' && printf '\\n---LOCKFILES---\\n' && ls -la bun.lock* package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null" in (project root)
 exited 2 in 0ms:
total 548
drwxr-xr-x 26 alejoamiras staff    832 Apr 22 19:14 .
drwxr-xr-x  6 alejoamiras staff    192 Apr 22 12:37 ..
-rw-r--r--  1 alejoamiras staff   6148 Apr 11 21:46 .DS_Store
drwxr-xr-x  3 alejoamiras staff     96 Apr 20 21:51 .claude
-rw-r--r--  1 alejoamiras staff     51 Apr  8 09:56 .commitlintrc.json
-rw-r--r--  1 alejoamiras staff    145 Apr  8 09:56 .editorconfig
drwxr-xr-x 16 alejoamiras staff    512 Apr 23 14:05 .git
-rw-r--r--  1 alejoamiras staff     77 Apr  7 21:36 .git-blame-ignore-revs
-rw-r--r--  1 alejoamiras staff     92 Apr  8 10:17 .gitattributes
drwxr-xr-x  4 alejoamiras staff    128 Apr 11 18:14 .githooks
-rw-r--r--  1 alejoamiras staff    442 Apr 20 16:09 .gitignore
-rw-r--r--  1 alejoamiras staff    371 Feb 28 12:59 .prettierrc
-rw-r--r--  1 alejoamiras staff   9571 Apr 15 20:06 AUDIT.md
-rw-r--r--  1 alejoamiras staff  10924 Apr 20 21:53 CLAUDE.md
-rw-r--r--  1 alejoamiras staff    892 Apr 15 20:06 LICENSE.md
-rw-r--r--  1 alejoamiras staff    339 Apr 15 20:06 README.md
-rw-r--r--  1 alejoamiras staff   6828 Apr 21 09:56 SECURITY.md
drwxr-xr-x  7 alejoamiras staff    224 Apr 20 22:00 architecture
-rw-r--r--  1 alejoamiras staff   1704 Apr 20 16:09 biome.json
-rwxr-xr-x  1 alejoamiras staff 474304 Apr 22 19:14 bun.lockb
drwxr-xr-x  4 alejoamiras staff    128 Apr 23 15:02 implementations-plan
drwxr-xr-x  8 alejoamiras staff    256 Apr 21 16:55 node_modules
-rw-r--r--  1 alejoamiras staff   1274 Apr 21 17:17 package.json
drwxr-xr-x  5 alejoamiras staff    160 Apr 20 16:09 packages
drwxr-xr-x  3 alejoamiras staff     96 Apr 21 17:17 patches
-rw-r--r--  1 alejoamiras staff    144 Apr 20 16:09 tsconfig.json

---LOCKFILES---
-rwxr-xr-x 1 alejoamiras staff 474304 Apr 22 19:14 bun.lockb

exec
/bin/zsh -lc "sed -n '1,240p' packages/extension/node_modules/@crxjs/vite-plugin/README.md" in (project root)
exec
/bin/zsh -lc 'rg -n "rollupOptions|input:|html|manifest|content scripts|background|pages|offscreen|web_accessible_resources" packages/extension/node_modules/@crxjs/vite-plugin -S' in (project root)
exec
/bin/zsh -lc "sed -n '396,430p' packages/extension/node_modules/unplugin-vue-components/README.md && printf '\\n---\\n' && sed -n '296,330p' packages/extension/node_modules/unplugin-auto-import/README.md" in (project root)
 succeeded in 0ms:
![CRXJS](./banner-github.png)

<h1 align="center">CRXJS</h1>

<p align="center">
Modern Chrome extension development with built-in <code>HMR</code> and <code>zero-config</code> setup
</p>

<p align="center">
<a href="https://www.npmjs.com/package/@crxjs/vite-plugin">
<img src="https://img.shields.io/npm/v/@crxjs/vite-plugin?color=298cd6&amp;label=CRXJS&labelColor=f2bae4" alt="NPM version">
</a>
</p>

<h2 align="center">
<a href="https://crxjs.dev/vite-plugin">📚 Documentation</a> |
<a href="https://discord.gg/5yHKEa9v">💬 Discord </a>
</h2>


## 📦 Create CRXJS Project
```shell
npm create crxjs@latest
``` 

> [!IMPORTANT]
> `@latest` MUST NOT be omitted, otherwise `npm` may resolve to a cached and outdated version of the package.

## ✨ Features

- 🧩 **Full Vite Plugin Ecosystem** - Leverage any Vite-compatible plugins with zero extra setup  
- ⚙️ **Zero Configuration** - Start developing immediately with intelligent defaults  
- 3️⃣ **Manifest V3 Support** - Built for modern Chrome extensions with enhanced security  
- 🔥 **True Hot Module Replacement** - Instant UI updates while preserving extension state 🎈**works with content scripts**
- 📁 **Static Asset Import** - Directly reference images/fonts in your code
- 🤖 **Auto Web-Accessible Resources** - Automatic generation of `web_accessible_resources` manifest entries  

> [!NOTE]  
> Looking for MV2 support? See [`rollup-plugin`](packages/rollup-plugin/README.md)  

## 💝 Contributors

This project exists thanks to all the people who contribute.

And thank you to all our backers! 🙏

<a href="https://github.com/crxjs/chrome-extension-tools/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=crxjs/chrome-extension-tools" />
</a>

## 🤝 Supporting

If these plugins have helped you ship your product faster, please consider
[sponsoring me](https://github.com/sponsors/jacksteamdev) on GitHub.

 succeeded in 0ms:
packages/extension/node_modules/@crxjs/vite-plugin/manifest.schema.json:2:  "$id": "https://extend-chrome.dev/manifest.schema.json",
packages/extension/node_modules/@crxjs/vite-plugin/manifest.schema.json:6:      "manifest_version": { "type": "number", "enum": [2] }
packages/extension/node_modules/@crxjs/vite-plugin/manifest.schema.json:10:    "$ref": "./schema/manifest-v2.schema.json"
packages/extension/node_modules/@crxjs/vite-plugin/manifest.schema.json:13:    "$ref": "./schema/manifest-v3.schema.json"
packages/extension/node_modules/@crxjs/vite-plugin/client.d.ts:6:   * with the Chrome Scripting API inside of the background service worker or an
packages/extension/node_modules/@crxjs/vite-plugin/client.d.ts:12:   * `web_accessible_resources`.
packages/extension/node_modules/@crxjs/vite-plugin/client.d.ts:21:   * with the Chrome Scripting API inside of the background service worker or an
packages/extension/node_modules/@crxjs/vite-plugin/client.d.ts:27:   * `web_accessible_resources`.
packages/extension/node_modules/@crxjs/vite-plugin/client.d.ts:35:   * Script format is IIFE. Use for content scripts with opaque origins.
packages/extension/node_modules/@crxjs/vite-plugin/client.d.ts:40:   * `web_accessible_resources`.
packages/extension/node_modules/@crxjs/vite-plugin/client.d.ts:55:   * `web_accessible_resources`.
packages/extension/node_modules/@crxjs/vite-plugin/package.json:50:    "manifest.schema.json",
packages/extension/node_modules/@crxjs/vite-plugin/package.json:66:    "node-html-parser": "^7.0.2",
packages/extension/node_modules/@crxjs/vite-plugin/README.md:34:- 🔥 **True Hot Module Replacement** - Instant UI updates while preserving extension state 🎈**works with content scripts**
packages/extension/node_modules/@crxjs/vite-plugin/README.md:36:- 🤖 **Auto Web-Accessible Resources** - Automatic generation of `web_accessible_resources` manifest entries  

 succeeded in 0ms:

## Configuration

The following show the default values of the configuration

```ts
Components({
  // relative paths to the directory to search for components.
  dirs: ['src/components'],

  // valid file extensions for components.
  extensions: ['vue'],

  // Glob patterns to match file names to be detected as components.
  // You can also specify multiple like this: `src/components/*.{vue,tsx}`
  // When specified, the `dirs`, `extensions`, and `directoryAsNamespace` options will be ignored.
  // If you want to exclude components being registered, use negative globs with leading `!`.
  globs: ['src/components/*.vue'],

  // search for subdirectories
  deep: true,

  // resolvers for custom components
  resolvers: [],

  // generate `components.d.ts` global declarations,
  // also accepts a path for custom filename
  // default: `true` if package typescript is installed
  dts: false,

  // generate dts with TSX support
  // default: `true` if `@vitejs/plugin-vue-jsx` is installed
  dtsTsx: false,

  // Allow subdirectories as namespace prefix for components.

---
    types: true // Enable auto import the types under the directories
  },

  // Auto import for module exports under directories
  // by default it only scan one level of modules under the directory
  dirs: [
    './hooks',
    './composables', // only root modules
    './composables/**', // all nested modules
    // ...

    {
      glob: './hooks',
      types: true // enable import the types
    },
    {
      glob: './composables',
      types: false // If top level dirsScanOptions.types importing enabled, just only disable this directory
    }
    // ...
  ],

  // Filepath to generate corresponding .d.ts file.
  // Defaults to './auto-imports.d.ts' when `typescript` is installed locally.
  // Set `false` to disable.
  dts: './auto-imports.d.ts',

  // The mode for generating the .d.ts file.
  // 'overwrite': overwrite the whole existing .d.ts file with the new type definitions.
  // 'append': only append the new type definitions to the existing .d.ts file, means the existing type definitions will be kept.
  // Default to 'append'
  dtsMode: 'append',

  // Preserve the original file extensions in the generated .d.ts file.
  // Set to `true` to keep the extensions for .ts and .tsx files.

exec
/bin/zsh -lc 'rg -n "rollupOptions|input|htmlFiles|contentScripts|pages|manifestFiles|index.html|parseManifest|offscreen" packages/extension/node_modules/@crxjs/vite-plugin/dist -S' in (project root)
 succeeded in 0ms:
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.d.ts:47:        startup_pages?: string[] | undefined;
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.d.ts:90:        extension_pages?: string;
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.d.ts:132:    input_components?: {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.d.ts:137:        input_view?: string | undefined;
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.d.ts:179:        pages: string[];
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.d.ts:251:         * - Format: "subdir/index.html" (no leading ./ or /)
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.d.ts:297:    input_components?: {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.d.ts:302:        input_view?: string;
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.d.ts:368:     * Runs during the transform hook for the manifest. Filenames use input
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.d.ts:384:    contentScripts?: {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:389:const contentScripts = new RxMap();
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:390:contentScripts.change$.pipe(filter(RxMap.isChangeType.set)).subscribe(({ map, value }) => {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:559:  const { rollupOptions, outDir } = server.config.build;
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:560:  const inputOptions = {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:561:    input: "index.html",
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:562:    ...rollupOptions,
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:565:  const rollupOutputOptions = [rollupOptions.output].flat()[0];
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:572:  const build = await rollup(inputOptions);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:693:        const { contentScripts: contentScripts2 = {} } = await getOptions(config);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:694:        hmrTimeout = contentScripts2.hmrTimeout ?? 5e3;
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:695:        preambleCode = preambleCode ?? contentScripts2.preambleCode;
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:710:          contentScripts.change$.pipe(filter(RxMap.isChangeType.set)).subscribe(({ value: script }) => {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:773:            rollupOptions: {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:774:              ...config.build?.rollupOptions,
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:776:              preserveEntrySignatures: config.build?.rollupOptions?.preserveEntrySignatures ?? "exports-only"
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:782:        for (const [key, script] of contentScripts)
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:811:            contentScripts.set(script.refId, formatFileData(script));
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:824:      const { contentScripts: contentScripts2 = {} } = await getOptions(config);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:825:      injectCss = contentScripts2.injectCss ?? true;
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:833:                if (contentScripts.has(fileName)) {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:834:                  const { css } = contentScripts.get(fileName);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:956:            let script = contentScripts.get(resolvedId);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:987:              contentScripts.set(script.id, script);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:999:          const script = contentScripts.get(scriptId);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1028:                  const script = contentScripts.get(scriptKey);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1121:async function manifestFiles(manifest, options = {}) {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1128:  const contentScripts = manifest.content_scripts?.flatMap(({ js }) => js) ?? [];
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1133:  const htmlPages = htmlFiles(manifest);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1156:    contentScripts: [...new Set(contentScripts)].filter(isString),
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1170:function htmlFiles(manifest) {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1177:    manifest.sandbox?.pages,
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1313:  let inputManifestFiles;
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1391:        if (inputManifestFiles.background.length) {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1392:          const background = prefix$1("/", inputManifestFiles.background[0]);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1398:        for (const [key, script] of contentScripts)
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1430:        inputManifestFiles = await manifestFiles(manifest, { cwd: config.root });
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1495:  const pages = /* @__PURE__ */ new Map();
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1524:      const page = pages.get(key);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1526:      pages.set(key, page);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1535:      pages.set(key, {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1555:      const p = pages.get(key);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1600:        const page = pages.get(id);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1640:            contentScripts: js,
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1643:          } = await manifestFiles(manifest, { cwd: config2.root });
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1645:          let { input = [] } = config2.build?.rollupOptions ?? {};
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1646:          if (typeof input === "string")
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1647:            input = [input];
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1649:            input = Object.values(input);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1650:          input = input.map((f) => {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1657:          const set = new Set([entries, input].flat());
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1686:        if (typeof options.input !== "undefined" && !("ssr" in this)) {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1707:      name: "crx:stub-input",
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1709:      options({ input, ...options }) {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1710:        let finalInput = input;
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1711:        if (isString(input) && input.endsWith("index.html")) {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1715:          if (Array.isArray(input)) {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1716:            finalInput = input.filter((x) => !x.endsWith(".html"));
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1717:          } else if (typeof input === "object") {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1718:            for (const [key, value] of Object.entries(input))
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1720:                delete input[key];
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1723:        return { input: finalInput, ...options };
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1782:                contentScripts.set(
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1800:                contentScripts.set(
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1822:                contentScripts.set(
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1852:          for (const file of htmlFiles(manifest2)) {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1904:                  const script = contentScripts.get(id);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:1943:        const files = await manifestFiles(manifest2, { cwd: config.root });
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:2030:        const script = contentScripts.get(key);
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:2109:        const contentScripts2 = opts.contentScripts || {};
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:2111:        injectCss = contentScripts2.injectCss ?? true;
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:2139:        if (contentScripts.size > 0) {
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:2159:          ] of contentScripts)
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:2171:                  contentScripts.get(key).css = [...css];
packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs:2266:  contentScripts.clear();

exec
/bin/zsh -lc "node -e \"const fs=require('fs'); const path='packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs'; const s=fs.readFileSync(path,'utf8'); const keys=['rollupOptions','input','index.html','manifest']; for (const k of keys){ const i=s.indexOf(k); if(i>=0) console.log('---'+k+'---\\n'+s.slice(Math.max(0,i-400), i+1200)+'\\n'); }\"" in (project root)
 succeeded in 0ms:
---rollupOptions---
{ target, source: magic.toString(), deps: [...depSet] };
    })
  );
}
async function allFilesReady() {
  await firstValueFrom(allFilesReady$);
}

const { outputFile } = fsx;
const debug$4 = _debug("file-writer");
async function start({
  server
}) {
  serverEvent$.next({ type: "start", server });
  const plugins = server.config.plugins.filter(
    (p) => p.name?.startsWith("crx:")
  );
  const { rollupOptions, outDir } = server.config.build;
  const inputOptions = {
    input: "index.html",
    ...rollupOptions,
    plugins
  };
  const rollupOutputOptions = [rollupOptions.output].flat()[0];
  const outputOptions = {
    ...rollupOutputOptions,
    dir: outDir,
    format: "es"
  };
  fileWriterEvent$.next({ type: "build_start" });
  const build = await rollup(inputOptions);
  await build.write(outputOptions);
  fileWriterEvent$.next({ type: "build_end" });
  await allFilesReady();
}
async function close() {
  serverEvent$.next({ type: "close" });
}
function add(script) {
  const fileName = getFileName(script);
  debug$4(
    "add: script.id=%s script.type=%s fileName=%s",
    script.id,
    script.type,
    fileName
  );
  let file = outputFiles.get(fileName);
  if (typeof file === "undefined") {
    file = formatFileData({
      ...script,
      fileName,
      file: write(script)
    });
    outputFiles.set(file.fileName, file);
    debug$4("add: stored new file %s", file.fileName);
  } else {
    const isVirtualModule = script.id.startsWith("/@id/") || script.id.startsWith("/__");
    if (isVirtualModule) {
      debug$4(
        "add: virtual module already exists, tr

---input---
;
    })
  );
}
async function allFilesReady() {
  await firstValueFrom(allFilesReady$);
}

const { outputFile } = fsx;
const debug$4 = _debug("file-writer");
async function start({
  server
}) {
  serverEvent$.next({ type: "start", server });
  const plugins = server.config.plugins.filter(
    (p) => p.name?.startsWith("crx:")
  );
  const { rollupOptions, outDir } = server.config.build;
  const inputOptions = {
    input: "index.html",
    ...rollupOptions,
    plugins
  };
  const rollupOutputOptions = [rollupOptions.output].flat()[0];
  const outputOptions = {
    ...rollupOutputOptions,
    dir: outDir,
    format: "es"
  };
  fileWriterEvent$.next({ type: "build_start" });
  const build = await rollup(inputOptions);
  await build.write(outputOptions);
  fileWriterEvent$.next({ type: "build_end" });
  await allFilesReady();
}
async function close() {
  serverEvent$.next({ type: "close" });
}
function add(script) {
  const fileName = getFileName(script);
  debug$4(
    "add: script.id=%s script.type=%s fileName=%s",
    script.id,
    script.type,
    fileName
  );
  let file = outputFiles.get(fileName);
  if (typeof file === "undefined") {
    file = formatFileData({
      ...script,
      fileName,
      file: write(script)
    });
    outputFiles.set(file.fileName, file);
    debug$4("add: stored new file %s", file.fileName);
  } else {
    const isVirtualModule = script.id.startsWith("/@id/") || script.id.startsWith("/__");
    if (isVirtualModule) {
      debug$4(
        "add: virtual module already exists, triggering re-write for %s",
        fileName
      );
  

---index.html---
n allFilesReady() {
  await firstValueFrom(allFilesReady$);
}

const { outputFile } = fsx;
const debug$4 = _debug("file-writer");
async function start({
  server
}) {
  serverEvent$.next({ type: "start", server });
  const plugins = server.config.plugins.filter(
    (p) => p.name?.startsWith("crx:")
  );
  const { rollupOptions, outDir } = server.config.build;
  const inputOptions = {
    input: "index.html",
    ...rollupOptions,
    plugins
  };
  const rollupOutputOptions = [rollupOptions.output].flat()[0];
  const outputOptions = {
    ...rollupOutputOptions,
    dir: outDir,
    format: "es"
  };
  fileWriterEvent$.next({ type: "build_start" });
  const build = await rollup(inputOptions);
  await build.write(outputOptions);
  fileWriterEvent$.next({ type: "build_end" });
  await allFilesReady();
}
async function close() {
  serverEvent$.next({ type: "close" });
}
function add(script) {
  const fileName = getFileName(script);
  debug$4(
    "add: script.id=%s script.type=%s fileName=%s",
    script.id,
    script.type,
    fileName
  );
  let file = outputFiles.get(fileName);
  if (typeof file === "undefined") {
    file = formatFileData({
      ...script,
      fileName,
      file: write(script)
    });
    outputFiles.set(file.fileName, file);
    debug$4("add: stored new file %s", file.fileName);
  } else {
    const isVirtualModule = script.id.startsWith("/@id/") || script.id.startsWith("/__");
    if (isVirtualModule) {
      debug$4(
        "add: virtual module already exists, triggering re-write for %s",
        fileName
      );
      file.file = write(script)

---manifest---
ring";
function isObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}
const isResourceByMatch = (x) => "matches" in x;
function decodeManifest(code) {
  const tree = this.parse(code);
  let literal;
  let templateElement;
  simple(tree, {
    Literal(node) {
      literal = node;
    },
    TemplateElement(node) {
      templateElement = node;
    }
  });
  let manifestJson = literal?.value;
  if (!manifestJson)
    manifestJson = templateElement?.value?.cooked;
  if (!manifestJson)
    throw new Error("unable to parse manifest code");
  let result = JSON.parse(manifestJson);
  if (typeof result === "string")
    result = JSON.parse(result);
  return result;
}
function encodeManifest(manifest) {
  const json = JSON.stringify(JSON.stringify(manifest));
  return `export default ${json}`;
}
function parseJsonAsset(bundle, key) {
  const asset = bundle[key];
  if (typeof asset === "undefined")
    throw new TypeError(`OutputBundle["${key}"] is undefined.`);
  if (asset.type !== "asset")
    throw new Error(`OutputBundle["${key}"] is not an OutputAsset.`);
  if (typeof asset.source !== "string")
    throw new TypeError(`OutputBundle["${key}"].source is not a string.`);
  return JSON.parse(asset.source);
}
const getMatchPatternOrigin = (pattern) => {
  if (pattern.startsWith("<"))
    return pattern;
  const [schema, rest] = pattern.split("://");
  const slashIndex = rest.indexOf("/");
  const isSlashAfterOriginPresent = slashIndex !== -1;
  const origin = isSlashAfterOriginPresent ? rest.slice(0, slashIndex) : rest;
  const root = `${schema}:/


2026-04-23T18:15:18.000310Z ERROR codex_core::tools::router: error=exec_command failed for `/bin/zsh -lc "node - <<'NODE'
const fs=require('fs');
const s=fs.readFileSync('packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs','utf8');
for (const marker of ['function htmlFiles','async function manifestFiles','input = input.map','const set = new Set([entries, input].flat())','name: \"crx:stub-input\"']) {
 const i=s.indexOf(marker); if(i>=0) console.log('\\n---'+marker+'---\\n'+s.slice(i, i+1800));
}
NODE"`: CreateProcess { message: "Codex(Sandbox(Denied { output: ExecToolCallOutput { exit_code: 1, stdout: StreamOutput { text: \"\", truncated_after_lines: None }, stderr: StreamOutput { text: \"zsh:1: can't create temp file for here document: operation not permitted\\n\", truncated_after_lines: None }, aggregated_output: StreamOutput { text: \"zsh:1: can't create temp file for here document: operation not permitted\\n\", truncated_after_lines: None }, duration: 0ns, timed_out: false }, network_policy_decision: None }))" }
exec
/bin/zsh -lc "sed -n '240,320p' packages/extension/node_modules/@crxjs/vite-plugin/dist/index.d.ts" in (project root)
 succeeded in 0ms:
    action?: {
        /**
         * - Relative to Vite project root (where vite.config.js is)
         * - Format: "subdir/icon.png" (no leading ./ or /)
         *
         * @example "assets/icon.png"
         */
        default_icon?: ManifestIcons<T>;
        default_title?: string;
        /**
         * - Relative to Vite project root (where vite.config.js is)
         * - Format: "subdir/index.html" (no leading ./ or /)
         *
         * @example "src/popup.html"
         */
        default_popup?: ManifestFilePath<T>;
    };
    background?: {
        /**
         * - Relative to Vite project root (where vite.config.js is)
         * - Format: "subdir/index.js" (no leading ./ or /)
         *
         * @example "src/background.js"
         */
        service_worker: ManifestFilePath<T>;
        type?: 'module' | (string & {});
    } | FirefoxManifestBackground;
    content_scripts?: {
        matches?: string[];
        exclude_matches?: string[];
        /**
         * - Relative to Vite project root (where vite.config.js is)
         * - Format: "subdir/content.css" (no leading ./ or /)
         *
         * @example "src/content.css"
         */
        css?: ManifestFilePath<T>[];
        /**
         * - Relative to Vite project root (where vite.config.js is)
         * - Format: "subdir/content.js" (no leading ./ or /)
         *
         * @example "src/content.js"
         */
        js?: ManifestFilePath<T>[];
        run_at?: string;
        all_frames?: boolean;
        match_about_blank?: boolean;
        include_globs?: string[];
        exclude_globs?: string[];
        /**
         * - 'ISOLATED' (default): Content script runs in an isolated world.
         * - 'MAIN': Content script runs in the main world.
         * NOTE: MAIN currently does NOT support crxjs HMR
         * @see https://developer.chrome.com/docs/extensions/mv3/content_scripts/#world
         */
        world?: 'ISOLATED' | 'MAIN';
    }[];
    input_components?: {
        name: string;
        id?: string;
        language?: string | string[];
        layouts?: string | string[];
        input_view?: string;
        /**
         * - Relative to Vite project root (where vite.config.js is)
         * - Format: "subdir/options.html" (no leading ./ or /)
         *
         * @example "src/options.html"
         */
        options_page?: ManifestFilePath<T>;
    }[];
    /**
     * - Relative to Vite project root (where vite.config.js is)
     * - Format: "subdir/options.html" (no leading ./ or /)
     *
     * @example "src/options.html"
     */
    options_page?: ManifestFilePath<T>;
    /**
     * - Relative to Vite project root (where vite.config.js is)
     * - Format: "subdir/devtools.html" (no leading ./ or /)

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/components/ui/LoadingState.vue && printf '\\n---\\n' && sed -n '1,220p' packages/extension/src/components/ui/Button.vue && printf '\\n---\\n' && sed -n '1,220p' packages/extension/src/components/ui/AddressDisplay.vue" in (project root)
exec
/bin/zsh -lc "sed -n '1120,1188p' packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs && printf '\\n---\\n' && sed -n '1638,1668p' packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs && printf '\\n---\\n' && sed -n '1704,1726p' packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs" in (project root)
 succeeded in 0ms:
<script setup>
defineProps({
	label: { type: String, required: true },
	sub: { type: String, default: "" },
})
</script>

<template>
	<div :class="$style.wrapper" data-testid="loading-state">
		<Spinner size="20" color="--txt-primary" />
		<span :class="$style.label">{{ label }}</span>
		<span v-if="sub" :class="$style.sub">{{ sub }}</span>
	</div>
</template>

<style module>
.wrapper {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;

	padding: 32px 16px;
	border: 1px dashed var(--nulo-border);

	text-align: center;
}

.label {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.sub {
	font-family: var(--font-mono);
	font-size: 11px;
	line-height: 1.4;
	color: var(--nulo-outline);
}
</style>

---
<script setup>
/**
 * Vendor
 */
import { useCssModule } from "vue"

const emit = defineEmits(["onKeybind"])
const props = defineProps({
	size: {
		type: String,
		default: "medium",
	},
	type: {
		type: String,
		default: "primary",
	},
	wide: {
		type: Boolean,
		default: false,
	},
	disabled: {
		type: Boolean,
	},
	loading: {
		type: Boolean,
	},
	link: {
		type: String,
		required: false,
	},
	target: {
		type: String,
		required: false,
	},
	leftIcon: {
		type: String,
		required: false,
	},
	leftIconColor: {
		type: String,
		required: false,
	},
	rightIcon: {
		type: String,
		required: false,
	},
	rightIconColor: {
		type: String,
		required: false,
	},
})

const style = useCssModule()

const getStyles = () => {
	const hasCorrectSize = ["large", "medium", "small", "mini", "dynamic", "micro"].includes(props.size)

	return [
		style.wrapper,
		style[props.type],
		props.wide && style.wide,
		hasCorrectSize && style[props.size],
		props.disabled && style.disabled,
		props.border && style.border,
	]
}
</script>

<template>
	<component
		:is="link ? RouterLink : 'button'"
		v-bind="{ to: link ? link : null }"
		:target="target"
		:tabindex="disabled ? -1 : 0"
		:class="[...getStyles(), loading && $style.loading]"
	>
		<Spinner v-if="loading" color="--txt-primary" />
		<Icon
			v-if="leftIcon"
			:name="leftIcon"
			size="16"
			:color="leftIconColor ? leftIconColor : 'white'"
			:class="$style.left_icon"
		/>
		<slot />
		<Icon
			v-if="rightIcon"
			:name="rightIcon"
			size="16"
			:color="rightIconColor ? rightIconColor : 'white'"
			:class="$style.right_icon"
		/>
	</component>
</template>

<style module>
.wrapper {
	position: relative;

	overflow: hidden;

	display: flex;
	align-items: center;
	justify-content: center;
	gap: 10px;

	cursor: pointer;
	box-sizing: border-box;
	user-select: none;

	background-clip: padding-box !important;

	color: var(--txt-primary);
	font-weight: 600;
	white-space: nowrap;

	transition: all 0.2s ease;
}

.wrapper.loading {
	opacity: 0.8;
	pointer-events: none;
}

.wrapper.wide {
	width: 100%;
	justify-content: center;
}

/** SIZES */
.wrapper.dynamic {
	height: initial;
	border-radius: 0;
	padding: 10px 0;
}

.wrapper.large {
	height: 48px;
	font-size: 14px;
	line-height: 1;
	border-radius: 0;
	letter-spacing: 0.05em;
}

.wrapper.medium {
	min-height: 40px;
	gap: 8px;
	font-size: 13px;
	border-radius: 0;
	padding: 0 14px;
	letter-spacing: 0.03em;
}

.wrapper.small {
	height: 32px;
	gap: 6px;
	border-radius: 0;
	padding: 0 12px;
}

.wrapper.mini {
	height: 26px;
	gap: 6px;
	border-radius: 0;
	font-size: 12px;
	padding: 0 10px;
}

.wrapper.micro {
	height: 20px;
	gap: 6px;
	border-radius: 0;
	font-size: 11px;
	padding: 0 8px;
}

/** TYPES */
.wrapper.primary {
	background: var(--nulo-accent);
	color: #0a0908;
	fill: #0a0908;
	font-family: var(--font-headline);
	font-weight: 700;
	text-transform: uppercase;
}
.wrapper.primary:hover:not(.disabled):not(.loading) {
	background: #fff;
}
.wrapper.primary:active:not(.disabled):not(.loading) {
	transform: scale(0.98);
}

/** Brutalist outlined variant — same typographic weight as primary
 *  (font-headline + uppercase) but transparent bg with a 2px architectural
 *  edge. Used for second-tier actions where a soft --nulo-surface-high
 *  chip would fight the brutalist CTA language. */
.wrapper.primary_outline {
	background: transparent;
	color: var(--txt-primary);
	fill: var(--txt-primary);
	font-family: var(--font-headline);
	font-weight: 700;
	text-transform: uppercase;
	border: 2px solid var(--nulo-outline);
}
.wrapper.primary_outline:hover:not(.disabled):not(.loading) {
	background: var(--nulo-surface-low);
}
.wrapper.primary_outline:active:not(.disabled):not(.loading) {
	background: var(--nulo-surface-high);
}

.wrapper.secondary {
	background: var(--nulo-surface-high);
	color: var(--txt-primary);
}
.wrapper.secondary:hover:not(.disabled):not(.loading) {
	background: var(--nulo-surface-highest);
}
.wrapper.secondary:active:not(.disabled):not(.loading) {

---
<script setup>
/** Utils */
import { onMounted } from "vue"
import { managers } from "@/utils/core"
import { trimAddress } from "@/utils/string"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const emit = defineEmits(["onAddressClick"])
const props = defineProps({
	address: {
		type: String,
		required: false,
	},
	full: {
		type: Boolean,
		default: false,
	},
	formatter: {
		type: Function,
		default: null,
	},
	size: {
		type: String,
		default: "12",
	},
	weight: {
		type: String,
		default: "500",
	},
	height: {
		type: String,
		default: "100",
	},
	color: {
		type: String,
		default: "primary",
	},
	static: {
		type: Boolean,
		default: false,
	},
})

const contactName = ref("")
const displayedAddress = ref("")

const showName = ref(false)

const handleClick = () => {
	if (props.static) {
		emit("onAddressClick")
		return
	}

	showName.value = !showName.value

	if (contactName.value) {
		event.stopPropagation()
	}

	emit("onAddressClick")
}

onMounted(async () => {
	if (props.address) {
		const contact = await managers.contact.getContactByAddress(props.address)
		if (contact?.name) {
			contactName.value = `@${contact.name}`
			showName.value = true
		} else {
			const _acc = appStore.accounts.find((acc) => acc.address === props.address)
			if (_acc?.name) {
				contactName.value = _acc.name
				showName.value = true
			}
		}

		if (props.full) {
			displayedAddress.value = props.address
		} else {
			if (typeof props.formatter === "function") {
				displayedAddress.value = props.formatter(props.address)
			} else {
				displayedAddress.value = trimAddress(props.address)
			}
		}
	}
})
</script>

<template>
	<Text
		@click="handleClick"
		:size="size"
		:color="color"
		:weight="weight"
		:height="height"
		:class="contactName && $style.clickable"
	>
		{{ showName && contactName ? contactName : displayedAddress }}
	</Text>
</template>

<style module>
.clickable {
	cursor: pointer;
}
</style>

 succeeded in 0ms:

async function manifestFiles(manifest, options = {}) {
  let locales = [];
  if (manifest.default_locale)
    locales = await fg("_locales/**/messages.json", options);
  const rulesets = manifest.declarative_net_request?.rule_resources.flatMap(
    ({ path }) => path
  ) ?? [];
  const contentScripts = manifest.content_scripts?.flatMap(({ js }) => js) ?? [];
  const contentStyles = manifest.content_scripts?.flatMap(({ css }) => css);
  const serviceWorker = manifest.background && "service_worker" in manifest.background ? manifest.background.service_worker : void 0;
  const backgroundScripts = manifest.background && "scripts" in manifest.background ? manifest.background.scripts : void 0;
  const background = serviceWorker ? [serviceWorker].filter(isString) : backgroundScripts ? backgroundScripts.filter(isString) : [];
  const htmlPages = htmlFiles(manifest);
  const icons = [
    Object.values(
      isString(manifest.icons) ? [manifest.icons] : manifest.icons ?? {}
    ),
    Object.values(
      isString(manifest.action?.default_icon) ? [manifest.action?.default_icon] : manifest.action?.default_icon ?? {}
    )
  ].flat();
  let webAccessibleResources = [];
  if (manifest.web_accessible_resources) {
    const resources = await Promise.all(
      manifest.web_accessible_resources.flatMap(({ resources: resources2 }) => resources2).map(async (r) => {
        if (["*", "**/*"].includes(r))
          return void 0;
        if (fg.isDynamicPattern(r))
          return fg(r, options);
        return r;
      })
    );
    webAccessibleResources = [...new Set(resources.flat())].filter(isString);
  }
  return {
    contentScripts: [...new Set(contentScripts)].filter(isString),
    contentStyles: [...new Set(contentStyles)].filter(isString),
    html: htmlPages,
    icons: [...new Set(icons)].filter(isString),
    locales: [...new Set(locales)].filter(isString),
    rulesets: [...new Set(rulesets)].filter(isString),
    background,
    webAccessibleResources
  };
}
async function dirFiles(dir) {
  const files = await fg(join(dir, "**", "*"));
  return files;
}
function htmlFiles(manifest) {
  const files = [
    manifest.action?.default_popup,
    Object.values(manifest.chrome_url_overrides ?? {}),
    manifest.devtools_page,
    manifest.options_page,
    manifest.options_ui?.page,
    manifest.sandbox?.pages,
    manifest.side_panel?.default_path
  ].flat().filter(isString).map((s) => s.split(/[#?]/)[0]).sort();
  return [...new Set(files)];
}

const pluginFileWriterPublic = () => {
  let config;
  return {
    name: "crx:file-writer-public",
    apply: "serve",
    configResolved(_config) {

---
        if (env.command === "serve") {
          const {
            contentScripts: js,
            background: sw,
            html
          } = await manifestFiles(manifest, { cwd: config2.root });
          const { entries = [] } = config2.optimizeDeps ?? {};
          let { input = [] } = config2.build?.rollupOptions ?? {};
          if (typeof input === "string")
            input = [input];
          else
            input = Object.values(input);
          input = input.map((f) => {
            let result = f;
            if (isAbsolute(f)) {
              result = relative(config2.root ?? process.cwd(), f);
            }
            return result;
          });
          const set = new Set([entries, input].flat());
          for (const x of [js, sw, html].flat())
            set.add(x);
          return {
            ...config2,
            optimizeDeps: {
              ...config2.optimizeDeps,
              entries: [...set]
            }
          };
        }
      },

---
      }
    },
    {
      name: "crx:stub-input",
      enforce: "pre",
      options({ input, ...options }) {
        let finalInput = input;
        if (isString(input) && input.endsWith("index.html")) {
          finalInput = stubId;
        }
        if (config.command === "serve") {
          if (Array.isArray(input)) {
            finalInput = input.filter((x) => !x.endsWith(".html"));
          } else if (typeof input === "object") {
            for (const [key, value] of Object.entries(input))
              if (value.endsWith(".html"))
                delete input[key];
          }
        }
        return { input: finalInput, ...options };
      },
      resolveId(source) {
        if (source === stubId)

web search: 
web search: 
web search: 
web search: dependency-cruiser npm latest version
web search: 
web search: dependency-cruiser releases GitHub 2026 17.3.10
web search: 
web search: dependency-cruiser Bun monorepo TypeScript tsconfig paths docs
exec
/bin/zsh -lc "rg -n \"fetch_code.*/index\\.js|fetch_code/index\\.js|fetch_code\" node_modules/.bun/@aztec+bb.js@*/node_modules/@aztec/bb.js -S" in (project root)
 succeeded in 0ms:
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/src/barretenberg_wasm/index.ts:2:import { fetchCode } from './fetch_code/index.js';
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/src/barretenberg_wasm/index.ts:2:import { fetchCode } from './fetch_code/index.js';
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/index.js:5:const index_js_2 = require("./fetch_code/index.js");
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/index.js:2:import { fetchCode } from './fetch_code/index.js';
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../src/barretenberg_wasm/fetch_code/index.ts"],"names":[],"mappings":"AAAA,cAAc,iBAAiB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg-threads.d.ts.map:1:{"version":3,"file":"barretenberg-threads.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg-threads.ts"],"names":[],"mappings":"AAAA,OAAO,yBAAyB,MAAM,oCAAoC,CAAC;AAE3E,eAAe,yBAAyB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/fetch_code/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../src/barretenberg_wasm/fetch_code/index.ts"],"names":[],"mappings":"AAAA,cAAc,iBAAiB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/fetch_code/node/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/node/index.ts"],"names":[],"mappings":"AAgBA,wBAAsB,SAAS,CAAC,aAAa,EAAE,OAAO,EAAE,QAAQ,CAAC,EAAE,MAAM,oCAiBxE"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/fetch_code/browser/barretenberg-threads.d.ts.map:1:{"version":3,"file":"barretenberg-threads.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg-threads.ts"],"names":[],"mappings":"AAAA,OAAO,yBAAyB,MAAM,oCAAoC,CAAC;AAE3E,eAAe,yBAAyB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg.d.ts.map:1:{"version":3,"file":"barretenberg.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg.ts"],"names":[],"mappings":"AAAA,OAAO,kBAAkB,MAAM,4BAA4B,CAAC;AAE5D,eAAe,kBAAkB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/fetch_code/browser/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/index.ts"],"names":[],"mappings":"AAIA,wBAAsB,SAAS,CAAC,aAAa,EAAE,OAAO,EAAE,QAAQ,CAAC,EAAE,MAAM,oCA6BxE"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/fetch_code/browser/barretenberg.d.ts.map:1:{"version":3,"file":"barretenberg.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg.ts"],"names":[],"mappings":"AAAA,OAAO,kBAAkB,MAAM,4BAA4B,CAAC;AAE5D,eAAe,kBAAkB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/index.js:5:const index_js_2 = require("./fetch_code/index.js");
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/index.ts"],"names":[],"mappings":"AAIA,wBAAsB,SAAS,CAAC,aAAa,EAAE,OAAO,EAAE,QAAQ,CAAC,EAAE,MAAM,oCA6BxE"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/fetch_code/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../src/barretenberg_wasm/fetch_code/index.ts"],"names":[],"mappings":"AAAA,cAAc,iBAAiB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/fetch_code/node/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/node/index.ts"],"names":[],"mappings":"AAgBA,wBAAsB,SAAS,CAAC,aAAa,EAAE,OAAO,EAAE,QAAQ,CAAC,EAAE,MAAM,oCAiBxE"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/fetch_code/browser/barretenberg-threads.d.ts.map:1:{"version":3,"file":"barretenberg-threads.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg-threads.ts"],"names":[],"mappings":"AAAA,OAAO,yBAAyB,MAAM,oCAAoC,CAAC;AAE3E,eAAe,yBAAyB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/fetch_code/browser/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/index.ts"],"names":[],"mappings":"AAIA,wBAAsB,SAAS,CAAC,aAAa,EAAE,OAAO,EAAE,QAAQ,CAAC,EAAE,MAAM,oCA6BxE"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node-cjs/barretenberg_wasm/fetch_code/browser/barretenberg.d.ts.map:1:{"version":3,"file":"barretenberg.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg.ts"],"names":[],"mappings":"AAAA,OAAO,kBAAkB,MAAM,4BAA4B,CAAC;AAE5D,eAAe,kBAAkB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/index.js:2:import { fetchCode } from './fetch_code/index.js';
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/fetch_code/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../src/barretenberg_wasm/fetch_code/index.ts"],"names":[],"mappings":"AAAA,cAAc,iBAAiB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/fetch_code/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../src/barretenberg_wasm/fetch_code/index.ts"],"names":[],"mappings":"AAAA,cAAc,iBAAiB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/fetch_code/node/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/node/index.ts"],"names":[],"mappings":"AAgBA,wBAAsB,SAAS,CAAC,aAAa,EAAE,OAAO,EAAE,QAAQ,CAAC,EAAE,MAAM,oCAiBxE"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/fetch_code/browser/barretenberg-threads.d.ts.map:1:{"version":3,"file":"barretenberg-threads.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg-threads.ts"],"names":[],"mappings":"AAAA,OAAO,yBAAyB,MAAM,oCAAoC,CAAC;AAE3E,eAAe,yBAAyB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/index.js:2:import { fetchCode } from './fetch_code/index.js';
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/fetch_code/browser/barretenberg.d.ts.map:1:{"version":3,"file":"barretenberg.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg.ts"],"names":[],"mappings":"AAAA,OAAO,kBAAkB,MAAM,4BAA4B,CAAC;AAE5D,eAAe,kBAAkB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/fetch_code/browser/barretenberg-threads.d.ts.map:1:{"version":3,"file":"barretenberg-threads.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg-threads.ts"],"names":[],"mappings":"AAAA,OAAO,yBAAyB,MAAM,oCAAoC,CAAC;AAE3E,eAAe,yBAAyB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/fetch_code/browser/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/index.ts"],"names":[],"mappings":"AAIA,wBAAsB,SAAS,CAAC,aAAa,EAAE,OAAO,EAAE,QAAQ,CAAC,EAAE,MAAM,oCA6BxE"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/fetch_code/node/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/node/index.ts"],"names":[],"mappings":"AAgBA,wBAAsB,SAAS,CAAC,aAAa,EAAE,OAAO,EAAE,QAAQ,CAAC,EAAE,MAAM,oCAiBxE"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/fetch_code/browser/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/index.ts"],"names":[],"mappings":"AAIA,wBAAsB,SAAS,CAAC,aAAa,EAAE,OAAO,EAAE,QAAQ,CAAC,EAAE,MAAM,oCA6BxE"}
node_modules/.bun/@aztec+bb.js@4.2.0-aztecnr-rc.2/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/fetch_code/browser/barretenberg.d.ts.map:1:{"version":3,"file":"barretenberg.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg.ts"],"names":[],"mappings":"AAAA,OAAO,kBAAkB,MAAM,4BAA4B,CAAC;AAE5D,eAAe,kBAAkB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../src/barretenberg_wasm/fetch_code/index.ts"],"names":[],"mappings":"AAAA,cAAc,iBAAiB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg-threads.d.ts.map:1:{"version":3,"file":"barretenberg-threads.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg-threads.ts"],"names":[],"mappings":"AAAA,OAAO,yBAAyB,MAAM,oCAAoC,CAAC;AAE3E,eAAe,yBAAyB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg.d.ts.map:1:{"version":3,"file":"barretenberg.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/barretenberg.ts"],"names":[],"mappings":"AAAA,OAAO,kBAAkB,MAAM,4BAA4B,CAAC;AAE5D,eAAe,kBAAkB,CAAC"}
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/index.js:2:import { fetchCode } from './fetch_code/index.js';
node_modules/.bun/@aztec+bb.js@4.2.0-nightly.20260413/node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/index.d.ts.map:1:{"version":3,"file":"index.d.ts","sourceRoot":"","sources":["../../../../../src/barretenberg_wasm/fetch_code/browser/index.ts"],"names":[],"mappings":"AAIA,wBAAsB,SAAS,CAAC,aAAa,EAAE,OAAO,EAAE,QAAQ,CAAC,EAAE,MAAM,oCA6BxE"}

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/shims/bb-fetch-code.ts" in (project root)
 succeeded in 0ms:
/**
 * Replacement for @aztec/bb.js fetchCode browser module.
 *
 * The original uses dynamic import() to load embedded WASM data URIs as a fallback
 * when wasmPath is not provided. Chrome MV3 service workers forbid import() at runtime.
 *
 * This shim replaces the import() fallback with a fetch() to the known WASM asset path.
 * The WASM files are copied to /assets/ by vite-plugin-static-copy from libs/@aztec/bb.js/.
 */
// @ts-expect-error — pako has no types in this context
import pako from "pako"

const DEFAULT_WASM_PATH = "/assets/barretenberg.wasm.gz"

export async function fetchCode(multithreaded: boolean, wasmPath?: string): Promise<ArrayBuffer> {
	const basePath = wasmPath ?? DEFAULT_WASM_PATH
	const suffix = multithreaded ? "-threads" : ""
	const filePath = basePath.split("/").slice(0, -1).join("/")
	const fileNameWithExtensions = basePath.split("/").pop()!
	const [fileName, ...extensions] = fileNameWithExtensions.split(".")
	const url = `${filePath}/${fileName}${suffix}.${extensions.join(".")}`

	const res = await fetch(url)
	const maybeCompressedData = await res.arrayBuffer()
	const buffer = new Uint8Array(maybeCompressedData)

	const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b && buffer[2] === 0x08
	if (isGzip) {
		return pako.ungzip(buffer).buffer
	}
	return buffer.buffer
}

exec
/bin/zsh -lc "node -p \"require('path').dirname(require.resolve('@aztec/bb.js/package.json'))\"" in (project root)
 exited 1 in 0ms:
node:internal/modules/cjs/loader:1451
  throw err;
  ^

Error: Cannot find module '@aztec/bb.js/package.json'
Require stack:
- (project root)/[eval]
    at Module._resolveFilename (node:internal/modules/cjs/loader:1448:15)
    at require.resolve (node:internal/modules/helpers:163:19)
    at [eval]:1:33
    at runScriptInThisContext (node:internal/vm:219:10)
    at node:internal/process/execution:451:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:449:60)
    at evalFunction (node:internal/process/execution:283:30)
    at evalTypeScript (node:internal/process/execution:295:3)
    at node:internal/main/eval_string:71:3 {
  code: 'MODULE_NOT_FOUND',
  requireStack: [ '(project root)/[eval]' ]
}

Node.js v24.13.1

exec
/bin/zsh -lc "rg -n \"resolve.*dirs|dirs.*map|normalize.*dirs|globs.*dirs|tinyglobby|fast-glob|pathe|resolve\\(\" packages/extension/node_modules/unplugin-vue-components/dist packages/extension/node_modules/unplugin-auto-import/dist -S" in (project root)
 succeeded in 0ms:
packages/extension/node_modules/unplugin-vue-components/dist/utils-BoXu-4gQ.js:1443:	const { resolvedDirs, directoryAsNamespace, globalNamespaces, collapseSamePrefixes, root } = options;
packages/extension/node_modules/unplugin-vue-components/dist/utils-BoXu-4gQ.js:1446:	for (const dir of resolvedDirs) if (parsedFilePath.dir.startsWith(dir)) {
packages/extension/node_modules/unplugin-vue-components/dist/utils-8UQ22cuO.cjs:1472:	const { resolvedDirs, directoryAsNamespace, globalNamespaces, collapseSamePrefixes, root } = options;
packages/extension/node_modules/unplugin-vue-components/dist/utils-8UQ22cuO.cjs:1475:	for (const dir of resolvedDirs) if (parsedFilePath.dir.startsWith(dir)) {
packages/extension/node_modules/unplugin-auto-import/dist/src-CZGMhDR1.mjs:8:import { builtinPresets, createUnimport, normalizeScanDirs, resolvePreset } from "unimport";
packages/extension/node_modules/unplugin-auto-import/dist/src-CZGMhDR1.mjs:676:		const resolved = await (typeof resolver === "function" ? resolver(name) : resolver.resolve(name));
packages/extension/node_modules/unplugin-auto-import/dist/src-CZGMhDR1.mjs:765:		if (!imports.length && !resolvers.length && !(dirs === null || dirs === void 0 ? void 0 : dirs.length)) console.warn("[auto-import] plugin installed but no imports has defined, see https://github.com/antfu/unplugin-auto-import#configurations for configurations");
packages/extension/node_modules/unplugin-auto-import/dist/src-CZGMhDR1.mjs:780:	const dts = preferDTS === false ? false : preferDTS === true ? resolve(root, "auto-imports.d.ts") : resolve(root, preferDTS);
packages/extension/node_modules/unplugin-auto-import/dist/src-CZGMhDR1.mjs:893:	].filter(isString).map((path) => resolve(root, path));
packages/extension/node_modules/unplugin-auto-import/dist/src-CZGMhDR1.mjs:894:	const normalizedDirPaths = (dirs === null || dirs === void 0 ? void 0 : dirs.length) ? dirs.flatMap((dir) => normalizeScanDirs([dir], {
packages/extension/node_modules/unplugin-auto-import/dist/src-CZGMhDR1.mjs:985:				if (ctx.normalizedDirPaths.some((dirPath) => pm.isMatch(normalizedFilePath, dirPath.glob))) await ctx.scanDirs();
packages/extension/node_modules/unplugin-vue-components/dist/types-rC3290ja.d.ts:208:type ResolvedOptions = Omit<Required<Options>, 'resolvers' | 'extensions' | 'dirs' | 'globalComponentsDeclaration'> & {
packages/extension/node_modules/unplugin-vue-components/dist/types-rC3290ja.d.ts:212:  resolvedDirs: string[];
packages/extension/node_modules/unplugin-vue-components/dist/types-DSJ5r-ta.d.cts:208:type ResolvedOptions = Omit<Required<Options>, 'resolvers' | 'extensions' | 'dirs' | 'globalComponentsDeclaration'> & {
packages/extension/node_modules/unplugin-vue-components/dist/types-DSJ5r-ta.d.cts:212:  resolvedDirs: string[];
packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js:11:import { globSync } from "tinyglobby";
packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js:206:	return slash(`${excludeReg.test(glob) ? "!" : ""}${resolve(root, glob.replace(excludeReg, ""))}`);
packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js:214:		resolved.resolvedDirs = [];
packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js:217:		resolved.dirs = toArray(resolved.dirs);
packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js:218:		const globs = resolved.dirs.map((i) => resolveGlobsExclude(root, i));
packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js:219:		resolved.resolvedDirs = globs.filter((i) => !i.startsWith("!"));
packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js:236:	resolved.dts = !resolved.dts ? false : resolve(root, typeof resolved.dts === "string" ? resolved.dts : "components.d.ts");
packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js:602:			const result = await resolver.resolve(type === "directive" ? name.slice(DIRECTIVE_IMPORT_PREFIX.length) : name);
packages/extension/node_modules/unplugin-vue-components/dist/src-DAvVDVLg.cjs:20:let tinyglobby = require("tinyglobby");
packages/extension/node_modules/unplugin-vue-components/dist/src-DAvVDVLg.cjs:21:tinyglobby = require_utils.__toESM(tinyglobby);
packages/extension/node_modules/unplugin-vue-components/dist/src-DAvVDVLg.cjs:177:	const files = (0, tinyglobby.globSync)(ctx.options.globs, {
packages/extension/node_modules/unplugin-vue-components/dist/src-DAvVDVLg.cjs:225:		resolved.resolvedDirs = [];
packages/extension/node_modules/unplugin-vue-components/dist/src-DAvVDVLg.cjs:228:		resolved.dirs = require_utils.toArray(resolved.dirs);
packages/extension/node_modules/unplugin-vue-components/dist/src-DAvVDVLg.cjs:229:		const globs = resolved.dirs.map((i) => resolveGlobsExclude(root, i));
packages/extension/node_modules/unplugin-vue-components/dist/src-DAvVDVLg.cjs:230:		resolved.resolvedDirs = globs.filter((i) => !i.startsWith("!"));
packages/extension/node_modules/unplugin-vue-components/dist/src-DAvVDVLg.cjs:340:	const { walk } = await Promise.resolve().then(() => require("./src-BTwFq3T3.cjs"));
packages/extension/node_modules/unplugin-vue-components/dist/src-DAvVDVLg.cjs:613:			const result = await resolver.resolve(type === "directive" ? name.slice(require_utils.DIRECTIVE_IMPORT_PREFIX.length) : name);
packages/extension/node_modules/unplugin-auto-import/dist/src-BIqvdKAp.cjs:706:		const resolved = await (typeof resolver === "function" ? resolver(name) : resolver.resolve(name));
packages/extension/node_modules/unplugin-auto-import/dist/src-BIqvdKAp.cjs:795:		if (!imports.length && !resolvers.length && !(dirs === null || dirs === void 0 ? void 0 : dirs.length)) console.warn("[auto-import] plugin installed but no imports has defined, see https://github.com/antfu/unplugin-auto-import#configurations for configurations");
packages/extension/node_modules/unplugin-auto-import/dist/src-BIqvdKAp.cjs:924:	const normalizedDirPaths = (dirs === null || dirs === void 0 ? void 0 : dirs.length) ? dirs.flatMap((dir) => (0, unimport.normalizeScanDirs)([dir], {
packages/extension/node_modules/unplugin-auto-import/dist/src-BIqvdKAp.cjs:1015:				if (ctx.normalizedDirPaths.some((dirPath) => picomatch.default.isMatch(normalizedFilePath, dirPath.glob))) await ctx.scanDirs();

exec
/bin/zsh -lc "node -e \"const fs=require('fs'); for (const p of ['packages/extension/node_modules/unplugin-vue-components/dist/index.js','packages/extension/node_modules/unplugin-auto-import/dist/src-*.js']) console.log(p, fs.existsSync(p));\"" in (project root)
 succeeded in 0ms:
packages/extension/node_modules/unplugin-vue-components/dist/index.js true
packages/extension/node_modules/unplugin-auto-import/dist/src-*.js false

exec
/bin/zsh -lc "ls packages/extension/node_modules/unplugin-vue-components/dist && printf '\\n---\\n' && ls packages/extension/node_modules/unplugin-auto-import/dist" in (project root)
 succeeded in 0ms:
esbuild.cjs
esbuild.d.cts
esbuild.d.ts
esbuild.js
index.cjs
index.d.cts
index.d.ts
index.js
nuxt.cjs
nuxt.d.cts
nuxt.d.ts
nuxt.js
resolvers.cjs
resolvers.d.cts
resolvers.d.ts
resolvers.js
rolldown.cjs
rolldown.d.cts
rolldown.d.ts
rolldown.js
rollup.cjs
rollup.d.cts
rollup.d.ts
rollup.js
rspack.cjs
rspack.d.cts
rspack.d.ts
rspack.js
src-BTwFq3T3.cjs
src-D2-JfLYq.js
src-DAvVDVLg.cjs
src-bfjkatac.js
types-CBTc19th.cjs
types-DQoXDiso.js
types-DSJ5r-ta.d.cts
types-rC3290ja.d.ts
types.cjs
types.d.cts
types.d.ts
types.js
utils-8UQ22cuO.cjs
utils-BoXu-4gQ.js
vite.cjs
vite.d.cts
vite.d.ts
vite.js
webpack.cjs
webpack.d.cts
webpack.d.ts
webpack.js

---
astro.cjs
astro.d.cts
astro.d.mts
astro.mjs
esbuild.cjs
esbuild.d.cts
esbuild.d.mts
esbuild.mjs
index.cjs
index.d.cts
index.d.mts
index.mjs
nuxt.cjs
nuxt.d.cts
nuxt.d.mts
nuxt.mjs
rolldown.cjs
rolldown.d.cts
rolldown.d.mts
rolldown.mjs
rollup.cjs
rollup.d.cts
rollup.d.mts
rollup.mjs
rspack.cjs
rspack.d.cts
rspack.d.mts
rspack.mjs
src-BIqvdKAp.cjs
src-CZGMhDR1.mjs
types-BKXEFPVO.d.cts
types-yRPzhWtG.d.mts
types.cjs
types.d.cts
types.d.mts
types.mjs
vite.cjs
vite.d.cts
vite.d.mts
vite.mjs
webpack.cjs
webpack.d.cts
webpack.d.mts
webpack.mjs

exec
/bin/zsh -lc "sed -n '1438,1452p' packages/extension/node_modules/unplugin-vue-components/dist/utils-BoXu-4gQ.js" in (project root)
exec
/bin/zsh -lc "sed -n '206,240p' packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js && printf '\\n---\\n' && sed -n '888,930p' packages/extension/node_modules/unplugin-auto-import/dist/src-CZGMhDR1.mjs" in (project root)
 succeeded in 0ms:
	})];
	if (sideEffects) toArray(sideEffects).forEach((i) => imports.push(stringifyImport(i)));
	return imports.join(";");
}
function getNameFromFilePath(filePath, options) {
	const { resolvedDirs, directoryAsNamespace, globalNamespaces, collapseSamePrefixes, root } = options;
	const parsedFilePath = parse(slash(filePath));
	let strippedPath = "";
	for (const dir of resolvedDirs) if (parsedFilePath.dir.startsWith(dir)) {
		strippedPath = parsedFilePath.dir.slice(dir.length);
		break;
	}
	let folders = strippedPath.slice(1).split("/").filter(Boolean);
	let filename = parsedFilePath.name;
	if (filename === "index" && !directoryAsNamespace) {

 succeeded in 0ms:
	return slash(`${excludeReg.test(glob) ? "!" : ""}${resolve(root, glob.replace(excludeReg, ""))}`);
}
function resolveOptions(options, root) {
	const resolved = Object.assign({}, defaultOptions, options);
	resolved.resolvers = normalizeResolvers(resolved.resolvers);
	resolved.extensions = toArray(resolved.extensions);
	if (resolved.globs) {
		resolved.globs = toArray(resolved.globs).map((glob) => resolveGlobsExclude(root, glob));
		resolved.resolvedDirs = [];
	} else {
		const extsGlob = resolved.extensions.length === 1 ? resolved.extensions : `{${resolved.extensions.join(",")}}`;
		resolved.dirs = toArray(resolved.dirs);
		const globs = resolved.dirs.map((i) => resolveGlobsExclude(root, i));
		resolved.resolvedDirs = globs.filter((i) => !i.startsWith("!"));
		resolved.globs = globs.map((i) => {
			let prefix = "";
			if (i.startsWith("!")) {
				prefix = "!";
				i = i.slice(1);
			}
			return resolved.deep ? prefix + escapeSpecialChars(slash(join(i, `**/*.${extsGlob}`))) : prefix + escapeSpecialChars(slash(join(i, `*.${extsGlob}`)));
		});
		if (!resolved.extensions.length) throw new Error("[unplugin-vue-components] `extensions` option is required to search for components");
	}
	resolved.globsExclude = toArray(resolved.globsExclude || []).map((i) => resolveGlobsExclude(root, i));
	resolved.globs = resolved.globs.filter((i) => {
		if (!i.startsWith("!")) return true;
		resolved.globsExclude.push(i.slice(1));
		return false;
	});
	resolved.dts = !resolved.dts ? false : resolve(root, typeof resolved.dts === "string" ? resolved.dts : "components.d.ts");
	if (!resolved.types && resolved.dts) resolved.types = detectTypeImports();
	resolved.types = resolved.types || [];
	resolved.root = root;
	resolved.version = resolved.version ?? getVueVersion(root);

---
	const configFilePaths = [
		dts,
		eslintrc.filepath,
		biomelintrc.filepath,
		dumpUnimportItems
	].filter(isString).map((path) => resolve(root, path));
	const normalizedDirPaths = (dirs === null || dirs === void 0 ? void 0 : dirs.length) ? dirs.flatMap((dir) => normalizeScanDirs([dir], {
		...dirsScanOptions,
		cwd: root
	})) : [];
	return {
		root,
		dirs,
		filter,
		scanDirs,
		writeConfigFiles,
		writeConfigFilesThrottled,
		transform,
		generateDTS,
		generateESLint,
		unimport,
		configFilePaths,
		normalizedDirPaths
	};
}
async function flattenImports(map) {
	return (await Promise.all(toArray(map).map(async (definition) => {
		if (typeof definition === "string") {
			if (!presets[definition]) throw new Error(`[auto-import] preset ${definition} not found`);
			const preset = presets[definition];
			definition = typeof preset === "function" ? preset() : preset;
		}
		if ("from" in definition && "imports" in definition) return await resolvePreset(definition);
		else {
			const resolved = [];
			for (const mod of Object.keys(definition)) for (const id of definition[mod]) {
				const meta = { from: mod };
				if (Array.isArray(id)) {
					meta.name = id[0];
					meta.as = id[1];
				} else {
					meta.name = id;
					meta.as = id;

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/runtime.ts" in (project root)
 succeeded in 0ms:
/**
 * Wallet composition root.
 *
 * `createWalletRuntime(deps)` returns a handle that can start/stop the full
 * service graph. Everything that touches the Chrome / WASM / filesystem world
 * flows in through `deps`, so tests can construct a runtime with fakes and
 * inspect/exercise the graph without loading the MV3 shell.
 *
 * The shell (src/wallet/index.ts) is now a thin wiring layer: instantiate
 * real adapters and call `createWalletRuntime(...).start()`.
 *
 * Dependencies are explicit. They are NOT module-level globals here; any
 * side effect the runtime has on the outside world goes through a port.
 */

import { BarretenbergSync } from "@aztec/bb.js"
import type { BrowserApi, ClockPort, TimerHandle } from "@/core/ports"
import { ServiceCollection } from "./base"
import type { ConfigStore } from "./config"
import { LogLevel, type LoggerStore } from "./logger"
import { AccountService } from "./services/account/service"
import { AccountStateService } from "./services/account-state/service"
import { AuthRegistryService } from "./services/auth-registry/service"
import { ConfigService } from "./services/config/service"
import { ContactService } from "./services/contact/service"
import { DappInteractionService } from "./services/dapp-interaction/service"
import { DappSessionService } from "./services/dapp-session/service"
import { ExecutionService } from "./services/execution/service"
import { FpcService } from "./services/fpc/service"
import { LogViewerService } from "./services/log-viewer/service"
import { LoggerService } from "./services/logger/service"
import { NetworkService } from "./services/network/service"
import { NoteService } from "./services/note/service"
import { OperationJournalService } from "./services/operation-journal/service"
import { PasskeyService } from "./services/passkey/service"
import { ProfileService } from "./services/profile/service"
import { TaskService } from "./services/task/service"
import { TokenService } from "./services/token/service"
import { TokenBalanceService } from "./services/token-balance/service"
import { TransactionService } from "./services/transaction/service"
import { WindowManager } from "./services/window-manager/window-manager"
import { initWalletSdkHandler } from "./services/wallet-sdk/background"
import { runStorageMigration } from "./storage/migrate"
import { getErrorMessage } from "./utils/errors"

/** Shell-supplied dependencies. All I/O goes through ports on this object. */
export interface WalletRuntimeDeps {
	browserApi: BrowserApi
	clock: ClockPort
	config: ConfigStore
	logger: LoggerStore
}

/** Handle returned by `createWalletRuntime`. Lifecycle-controlled, not singleton. */
export interface WalletRuntime {
	/** Kick off config load, BB init, migrations, service-graph startup, heartbeat. Idempotent. */
	start(): Promise<void>
	/** Stop the heartbeat. Services are not disposed (no mechanism yet). */
	stop(): void
	/** Exposed so shell code + tests can inspect / drive the graph. */
	readonly services: ServiceCollection
}

/** Heartbeat cadence — matches the previous MV3 keepalive cadence (see AUDIT notes). */
const HEARTBEAT_INTERVAL_MS = 10_000

/** Uninstall URL. Matches nulo.sh brand; documented in SECURITY.md. */
const UNINSTALL_URL = "https://nulo.sh/forms/uninstall"

export function createWalletRuntime(deps: WalletRuntimeDeps): WalletRuntime {
	const { browserApi, clock, config, logger } = deps
	const services = new ServiceCollection()
	let heartbeatHandle: TimerHandle | undefined
	let started = false

	const start = async (): Promise<void> => {
		if (started) return
		started = true

		// Uninstall URL comes first — zero-cost and covers the user experience
		// even if the rest of startup fails.
		try {
			await browserApi.runtime.setUninstallURL(UNINSTALL_URL)
		} catch (error) {
			logger.log("wallet", LogLevel.Warn, "Failed to set uninstall URL", getErrorMessage(error))
		}

		// Config + Barretenberg can load in parallel — neither depends on the other.
		await Promise.all([
			config.load().then(() => logger.log("wallet", LogLevel.Info, "Config loaded")),
			BarretenbergSync.initSingleton({ wasmPath: process.env.BB_WASM_PATH }).then(() =>
				logger.log("wallet", LogLevel.Info, "Barretenberg initialized"),
			),
		])

		// Destructive storage migration (version-gated) must run before any
		// service reads storage. Older shapes get wiped; profiles/passkeys preserved.
		await runStorageMigration((msg) => logger.log("wallet", LogLevel.Info, msg))

		// Service graph. Services migrated to ports accept `browserApi`;
		// remaining services still reach into chrome.* directly until their
		// migration PR lands. Adding in consistent order — actual startup
		// ordering is still concurrent (ServiceCollection.start) pending M1.6.
		services.add(new AccountService(logger))
		services.add(new AccountStateService(logger))
		services.add(new AuthRegistryService(logger))
		services.add(new ConfigService(config, logger))
		const windowManager = new WindowManager(browserApi.windows, clock, logger)
		services.add(new ContactService(logger, browserApi))
		services.add(new DappInteractionService(logger, windowManager))
		services.add(new DappSessionService(logger))
		services.add(new ExecutionService(logger))
		services.add(new FpcService(logger))
		services.add(new LogViewerService(logger))
		services.add(new LoggerService(logger))
		services.add(new NetworkService(logger))
		services.add(new NoteService(logger))
		services.add(new OperationJournalService(logger, browserApi))
		services.add(new ProfileService(config, logger))
		services.add(new TaskService(logger))
		services.add(new TokenService(logger))
		services.add(new TokenBalanceService(logger))
		services.add(new TransactionService(logger))
		services.add(new PasskeyService(logger, windowManager))

		await services.start()
		logger.log("wallet", LogLevel.Info, "Services started")

		// Wallet-sdk protocol handler (discovery, key exchange, encrypted channel).
		// Still reaches for chrome.runtime.onMessage internally; will be
		// port-migrated alongside its own refactor.
		initWalletSdkHandler(services, logger)

		// Heartbeat — keeps MV3 service worker alive long enough for cross-SW
		// calls. Routed through browserApi.storage + clock for testability.
		heartbeatHandle = clock.setInterval(() => {
			browserApi.storage.session
				.set({ "nulo:liveness": clock.now() })
				.catch((error) => logger.log("wallet", LogLevel.Error, "Heartbeat failed", getErrorMessage(error)))
		}, HEARTBEAT_INTERVAL_MS)
	}

	const stop = (): void => {
		if (heartbeatHandle !== undefined) {
			clock.clearInterval(heartbeatHandle)
			heartbeatHandle = undefined
		}
	}

	return {
		start,
		stop,
		get services() {
			return services
		},
	}
}

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/core/ports/browser-api.ts && printf '\\n---ADAPTER---\\n' && sed -n '1,260p' packages/extension/src/core/adapters/chrome-browser-api.ts" in (project root)
exec
/bin/zsh -lc "rg -n \"new EntityStorage<|new ValueStorage<|StorageType\\.(Local|Session)\" packages/extension/src/wallet/services packages/extension/src/wallet/config packages/extension/src/wallet/storage -S" in (project root)
 succeeded in 0ms:
/**
 * Composite of every browser-side port. Services take this as a single
 * dependency instead of four separate ones, and the real implementation
 * (`RealChromeBrowserApi`) or test fake (`FakeBrowserApi`) is swapped as
 * one unit at the composition root.
 */

import type { AlarmsPort } from "./alarms-port"
import type { RuntimePort } from "./runtime-port"
import type { StoragePort } from "./storage-port"
import type { WindowPort } from "./window-port"

export interface BrowserApi {
	storage: StoragePort
	runtime: RuntimePort
	windows: WindowPort
	alarms: AlarmsPort
}

---ADAPTER---
/**
 * Real-Chrome implementation of BrowserApi. Wraps chrome.{storage, runtime,
 * windows, alarms}. Tests substitute FakeBrowserApi (see src/core/testing/).
 *
 * Notes on MV3 semantics carried through:
 *
 * 1. chrome.runtime.lastError is only meaningful inside a callback. The
 *    RuntimePort.lastError getter reflects the current value at read time;
 *    adapters don't cache it.
 * 2. chrome.storage.local.onChanged / .session.onChanged are area-specific
 *    listeners; we use those instead of the global onChanged so consumers
 *    only see changes in their area.
 * 3. chrome.alarms requires the "alarms" permission in the manifest.
 *    Instantiation is fine without it; method calls will throw.
 * 4. chrome.windows works without a permission declaration.
 */

import type {
	AlarmCreateOptions,
	AlarmEvent,
	AlarmsPort,
	BrowserApi,
	CreatedWindow,
	CreateWindowOptions,
	MessageListener,
	MessagePortLike,
	RuntimePort,
	StorageArea,
	StorageChanges,
	StorageEntries,
	StoragePort,
	Unsubscribe,
	WindowPort,
} from "@/core/ports"

class ChromeStorageAreaAdapter implements StorageArea {
	public constructor(private readonly area: chrome.storage.StorageArea) {}

	public async get(keys: string | string[] | null): Promise<StorageEntries> {
		// chrome.storage.StorageArea.get's type overloads don't include
		// `null` for "all entries" in every @types/chrome release; call with
		// no args instead when requesting everything.
		const area = this.area as unknown as { get(k?: string | string[]): Promise<StorageEntries> }
		return keys === null ? await area.get() : await area.get(keys)
	}

	public async set(entries: StorageEntries): Promise<void> {
		await this.area.set(entries)
	}

	public async remove(keys: string | string[]): Promise<void> {
		await this.area.remove(keys)
	}

	public async clear(): Promise<void> {
		await this.area.clear()
	}

	public onChange(listener: (changes: StorageChanges) => void): Unsubscribe {
		const wrapped = (changes: { [key: string]: chrome.storage.StorageChange }) => {
			listener(changes as StorageChanges)
		}
		this.area.onChanged.addListener(wrapped)
		return () => this.area.onChanged.removeListener(wrapped)
	}
}

class ChromeStorageAdapter implements StoragePort {
	public readonly local: StorageArea = new ChromeStorageAreaAdapter(chrome.storage.local)
	public readonly session: StorageArea = new ChromeStorageAreaAdapter(chrome.storage.session)
}

function adaptPort(port: chrome.runtime.Port): MessagePortLike {
	return {
		name: port.name,
		postMessage: (message) => port.postMessage(message),
		disconnect: () => port.disconnect(),
		onMessage: (listener) => {
			const wrapped = (msg: unknown) => listener(msg)
			port.onMessage.addListener(wrapped)
			return () => port.onMessage.removeListener(wrapped)
		},
		onDisconnect: (listener) => {
			port.onDisconnect.addListener(listener)
			return () => port.onDisconnect.removeListener(listener)
		},
	}
}

class ChromeRuntimeAdapter implements RuntimePort {
	public async sendMessage(message: unknown): Promise<unknown> {
		return await chrome.runtime.sendMessage(message)
	}

	public onMessage(listener: MessageListener): Unsubscribe {
		const wrapped = (
			message: unknown,
			sender: chrome.runtime.MessageSender,
			sendResponse: (response: unknown) => void,
		): boolean | undefined => {
			const result = listener(message, sender)
			if (result instanceof Promise) {
				result.then(sendResponse).catch(() => sendResponse(undefined))
				return true
			}
			sendResponse(result)
			return undefined
		}
		chrome.runtime.onMessage.addListener(wrapped)
		return () => chrome.runtime.onMessage.removeListener(wrapped)
	}

	public connect(options: { name: string }): MessagePortLike {
		// @types/chrome version disagreement on connect() overloads across versions.
		const connect = chrome.runtime.connect as unknown as (opts: { name: string }) => chrome.runtime.Port
		return adaptPort(connect(options))
	}

	public onConnect(listener: (port: MessagePortLike) => void): Unsubscribe {
		const wrapped = (port: chrome.runtime.Port) => listener(adaptPort(port))
		chrome.runtime.onConnect.addListener(wrapped)
		return () => chrome.runtime.onConnect.removeListener(wrapped)
	}

	public getURL(path: string): string {
		return chrome.runtime.getURL(path)
	}

	public onInstalled(listener: (details: { reason: string; previousVersion?: string }) => void): Unsubscribe {
		const wrapped = (details: { reason: string; previousVersion?: string }) =>
			listener({ reason: details.reason, previousVersion: details.previousVersion })
		chrome.runtime.onInstalled.addListener(wrapped)
		return () => chrome.runtime.onInstalled.removeListener(wrapped)
	}

	public get lastError(): { message: string } | undefined {
		const err = (chrome.runtime as unknown as { lastError?: { message?: string } }).lastError
		if (!err) return undefined
		return { message: err.message ?? "unknown error" }
	}

	public async setUninstallURL(url: string): Promise<void> {
		await chrome.runtime.setUninstallURL(url)
	}

	public async getContexts(filter: {
		contextTypes?: string[]
		documentUrls?: string[]
	}): Promise<Array<{ contextId: string; contextType: string; documentUrl?: string }>> {
		// chrome.runtime.getContexts is MV3 / Chrome 116+; we rely on it for
		// offscreen supervision. The runtime.d.ts type is looser than ours.
		type GetContextsFn = (f: unknown) => Promise<Array<{ contextId: string; contextType: string; documentUrl?: string }>>
		const runtime = chrome.runtime as unknown as { getContexts?: GetContextsFn }
		if (!runtime.getContexts) {
			throw new Error("chrome.runtime.getContexts is unavailable; Chrome 116+ required")
		}
		return await runtime.getContexts(filter)
	}
}

class ChromeWindowsAdapter implements WindowPort {
	public async create(options: CreateWindowOptions): Promise<CreatedWindow> {
		const created = await chrome.windows.create(options)
		return { id: created?.id }
	}

	public onRemoved(listener: (windowId: number) => void): Unsubscribe {
		// @types/chrome for chrome.windows.onRemoved.addListener signature
		// varies across releases; the runtime API is (callback[, filter]).
		const onRemoved = chrome.windows.onRemoved as unknown as {
			addListener(cb: (windowId: number) => void): void
			removeListener(cb: (windowId: number) => void): void
		}
		onRemoved.addListener(listener)
		return () => onRemoved.removeListener(listener)
	}

	public async remove(windowId: number): Promise<void> {
		await chrome.windows.remove(windowId)
	}
}

class ChromeAlarmsAdapter implements AlarmsPort {
	public async create(name: string, options: AlarmCreateOptions): Promise<void> {
		await chrome.alarms.create(name, options)
	}

	public async clear(name: string): Promise<boolean> {
		return await chrome.alarms.clear(name)
	}

	public onAlarm(listener: (alarm: AlarmEvent) => void): Unsubscribe {
		const wrapped = (alarm: chrome.alarms.Alarm) => listener({ name: alarm.name, scheduledTime: alarm.scheduledTime })
		chrome.alarms.onAlarm.addListener(wrapped)
		return () => chrome.alarms.onAlarm.removeListener(wrapped)
	}
}

export class RealChromeBrowserApi implements BrowserApi {
	public readonly storage: StoragePort = new ChromeStorageAdapter()
	public readonly runtime: RuntimePort = new ChromeRuntimeAdapter()
	public readonly windows: WindowPort = new ChromeWindowsAdapter()
	public readonly alarms: AlarmsPort = new ChromeAlarmsAdapter()
}

 succeeded in 0ms:
packages/extension/src/wallet/config/store.ts:10:	private readonly storage = new ValueStorage<Config>("nulo:config", StorageType.Local)
packages/extension/src/wallet/storage/simple_storage.ts:7:	constructor(root: string, type: StorageType = StorageType.Local) {
packages/extension/src/wallet/storage/simple_storage.ts:9:		this.storage = type === StorageType.Local ? chrome.storage.local : chrome.storage.session
packages/extension/src/wallet/storage/entity_storage.ts:26:	public constructor(root: string, areaOrType: StorageType | StorageArea = StorageType.Local) {
packages/extension/src/wallet/storage/entity_storage.ts:29:			this.storage = areaOrType === StorageType.Local ? chrome.storage.local : chrome.storage.session
packages/extension/src/wallet/storage/value-storage.ts:25:	constructor(root: string, areaOrType: StorageType | StorageArea = StorageType.Local) {
packages/extension/src/wallet/storage/value-storage.ts:28:			this.storage = areaOrType === StorageType.Local ? chrome.storage.local : chrome.storage.session
packages/extension/src/wallet/services/auth-registry/service.ts:28:	private readonly authwits = new EntityStorage<Authwit>("nulo:core:auth-registry", StorageType.Local)
packages/extension/src/wallet/services/auth-registry/service.ts:29:	private readonly statuses = new EntityStorage<boolean>("nulo:core:auth-registry-enabled", StorageType.Local)
packages/extension/src/wallet/services/fpc/service.ts:34:	private readonly storage = new EntityStorage<FpcInfo>("nulo:core:fpcs", StorageType.Local)
packages/extension/src/wallet/services/contact/service.ts:38:			? new EntityStorage<Contact>("nulo:core:contacts", browserApi.storage.local)
packages/extension/src/wallet/services/contact/service.ts:39:			: new EntityStorage<Contact>("nulo:core:contacts", StorageType.Local)
packages/extension/src/wallet/services/network/service.ts:25:	private readonly storage = new EntityStorage<Network>("nulo:core:networks", StorageType.Local)
packages/extension/src/wallet/services/transaction/service.ts:36:	private readonly txs = new EntityStorage<Tx>("nulo:core:txs", StorageType.Local)
packages/extension/src/wallet/services/token-balance/balance-repository.ts:7: * - `StorageType.Local`.
packages/extension/src/wallet/services/token-balance/balance-repository.ts:21:		this.storage = new EntityStorage<TokenBalanceRaw>("nulo:core:token-balances", StorageType.Local)
packages/extension/src/wallet/services/token/service.ts:39:	private readonly tokens = new EntityStorage<Token>("nulo:core:tokens", StorageType.Local)
packages/extension/src/wallet/services/dapp-session/service.ts:29:	private readonly storage = new EntityStorage<DappSession>("nulo:core:dappSessions", StorageType.Local)
packages/extension/src/wallet/services/profile/repository.ts:45:			? new EntityStorage<Profile>(PROFILE_STORAGE_ROOT, browserApi.storage.local)
packages/extension/src/wallet/services/profile/repository.ts:46:			: new EntityStorage<Profile>(PROFILE_STORAGE_ROOT, StorageType.Local)
packages/extension/src/wallet/services/account/service.ts:22:	private readonly storage = new EntityStorage<Account>("nulo:core:accounts", StorageType.Local)
packages/extension/src/wallet/services/profile/session-manager.ts:112:			? new ValueStorage<Session>(SESSION_STORAGE_ROOT, browserApi.storage.session)
packages/extension/src/wallet/services/profile/session-manager.ts:113:			: new ValueStorage<Session>(SESSION_STORAGE_ROOT, StorageType.Session)
packages/extension/src/wallet/services/operation-journal/service.ts:43:			? new EntityStorage<OperationRecord>("nulo:journal", browserApi.storage.session)
packages/extension/src/wallet/services/operation-journal/service.ts:44:			: new EntityStorage<OperationRecord>("nulo:journal", StorageType.Session)

web search: 
web search: 
web search: 
web search: https://crxjs.dev/concepts/pages/
web search: 
web search: https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md
web search: 
web search: 'tsConfig' in https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md
exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/config/store.ts && printf '\\n---PROFILE REPO---\\n' && sed -n '1,220p' packages/extension/src/wallet/services/profile/repository.ts && printf '\\n---SESSION MANAGER---\\n' && sed -n '1,240p' packages/extension/src/wallet/services/profile/session-manager.ts" in (project root)
 succeeded in 0ms:
import { StorageType, ValueStorage } from "@/wallet/storage"
import { Lock } from "@/wallet/utils"
import { EventHandler } from "@/wallet/utils/event-handler"
import { type IConfigStore, Config, type ConfigProp, type ConfigKey } from "."

export class ConfigStore implements IConfigStore {
	public readonly onUpdate = new EventHandler<ConfigProp>()

	private readonly lock = new Lock()
	private readonly storage = new ValueStorage<Config>("nulo:config", StorageType.Local)
	private config = new Config()

	public get props(): ConfigProp[] {
		return Object.entries(this.config).map(([key, value]) => ({ key, value }) as ConfigProp)
	}

	public async load() {
		const storedConfig = await this.storage.get()
		if (storedConfig && typeof storedConfig === "object") {
			await this.apply(storedConfig)
		}
	}

	public get<TKey extends ConfigKey>(key: TKey): Config[TKey] {
		return this.config[key]
	}

	public async set<TKey extends ConfigKey>(key: TKey, value: Config[TKey]) {
		try {
			await this.lock.enter()
			if (this.config[key] === value) {
				return
			}
			this.config[key] = value
			this.onUpdate.invoke({ key, value } as ConfigProp)
			await this.storage.set(this.config)
		} finally {
			this.lock.leave()
		}
	}

	public async reset() {
		await this.apply(new Config())
	}

	private async apply(config: Config) {
		const src = config as unknown as Record<string, unknown>
		const dst = this.config as unknown as Record<string, unknown>
		for (const key of Object.keys(dst)) {
			if (key in src && typeof src[key] === typeof dst[key] && src[key] !== dst[key]) {
				dst[key] = src[key]
				this.onUpdate.invoke({ key, value: dst[key] } as ConfigProp)
			}
		}
		await this.storage.set(this.config)
	}
}

---PROFILE REPO---
/**
 * ProfileRepository — the storage layer for profile records.
 *
 * Extracted from the ProfileService monolith in M2.1-a. Pure CRUD around
 * an `EntityStorage<Profile>`, plus a single helper for the id-generation
 * pattern that was duplicated seven times in the original service.
 *
 * Ownership: this class owns the `nulo:core:profiles` storage root.
 * Nothing else in the codebase should touch that key directly. Changing
 * the key renames every existing profile record on disk — don't.
 *
 * Lock-free by design. The facade (`ProfileService`) is responsible for
 * serializing cross-collaborator operations; this class never reaches
 * for locks, sessions, or crypto. That keeps it trivially unit-testable
 * via `FakeBrowserApi`.
 */

import type { BrowserApi } from "@/core/ports"
import { EntityStorage, StorageType } from "@/wallet/storage"
import { getRandomHex } from "@/wallet/utils"
import type { Profile } from "./spec"

/** Storage root for profile records. Frozen: renaming detaches every
 *  wallet on disk from its profile metadata. */
export const PROFILE_STORAGE_ROOT = "nulo:core:profiles"

/** Length in hex characters of generated profile ids. 8 hex chars ≈
 *  32 bits — collisions are astronomically unlikely for wallet-scale
 *  profile counts but the facade still re-verifies before `set()` (see
 *  `generateUniqueId` JSDoc for the full contract). */
const PROFILE_ID_HEX_LENGTH = 8

export class ProfileRepository {
	private readonly storage: EntityStorage<Profile>

	/**
	 * @param browserApi Optional port for the storage area. Tests pass
	 *        `FakeBrowserApi` so the repository operates against
	 *        in-memory state; the composition root passes the real
	 *        adapter. If omitted, falls back to `chrome.storage.local`
	 *        for legacy SW startup paths.
	 */
	public constructor(browserApi?: BrowserApi) {
		this.storage = browserApi
			? new EntityStorage<Profile>(PROFILE_STORAGE_ROOT, browserApi.storage.local)
			: new EntityStorage<Profile>(PROFILE_STORAGE_ROOT, StorageType.Local)
	}

	/** Returns the profile with the given id, or `undefined`. */
	public get(id: string): Promise<Profile | undefined> {
		return this.storage.get(id)
	}

	/** Returns every profile currently on disk, order-unspecified. */
	public getAll(): Promise<Profile[]> {
		return this.storage.getValues()
	}

	/** `true` iff a profile record exists for the given id. */
	public contains(id: string): Promise<boolean> {
		return this.storage.contains(id)
	}

	/** Upserts `profile` under `id`. */
	public set(id: string, profile: Profile): Promise<void> {
		return this.storage.set(id, profile)
	}

	/** Removes the profile with the given id, if any. */
	public delete(id: string): Promise<void> {
		return this.storage.delete(id)
	}

	/**
	 * Returns a random id that is *not currently* in storage. The
	 * emphasis on "currently" is deliberate: this helper runs without
	 * any lock, so by the time the caller uses the returned id, another
	 * concurrent writer could have claimed it.
	 *
	 * **Contract for callers:** pair every use of `generateUniqueId`
	 * with a locked re-verification before `set()`:
	 *
	 *     const id = await repo.generateUniqueId()     // unlocked
	 *     await facadeLock.enter()
	 *     while (await repo.contains(id)) {            // re-verify
	 *       id = await repo.generateUniqueId()          //   under lock
	 *     }
	 *     await repo.set(id, profile)
	 *     facadeLock.leave()
	 *
	 * This mirrors the existing pattern in `createPasskeyProfile`,
	 * where the WebAuthn prompt between generation and persistence
	 * can't be held under the lock (UI-blocking + 5-minute safety
	 * force-release). Keeping the generator lock-free lets callers
	 * interleave slow external work without inversion risk.
	 *
	 * For facade methods that don't have slow external work between
	 * generation and `set()` (e.g. `createProfile`, `importPassword*`),
	 * it's safe to call `generateUniqueId` inside the lock — the
	 * re-verify becomes a no-op but costs nothing.
	 */
	public async generateUniqueId(): Promise<string> {
		let id: string
		do {
			id = getRandomHex(PROFILE_ID_HEX_LENGTH)
		} while (await this.contains(id))
		return id
	}
}

---SESSION MANAGER---
/**
 * SessionManager — owns the in-memory `ActiveSession` + its persisted
 * `Session` mirror in `chrome.storage.session`.
 *
 * Extracted from ProfileService in M2.1-d. The facade keeps the lock and
 * the RPC surface; this class owns session state and TTL expiry.
 *
 * ## Storage ownership
 *
 * Frozen storage key: `nulo:core:session` in `chrome.storage.session`.
 * Session storage is cleared by the browser when the service-worker's
 * "browser session" ends, but survives MV3 service-worker suspensions —
 * which is the whole point: the popup can reconnect mid-session without
 * re-prompting for the password.
 *
 * The persisted shape (`Session`) is frozen across the ProfileService
 * split; every existing session record on disk was written under this
 * encoding. The in-memory shape (`ActiveSession`) is a superset — it
 * also holds the raw `Fr` master secret, which is NEVER persisted.
 *
 * ## Restore semantics (init-only, silent)
 *
 * `restore(lookup, unseal)` is called exactly once during service init.
 * It re-hydrates `activeSession` from disk without emitting
 * `onActiveProfileChanged`. Emitting at init would fire before any
 * subscriber has attached; subscribers pull the current value via
 * `getActive()` at their own mount time.
 *
 * Restore is also TTL-aware: a session whose `since + ttl` has passed
 * is silently dropped (storage cleaned, no emit — matches the "session
 * expired on reload" UX).
 *
 * ## Wrong-credential / corrupted-ciphertext policy
 *
 * `restore` passes a `unseal` callback that returns `null` on any
 * wrong-credential / corrupted-ciphertext condition. The manager maps
 * that to a silent close, same as TTL expiry. The facade does NOT see
 * an error — there is no UI to surface one to during init.
 *
 * ## Lock-agnostic
 *
 * SessionManager performs no locking of its own. Callers (the facade)
 * run its methods under `ProfileService.lock` when they need
 * serialization with profile CRUD. Init is called before the service
 * announces readiness (`ensureInitialized`), so the lock isn't
 * required there either.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import type { ConfigProp, IConfig } from "@/wallet/config"
import { type ILogger, LogLevel } from "@/wallet/logger"
import { StorageType, ValueStorage } from "@/wallet/storage"
import type { BrowserApi } from "@/core/ports"
import { getErrorMessage } from "@/wallet/utils/errors"
import type { ActiveSession, Profile, ProfileInfo, Session } from "./spec"

const LOG_SOURCE = "SessionManager"

/** Frozen storage root for the session record. */
export const SESSION_STORAGE_ROOT = "nulo:core:session"

/** Callback the facade passes to `restore()` so SessionManager can fetch
 *  the profile named in the persisted session without reaching into
 *  `ProfileRepository` directly — keeps the dependency arrow one-way
 *  (facade → manager, not manager → repo). */
export type SessionProfileLookup = (profileId: string) => Promise<Profile | undefined>

/** Callback the facade passes to `restore()` so SessionManager can
 *  decrypt the master secret for a password profile. Returns `null` on
 *  wrong-credential / corrupted-ciphertext — same contract as
 *  `PasswordSecretBox.unsealWithPasshash`. */
export type SessionSecretUnsealer = (
	passhash: ArrayBuffer,
	profile: Profile & { type: "password" },
) => Promise<Uint8Array<ArrayBuffer> | null>

/** Hook the facade registers at construction so SessionManager can
 *  surface open / close transitions as `onActiveProfileChanged`
 *  events. `undefined` means the active profile cleared. */
export type SessionChangeListener = (profile: ProfileInfo | undefined) => void

export class SessionManager {
	private readonly session: ValueStorage<Session>
	private readonly onChange: SessionChangeListener
	private activeSession?: ActiveSession
	private sessionTtl: number

	/**
	 * @param config      Reactive config — SessionManager subscribes to
	 *                    `sessionTtl` updates so the user toggling the
	 *                    auto-lock timeout takes effect immediately for
	 *                    the *next* TTL check (never shortens the current
	 *                    window retroactively).
	 * @param logger      Wallet-wide logger; used only for debug breadcrumbs
	 *                    + error logging (never throws out of SessionManager).
	 * @param onChange    Callback invoked on open + close transitions. The
	 *                    facade wires this to `emit("onActiveProfileChanged", …)`.
	 * @param browserApi  Optional `BrowserApi` port. Tests pass `FakeBrowserApi`
	 *                    so storage is in-memory. If omitted, falls back to
	 *                    `chrome.storage.session` for legacy SW startup.
	 */
	public constructor(
		config: IConfig,
		private readonly logger: ILogger,
		onChange: SessionChangeListener,
		browserApi?: BrowserApi,
	) {
		this.onChange = onChange
		this.sessionTtl = config.get("sessionTtl")
		config.onUpdate.add(this.onConfigUpdated)
		this.session = browserApi
			? new ValueStorage<Session>(SESSION_STORAGE_ROOT, browserApi.storage.session)
			: new ValueStorage<Session>(SESSION_STORAGE_ROOT, StorageType.Session)
	}

	/** Returns the active session if one exists and has not yet expired.
	 *  TTL-expired sessions are silently closed here — the return is
	 *  always the authoritative view of "is the wallet unlocked right
	 *  now".
	 *
	 *  Async (not sync) deliberately: close() writes to storage, which
	 *  is async. Making this sync would require a fire-and-forget
	 *  close, which drifts persisted-state from in-memory-state. */
	public async getActive(): Promise<ActiveSession | undefined> {
		if (!this.activeSession) {
			return undefined
		}
		if (this.isExpired(this.activeSession.session)) {
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session expired")
			await this.close()
			return undefined
		}
		return this.activeSession
	}

	/** Returns the master secret for the given profile id. Throws
	 *  `"Profile locked"` if no session is active or if the active
	 *  session belongs to a different profile — this is the contract
	 *  every caller downstream (signing, key derivation) relies on. */
	public async getSecret(profileId: string): Promise<Fr> {
		const session = await this.getActive()
		if (session?.session.profile !== profileId) {
			throw new Error("Profile locked")
		}
		return session.secret
	}

	/** Persists + enters the session for `profile`. `passhash` is optional
	 *  (only password profiles persist it, to enable silent restore after
	 *  SW suspension). Emits `onChange(ProfileInfo)` on success.
	 *
	 *  Failures are logged but swallowed — historically `_openSession`
	 *  did the same because a broken chrome.storage write at unlock time
	 *  still leaves the in-memory secret usable for the current popup
	 *  lifetime. We keep that behavior; the facade's test coverage pins
	 *  it. */
	public async open(profile: Profile, secretBuffer: Uint8Array<ArrayBuffer>, passhash?: ArrayBuffer): Promise<void> {
		try {
			const session: Session = {
				profile: profile.id,
				passhash: passhash ? Buffer.from(passhash).toString("base64") : undefined,
				since: Date.now(),
			}
			await this.session.set(session)
			const secret = Fr.fromBuffer(Buffer.from(secretBuffer))
			this.activeSession = { profile, session, secret }
			this.onChange(this.toInfo(profile))
		} catch (error) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to open profile session", getErrorMessage(error))
		}
	}

	/** Clears persisted + in-memory session. Emits `onChange(undefined)`
	 *  iff a session was actually open (idempotent when already closed).
	 *  Safe to call multiple times. */
	public async close(): Promise<void> {
		try {
			await this.session.delete()
			if (this.activeSession) {
				this.activeSession = undefined
				this.onChange(undefined)
			}
		} catch (error) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to close profile session", getErrorMessage(error))
		}
	}

	/** Resets `since` to now, extending the TTL window. No-op when no
	 *  session is active (via the `getActive` guard). Does not emit —
	 *  the UI already has the correct active-profile info. */
	public async refresh(): Promise<void> {
		try {
			const session = await this.getActive()
			if (session) {
				session.session.since = Date.now()
				await this.session.set(session.session)
			}
		} catch (error) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "Failed to refresh profile session", getErrorMessage(error))
		}
	}

	/** Re-enters the active session from persisted storage, if one is
	 *  still valid. Called exactly once by the facade during init.
	 *
	 *  SILENT by design: does NOT invoke `onChange`. Subscribers are not
	 *  yet attached at init time; they query `getActive()` when they
	 *  mount.
	 *
	 *  TTL expiry → silent close.
	 *  Profile no longer exists on disk → silent close.
	 *  Password profile + unseal returns null → silent close.
	 *  Passkey profile → skipped (requires user interaction; lock-screen
	 *  prompts for passkey the next time the popup opens). */
	public async restore(lookup: SessionProfileLookup, unseal: SessionSecretUnsealer): Promise<void> {
		const session = await this.session.get()
		if (!session) {
			return
		}
		if (this.isExpired(session)) {
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session expired")
			await this.silentClose()
			return
		}
		const profile = await lookup(session.profile)
		if (!profile) {
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Session refers wrong profile")
			await this.silentClose()
			return
		}
		if (profile.type === "passkey") {
			// Passkey sessions can't be silently restored — the browser
			// requires a user gesture for WebAuthn `get`. Leave persisted
			// record in place; the popup's lock screen will handle it.
			return
		}
		if (!session.passhash) {
			this.logger.log(LOG_SOURCE, LogLevel.Debug, "Password session missing passhash")
			await this.silentClose()
			return

exec
/bin/zsh -lc "sed -n '1,200p' packages/extension/src/wallet/services/account/service.ts && printf '\\n---NETWORK---\\n' && sed -n '1,160p' packages/extension/src/wallet/services/network/service.ts && printf '\\n---TOKEN BALANCE REPO---\\n' && sed -n '1,160p' packages/extension/src/wallet/services/token-balance/balance-repository.ts" in (project root)
 succeeded in 0ms:
import type { Fr } from "@aztec/foundation/curves/bn254"
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon"
import type { ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service } from "@/wallet/base/background"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { EntityStorage, StorageType } from "@/wallet/storage"
import { array_max, hasIntersectionByKeys } from "@/wallet/utils"
import { EventHandler } from "@/wallet/utils/event-handler"
import { NuloAccount, type IAccountContract } from "./contracts"
import { ACCOUNT_SERVICE_NAME, AccountType, type Account, type Events, type Methods } from "./spec"

export * from "./spec"

export class AccountService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	public static name = ACCOUNT_SERVICE_NAME

	public readonly onAccountAdded = new EventHandler<Account>()
	public readonly onAccountUpdated = new EventHandler<Account>()
	public readonly onAccountDeleted = new EventHandler<Account>()

	private readonly storage = new EntityStorage<Account>("nulo:core:accounts", StorageType.Local)

	private profileService: ProfileService = null!

	public constructor(logger: ILogger) {
		super(ACCOUNT_SERVICE_NAME, logger)
	}

	protected async init(services: ServiceCollection): Promise<void> {
		this.profileService = services.get(ProfileService.name)
		this.profileService.onProfileDeleted.add(this.onProfileDeleted)
	}

	public async getAccounts(profileId: string, chainId: number, all?: boolean): Promise<Account[]> {
		await this.ensureInitialized()
		return (await this.storage.getValues()).filter((x) => x.profileId === profileId && x.chainId === chainId && (all || x.visible))
	}

	public async getAccount(profileId: string, chainId: number, address: string): Promise<Account | undefined> {
		await this.ensureInitialized()
		const account = await this.storage.get(address)
		return account?.profileId === profileId && account.chainId === chainId ? account : undefined
	}

	public async createAccount(profileId: string, chainId: number, type: AccountType, name: string): Promise<Account> {
		await this.ensureInitialized()
		const accounts = (await this.storage.getValues()).filter((x) => x.profileId === profileId && x.chainId === chainId)
		const index = accounts.length > 0 ? array_max(accounts.filter((x) => x.type === type).map((x) => +x.index)) + 1 : 0
		const secret = await this.deriveAccountSecret(profileId, chainId, type, index)
		if (type !== AccountType.Nulo_v1) {
			throw new Error("unsupported account type")
		}
		const address = (await NuloAccount.new(secret, this.logger)).address.toString()
		const account: Account = {
			profileId,
			chainId,
			address,
			index,
			type,
			name,
			visible: true,
		}
		await this.storage.set(address, account)
		this.emit("onAccountAdded", account)
		return account
	}

	public async changeAccountName(profileId: string, chainId: number, address: string, name: string): Promise<Account | undefined> {
		const account = await this.storage.get(address)
		if (account?.profileId !== profileId || account.chainId !== chainId) {
			return undefined
		}
		if (account.name !== name) {
			account.name = name
			await this.storage.set(address, account)
			this.emit("onAccountUpdated", account)
		}
		return account
	}

	public async changeAccountVisibility(
		profileId: string,
		chainId: number,
		address: string,
		visible: boolean,
	): Promise<Account | undefined> {
		const account = await this.storage.get(address)
		if (account?.profileId !== profileId || account.chainId !== chainId) {
			return undefined
		}
		if (account.visible !== visible) {
			account.visible = visible
			await this.storage.set(address, account)
			this.emit("onAccountUpdated", account)
		}
		return account
	}

	public async getAccountContract(profileId: string, chainId: number, address: string): Promise<IAccountContract> {
		await this.ensureInitialized()
		const account = await this.storage.get(address)
		if (account?.profileId !== profileId || account.chainId !== chainId) {
			throw new Error("unknown account address")
		}
		if (account.type !== AccountType.Nulo_v1) {
			throw new Error("unknown account type")
		}
		const secret = await this.deriveAccountSecret(profileId, chainId, account.type, account.index)
		const accountContract: IAccountContract = await NuloAccount.new(secret, this.logger)
		if (accountContract.address.toString() !== address) {
			throw new Error("account address inconsistency")
		}
		return accountContract
	}

	private async deriveAccountSecret(profileId: string, chainId: number, type: number, index: number): Promise<Fr> {
		const master = await this.profileService.getProfileSecret(profileId)
		if (!master) {
			throw new Error("unauthorized")
		}
		return poseidon2Hash([master, chainId, type, index])
	}

	private readonly onProfileDeleted = async (profile: ProfileInfo) => {
		this.logDebug(`profile ${profile.id} deleted, remove related accounts`)
		const accounts = (await this.storage.getValues()).filter((x) => x.profileId === profile.id)
		for (const account of accounts) {
			this.logDebug(`remove account ${account.address}`)
			await this.storage.delete(account.address)
			this.emit("onAccountDeleted", account)
		}
	}

	public async backup(): Promise<Account[]> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}

		return (await this.storage.getValues()).filter((x) => x.profileId === profile.id)
	}

	public async restore(accounts: Account[]): Promise<Restored<Account>[]> {
		await this.ensureInitialized()

		const result: Restored<Account>[] = []

		const hasIntersectionByAddress = hasIntersectionByKeys(await this.storage.getValues(), accounts, ["address"])
		if (hasIntersectionByAddress) throw new Error("Duplicate address")

		for (const account of accounts) {
			try {
				await this.storage.set(account.address, account)
				result.push(account)
			} catch (err) {
				result.push({
					...account,
					restoreError: err instanceof Error ? err.message : err,
				})
			}
		}

		return result
	}
}

---NETWORK---
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service } from "@/wallet/base/background"
import { validateParams } from "@/wallet/base/zod-helpers"
import { AztecNodeFactoryAdapter } from "@/core/adapters/aztec-node-factory-adapter"
import type { NodeFactory } from "@/core/ports/node-factory-port"
import type { ILogger } from "@/wallet/logger"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { EntityStorage, StorageType } from "@/wallet/storage"
import { getRandomHex, Lock } from "@/wallet/utils"
import { EventHandler } from "@/wallet/utils/event-handler"
import { getErrorMessage } from "@/wallet/utils/errors"
import { type Events, type Methods, type Network, NETWORK_SERVICE_NAME, NetworkMethodSchemas, NodeStatus } from "./spec"

export * from "./spec"

export class NetworkService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	public static name = NETWORK_SERVICE_NAME

	public readonly onNetworkAdded = new EventHandler<Network>()
	public readonly onNetworkUpdated = new EventHandler<Network>()
	public readonly onNetworkDeleted = new EventHandler<Network>()
	public readonly onDefaultNetworkChanged = new EventHandler<Network>()

	private readonly storage = new EntityStorage<Network>("nulo:core:networks", StorageType.Local)
	private readonly nodes = new Map<number, AztecNode>()
	private readonly lock: Lock
	private readonly nodeFactory: NodeFactory

	private profileService: ProfileService = null!

	public constructor(logger: ILogger, nodeFactory?: NodeFactory) {
		super(NETWORK_SERVICE_NAME, logger)
		this.lock = new Lock("network", logger)
		this.nodeFactory = nodeFactory ?? new AztecNodeFactoryAdapter()
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)
		this.profileService.onProfileDeleted.add(this.onProfileDeleted)
	}

	public async getOrInitNetworks(): Promise<Network[]> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		try {
			await this.lock.enter()
			const networks = (await this.storage.getValues()).filter((x) => x.profileId === profile.id)
			if (networks.length) {
				return networks
			}

			const defaultNetworks = []
			try {
				const name = "Alpha Mainnet"
				const rpcUrl = "https://aztec-mainnet.drpc.org"
				const chainId = 2934756904 // (1 ^ 2934756905) >>> 0
				defaultNetworks.push(await this._addNetwork(profile.id, name, rpcUrl, chainId, false))
			} catch (error) {
				this.logError("Failed to add 'Alpha Mainnet'", getErrorMessage(error))
			}
			try {
				const name = "Testnet"
				const rpcUrl = "https://rpc.testnet.aztec-labs.com"
				const chainId = 4138294185 // (11155111 ^ 4127419662) >>> 0
				defaultNetworks.push(await this._addNetwork(profile.id, name, rpcUrl, chainId, true))
			} catch (error) {
				this.logError("Failed to add 'Testnet'", getErrorMessage(error))
			}
			try {
				const name = "Devnet"
				const rpcUrl = "https://v4-devnet-3.aztec-labs.com/"
				const chainId = 896946031 // (11155111 ^ 903641544) >>> 0
				defaultNetworks.push(await this._addNetwork(profile.id, name, rpcUrl, chainId, false))
			} catch (error) {
				this.logError("Failed to add 'Devnet'", getErrorMessage(error))
			}
			try {
				const name = "Local Network"
				const rpcUrl = "http://localhost:8080"
				const chainId = 0
				defaultNetworks.push(await this._addNetwork(profile.id, name, rpcUrl, chainId, false))
			} catch (error) {
				this.logError("Failed to add 'Local Network'", getErrorMessage(error))
			}
			for (const network of defaultNetworks.filter((x) => x.isDefault)) {
				this.emit("onDefaultNetworkChanged", network)
				this.nodes.set(network.chainId, this.nodeFactory.createNode(network.rpcUrl))
			}
			return defaultNetworks
		} finally {
			this.lock.leave()
		}
	}

	public async getNetworks(chainId?: number): Promise<Network[]> {
		validateParams(NetworkMethodSchemas.getNetworks.params, [chainId], "getNetworks")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		return (await this.storage.getValues()).filter(
			(x) => x.profileId === profile.id && (chainId === undefined || x.chainId === chainId),
		)
	}

	public async getNetwork(id: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.getNetwork.params, [id], "getNetwork")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		const network = await this.storage.get(id)
		if (network?.profileId !== profile.id) {
			throw new Error("Invalid id")
		}
		return network
	}

	public async addNetwork(name: string, rpcUrl: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.addNetwork.params, [name, rpcUrl], "addNetwork")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		const chainId = await this.getChainId(rpcUrl)
		try {
			await this.lock.enter()
			const network = await this._addNetwork(profile.id, name, rpcUrl, chainId, false)
			this.emit("onNetworkAdded", network)
			return network
		} finally {
			this.lock.leave()
		}
	}

	public async updateNetwork(id: string, name: string, rpcUrl: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.updateNetwork.params, [id, name, rpcUrl], "updateNetwork")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		const chainId = await this.getChainId(rpcUrl)
		try {
			await this.lock.enter()
			const network = await this.storage.get(id)
			if (network?.profileId !== profile.id) {
				throw new Error("Invalid id")
			}
			network.isDefault = network.chainId === chainId ? network.isDefault : false
			network.name = name
			network.rpcUrl = rpcUrl

---TOKEN BALANCE REPO---
/**
 * Storage ownership for `TokenBalanceRaw`. Extracted from
 * `TokenBalanceService` in M2.4-a.
 *
 * Frozen invariants (from plan architecture):
 * - Storage key `nulo:core:token-balances`.
 * - `StorageType.Local`.
 * - `TokenBalanceRaw` shape unchanged.
 * - IDs are numeric; `allocateId()` mirrors today's
 *   `array_max((await balances.getKeys()).map((x) => +x)) + 1`.
 */

import { array_max } from "@/wallet/utils"
import { EntityStorage, StorageType } from "@/wallet/storage"
import type { TokenBalanceRaw } from "./spec"

export class BalanceRepository {
	private readonly storage: EntityStorage<TokenBalanceRaw>

	public constructor() {
		this.storage = new EntityStorage<TokenBalanceRaw>("nulo:core:token-balances", StorageType.Local)
	}

	public async get(id: number): Promise<TokenBalanceRaw | undefined> {
		return this.storage.get(`${id}`)
	}

	public async getAll(): Promise<TokenBalanceRaw[]> {
		return this.storage.getValues()
	}

	public async set(balance: TokenBalanceRaw): Promise<void> {
		await this.storage.set(`${balance.id}`, balance)
	}

	public async delete(id: number): Promise<void> {
		await this.storage.delete(`${id}`)
	}

	/** Allocate a fresh numeric id: `max(existing ids) + 1`. */
	public async allocateId(): Promise<number> {
		return array_max((await this.storage.getKeys()).map((x) => +x)) + 1
	}

	/** Check whether a persisted balance exists for (token, account).
	 *  Used by the projector write loop to guard against writing
	 *  balances for records deleted mid-sync. */
	public async existsByTokenAndAccount(tokenId: number, account: string): Promise<boolean> {
		const all = await this.storage.getValues()
		return all.some((x) => x.token === tokenId && x.account === account)
	}
}

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/storage/simple_storage.ts && printf '\\n---UTILS INDEX---\\n' && sed -n '1,220p' packages/extension/src/wallet/utils/index.ts && printf '\\n---LOGGER INDEX---\\n' && sed -n '1,220p' packages/extension/src/wallet/logger/index.ts" in (project root)
 succeeded in 0ms:
import { StorageType } from "."

export class SimpleStorage<T> {
	private readonly storage: chrome.storage.StorageArea
	private readonly root: string

	constructor(root: string, type: StorageType = StorageType.Local) {
		this.root = root
		this.storage = type === StorageType.Local ? chrome.storage.local : chrome.storage.session
	}

	public async getAll(): Promise<Record<string, T>> {
		const all = await this.storage.get()
		const path = `${this.root}:`
		const result: Record<string, T> = {}

		for (const fullKey in all) {
			if (fullKey.startsWith(path)) {
				const key = fullKey.slice(path.length)
				try {
					result[key] = JSON.parse(all[fullKey])
				} catch {}
			}
		}

		return result
	}

	public async get(key: string): Promise<T | undefined> {
		const path = `${this.root}:${key}`
		const res = await this.storage.get(path)
		if (path in res) {
			return JSON.parse(res[path])
		}
		return undefined
	}

	public set(key: string, value: T): Promise<void> {
		const path = `${this.root}:${key}`
		return this.storage.set({ [path]: JSON.stringify(value) })
	}

	public delete(key: string): Promise<void> {
		const path = `${this.root}:${key}`
		return this.storage.remove(path)
	}
}

---UTILS INDEX---
export * from "./arrays"
export * from "./lock"
export * from "./random"
export * from "./rw-guard"
export * from "./sleep"

---LOGGER INDEX---
import type { EventHandler } from "@/wallet/utils/event-handler"

export * from "./store"
export * from "./utils"

export enum LogLevel {
	Debug = 0,
	Info = 1,
	Warn = 2,
	Error = 3,
}

export type LogContext = "sw" | "offscreen" | "popup" | "content"

export type Log = {
	id: number
	timestamp: number
	source: string
	level: LogLevel
	context?: LogContext
	data: unknown[]
}

export interface ILogger {
	log(source: string, level: LogLevel, ...data: unknown[]): void
}

export interface ILoggerStore extends ILogger {
	onLog: EventHandler<Log>
	get(count: number, fromId?: number): Log[]
	clear(): void
}

export const consoleMethods: [string, LogLevel][] = [
	["trace", LogLevel.Debug],
	["debug", LogLevel.Debug],
	["log", LogLevel.Info],
	["info", LogLevel.Info],
	["warn", LogLevel.Warn],
	["error", LogLevel.Error],
]

exec
/bin/zsh -lc "rg -n \"SimpleStorage|simple_storage|from \\\"@/wallet/storage\\\"\" packages/extension/src -S" in (project root)
 succeeded in 0ms:
packages/extension/src/wallet/services/auth-registry/service.ts:11:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/token-balance/balance-repository.ts:14:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/transaction/service.ts:10:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/storage/index.ts:7:export * from "./simple_storage"
packages/extension/src/wallet/storage/simple_storage.ts:3:export class SimpleStorage<T> {
packages/extension/src/wallet/services/account/service.ts:7:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/config/store.ts:1:import { StorageType, ValueStorage } from "@/wallet/storage"
packages/extension/src/wallet/services/token/service.ts:10:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/profile/session-manager.ts:52:import { StorageType, ValueStorage } from "@/wallet/storage"
packages/extension/src/wallet/services/profile/repository.ts:19:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/dapp-session/service.ts:5:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/contact/service.ts:6:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/fpc/service.ts:8:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/network/service.ts:9:import { EntityStorage, StorageType } from "@/wallet/storage"
packages/extension/src/wallet/services/operation-journal/service.ts:6:import { EntityStorage, StorageType } from "@/wallet/storage"

exec
/bin/zsh -lc "sed -n '1,260p' packages/extension/src/wallet/base/index.ts" in (project root)
 succeeded in 0ms:
import type { EventHandler } from "@/wallet/utils/event-handler"
import { topologicalPhases } from "./topology"

export type EventsMap = Record<string, unknown>

export type EventsSpec<T extends EventsMap> = {
	[P in keyof T]: EventHandler<T[P]>
}

// biome-ignore lint/suspicious/noExplicitAny: params must be `any[]` so concrete method signatures satisfy this constraint
export type MethodsMap = Record<string, (...params: any[]) => unknown>

export type MethodsSpec<T extends MethodsMap> = {
	[M in keyof T]: (...params: Parameters<T[M]>) => Promise<ReturnType<T[M]>>
}

export type ServiceSpec<T1 extends MethodsMap, T2 extends EventsMap = {}> = MethodsSpec<T1> & EventsSpec<T2>

export type Restored<T> = T & { restoreError?: unknown }

export interface IService {
	name: string
	/**
	 * Names of services that must finish starting before this one begins.
	 * Optional — services without declared deps land in phase 0 and still
	 * rely on the base-class `ensureInitialized()` fallback for any deps
	 * they access during `init()`. Migration is per-service; see M2.
	 */
	readonly dependencies?: readonly string[]
	start(services: ServiceCollection): Promise<void>
}

export { DependencyCycleError, UnknownDependencyError } from "./topology"

export class ServiceCollection {
	private readonly services = new Map<string, IService>()

	public add(service: IService) {
		if (this.services.has(service.name)) {
			throw new Error(`Service '${service.name}' has already been registered`)
		}
		this.services.set(service.name, service)
	}

	public get<T extends IService>(name: string): T {
		const service = this.services.get(name)
		if (!service) {
			throw new Error(`Service '${name}' hasn't been registered`)
		}
		return service as T
	}

	/**
	 * Topologically-ordered startup. Services with no declared dependencies
	 * run in phase 0 (parallel); each subsequent phase starts only after the
	 * previous phase fully resolves. Cycles and unknown deps throw named
	 * errors up front instead of surfacing as mysterious `ensureInitialized`
	 * timeouts at runtime.
	 *
	 * Services that haven't declared deps (default `undefined`) still get
	 * phase 0, so behavior is backward-compatible with the old `Promise.all`
	 * startup. Services opt into ordering as they're migrated.
	 */
	public async start() {
		const phases = topologicalPhases([...this.services.values()])
		for (const phase of phases) {
			await Promise.all(phase.map((svc) => svc.start(this)))
		}
	}
}

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/logger/store.ts && printf '\\n---LOGGER UTILS---\\n' && sed -n '1,220p' packages/extension/src/wallet/logger/utils.ts" in (project root)
 succeeded in 0ms:
import type { ConfigProp, IConfig } from "@/wallet/config"
import { EventHandler } from "@/wallet/utils/event-handler"
import { type ILoggerStore, type Log, LogLevel, CircularBufferIterable, print, trim } from "."

export class LoggerStore implements ILoggerStore {
	public readonly onLog = new EventHandler<Log>()

	private logLevel: LogLevel
	private logs: CircularBufferIterable<Log>
	private nextId = 1
	private flushTimer?: ReturnType<typeof setTimeout>

	public constructor(config: IConfig) {
		this.logLevel = config.get("debugMode") ? LogLevel.Debug : LogLevel.Info
		this.logs = new CircularBufferIterable(this.logLevel === LogLevel.Debug ? 10_000 : 1000)
		config.onUpdate.add(this.onConfigUpdate)
	}

	public get(count: number, fromId?: number): Log[] {
		return this.logs.get(count, fromId ?? 0)
	}

	public clear(): void {
		this.logs.clear()
	}

	public log(source: string, level: LogLevel, ...data: unknown[]): void {
		if (level < this.logLevel) {
			return
		}
		const log: Log = {
			id: this.nextId++,
			timestamp: Date.now(),
			source,
			level,
			context: "sw",
			data: trim(data) as unknown[],
		}
		this.logs.add(log)
		this.scheduleFlush()
		this.onLog.invoke(log)
		print(log)
	}

	/** Log with explicit context (used by LoggerService for offscreen/popup forwarding). */
	public logWithContext(context: string | undefined, source: string, level: LogLevel, ...data: unknown[]): void {
		if (level < this.logLevel) {
			return
		}
		const log: Log = {
			id: this.nextId++,
			timestamp: Date.now(),
			source,
			level,
			context: (context as Log["context"]) ?? "sw",
			data: trim(data) as unknown[],
		}
		this.logs.add(log)
		this.scheduleFlush()
		this.onLog.invoke(log)
		print(log)
	}

	/** Rehydrate logs from chrome.storage.session (call on startup before wiring services). */
	public async rehydrate(): Promise<void> {
		try {
			const result = await chrome.storage.session.get("nulo:logs")
			const saved = result["nulo:logs"] as Log[] | undefined
			if (saved?.length) {
				for (const log of saved) {
					this.logs.add(log)
					this.nextId = Math.max(this.nextId, log.id + 1)
				}
			}
		} catch {
			// Session storage may not be available (e.g., in tests)
		}
	}

	/** Debounced flush of recent logs to chrome.storage.session for crash recovery. */
	private scheduleFlush(): void {
		if (this.flushTimer) return
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined
			try {
				const items = this.logs.items().slice(-2000)
				chrome.storage.session.set({ "nulo:logs": items })
			} catch {
				// Session storage may not be available
			}
		}, 2000)
	}

	private readonly onConfigUpdate = (prop: ConfigProp) => {
		if (prop.key === "debugMode") {
			this.logLevel = prop.value ? LogLevel.Debug : LogLevel.Info
			this.logs.resize(this.logLevel === LogLevel.Debug ? 10_000 : 1_000)
		}
	}
}

---LOGGER UTILS---
import { type ILogger, type Log, LogLevel } from "."

export class DummyLogger implements ILogger {
	log() {}
}

export class CircularBuffer<T> {
	protected buffer: T[]
	protected position = 0
	protected full = false

	public constructor(protected capacity: number) {
		this.buffer = new Array<T>(capacity)
	}

	public items(): T[] {
		if (this.full) {
			return [...this.buffer.slice(this.position), ...this.buffer.slice(0, this.position)]
		}
		return this.buffer.slice(0, this.position)
	}

	public add(item: T): void {
		this.buffer[this.position] = item
		this.position = (this.position + 1) % this.capacity
		if (this.position === 0) {
			this.full = true
		}
	}

	public resize(newCapacity: number): void {
		if (newCapacity === this.capacity) {
			return
		}
		const items = this.items().slice(-newCapacity)
		this.clear(newCapacity)
		for (const item of items) {
			this.add(item)
		}
	}

	public clear(newCapacity?: number): void {
		this.capacity = newCapacity ?? this.capacity
		this.buffer = new Array<T>(this.capacity)
		this.position = 0
		this.full = false
	}
}

export class CircularBufferIterable<T extends { id: number }> extends CircularBuffer<T> {
	public get(count: number, fromId: number): T[] {
		const res: T[] = []
		const size = this.full ? this.capacity : this.position
		const start = this.full ? this.position : 0
		for (let i = 0, j = start; i < size; i++, j = (j + 1) % this.capacity) {
			if (this.buffer[j].id > fromId) {
				res.push(this.buffer[j])
				if (res.length === count) {
					break
				}
			}
		}
		return res
	}
}

const MAX_LOG_DATA_DEPTH = 6

export const trim = (value: unknown, depth: number = 0): unknown => {
	if (Array.isArray(value)) {
		if (depth === MAX_LOG_DATA_DEPTH) {
			return "[Array]"
		}
		return value.map((x) => trim(x, depth + 1))
	}
	if (value && typeof value === "object") {
		if (depth === MAX_LOG_DATA_DEPTH) {
			return "[Object]"
		}
		const obj = value as Record<string, unknown>
		if ("nonDispatchPublicFunctions" in value) {
			// ContractArtifact
			return { name: obj.name }
		}
		if ("packedBytecode" in value) {
			// ContractInstanceWithAddress
			return { id: obj.id }
		}
		if ("originalContractClassId" in value) {
			// ContractInstance
			return {
				currentContractClassId: obj.currentContractClassId,
				originalContractClassId: obj.originalContractClassId,
			}
		}
		return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [k, v]) => {
			switch (k) {
				case "acir":
				case "authWitnesses":
				case "partialWitness":
				case "publicInputs":
				case "vk":
					acc[k] = `[${k}]`
					break
				default:
					acc[k] = trim(v, depth + 1)
					break
			}
			return acc
		}, {})
	}
	return value
}

export const print = (log: Log) => {
	const date = new Date(log.timestamp)
	const time = `${date.toTimeString().slice(0, 8)}.${date.getMilliseconds().toString().padStart(3, "0")}`
	const ctx = log.context ? `${log.context}:` : ""
	const header = `[${time}] [${ctx}${log.source}]`

	switch (log.level) {
		case LogLevel.Debug:
			console._debug(header, ...log.data)
			break
		case LogLevel.Info:
			console._log(header, ...log.data)
			break
		case LogLevel.Warn:
			console._warn(header, ...log.data)
			break
		case LogLevel.Error:
			console._error(header, ...log.data)
			break
	}
}

exec
/bin/zsh -lc "sed -n '1,220p' packages/extension/src/wallet/services/account/spec.ts" in (project root)
 succeeded in 0ms:
export const ACCOUNT_SERVICE_NAME = "account"

export enum AccountType {
	// SECURITY: Numeric value is used in poseidon2Hash for key derivation. NEVER change it.
	/** Upstream-canonical Schnorr account (Aztec `@aztec/accounts/schnorr`). */
	Nulo_v1 = 0,
}

export type Account = {
	/** Profile Id (part of the derivation path). */
	profileId: string
	/** Chain Id (part of the derivation path). */
	chainId: number
	/** Address of the account contract. */
	address: string
	/** Index (part of the derivation path). */
	index: number
	/** Type of the account contract (part of the derivation path). */
	type: AccountType
	/** Display name */
	name: string
	/** Flag, determining whether the account is active or hidden. */
	visible: boolean
}

export type Methods = {
	/**
	 * Returns a list of accounts.
	 * @param profileId Profile, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param chainId Chain, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param all Whether to return all (including hidden) or only active accounts.
	 */
	getAccounts(profileId: string, chainId: number, all?: boolean): Account[]

	/**
	 * Returns an account with the specified address, or undefined if it doesn't exist.
	 * @param profileId Profile, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param chainId Chain, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param address Account contract address.
	 */
	getAccount(profileId: string, chainId: number, address: string): Account | undefined

	/**
	 * Creates and returns a new account.
	 * @param profileId Profile, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param chainId Chain, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param type Account contract type.
	 * @param name Display name.
	 */
	createAccount(profileId: string, chainId: number, type: AccountType, name: string): Account

	/**
	 * Changes an account name and returns the account, or undefined if it doesn't exist.
	 * @param profileId Profile, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param chainId Chain, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param address Account contract address.
	 * @param name Display name.
	 */
	changeAccountName(profileId: string, chainId: number, address: string, name: string): Account | undefined

	/**
	 * Changes an account visibility and returns the account, or undefined if it doesn't exist.
	 * @param profileId Profile, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param chainId Chain, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param address Account contract address.
	 * @param visible Visibility flag.
	 */
	changeAccountVisibility(profileId: string, chainId: number, address: string, visible: boolean): Account | undefined
}

export type Events = {
	/** Emitted when a new account is created */
	onAccountAdded: Account
	/** Emitted when an existing account is updated */
	onAccountUpdated: Account
	/** Emitted when an existing account is deleted */
	onAccountDeleted: Account
}

exec
/bin/zsh -lc "rg -n \"AccountType\\.Nulo_v1|enum AccountType|type AccountType\" packages/extension/src -S" in (project root)
exec
/bin/zsh -lc "rg -n \"BarretenbergSync|@aztec/bb\\.js|createPXE|WASMSimulator|AcceleratorProver|@aztec/pxe|@aztec/accounts|@aztec/wallet-sdk\" packages/extension/src -S" in (project root)
 succeeded in 0ms:
packages/extension/src/wallet/services/account/service.ts:51:		if (type !== AccountType.Nulo_v1) {
packages/extension/src/wallet/services/account/service.ts:106:		if (account.type !== AccountType.Nulo_v1) {
packages/extension/src/wallet/services/account/client.ts:5:import { type Account, ACCOUNT_SERVICE_NAME, type AccountType, type Events, type Methods } from "./spec"
packages/extension/src/wallet/services/account/spec.ts:3:export enum AccountType {
packages/extension/src/wallet/crypto/key-vectors.test.ts:187:	// ── V9: AccountType.Nulo_v1 numeric value ────────────────────────
packages/extension/src/wallet/crypto/key-vectors.test.ts:194:	test("V9 — AccountType.Nulo_v1 === 0", () => {
packages/extension/src/wallet/crypto/key-vectors.test.ts:195:		expect(AccountType.Nulo_v1).toBe(0)
packages/extension/src/popup/app.vue:112:		await managers.account.createAccount(appStore.profile.id, appStore.network.chainId, AccountType.Nulo_v1, "Account")
packages/extension/src/popup/app.vue:144:			await managers.account.createAccount(appStore.profile.id, appStore.network.chainId, AccountType.Nulo_v1, "Account")
packages/extension/src/popup/components/popups/NewAccountPopup.vue:40:		AccountType.Nulo_v1,

 succeeded in 0ms:
packages/extension/src/shims/bb-fetch-code.ts:2: * Replacement for @aztec/bb.js fetchCode browser module.
packages/extension/src/shims/bb-fetch-code.ts:8: * The WASM files are copied to /assets/ by vite-plugin-static-copy from libs/@aztec/bb.js/.
packages/extension/src/wallet/services/wallet-sdk/dispatcher.ts:6: * This module bridges the `@aztec/wallet-sdk` communication protocol with the
packages/extension/src/wallet/crypto/key-vectors.test.ts:22: * `@aztec/accounts`:
packages/extension/src/wallet/crypto/key-vectors.test.ts:57: * cross-check) all require `@aztec/bb.js` WASM poseidon2, which
packages/extension/src/wallet/services/wallet-sdk/discovery-queue.ts:1:import type { BackgroundConnectionHandler, PendingDiscovery } from "@aztec/wallet-sdk/extension/handlers"
packages/extension/src/wallet/utils/schemas.ts:8:import type { PackedPrivateEvent, NotesFilter } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/wallet-sdk/background.ts:4: * Sets up the `BackgroundConnectionHandler` from `@aztec/wallet-sdk` in the
packages/extension/src/wallet/services/wallet-sdk/background.ts:26:import { BackgroundConnectionHandler, type PendingDiscovery, type ActiveSession } from "@aztec/wallet-sdk/extension/handlers"
packages/extension/src/wallet/services/wallet-sdk/background.ts:27:import type { WalletMessage, WalletResponse } from "@aztec/wallet-sdk/types"
packages/extension/src/wallet/services/pxe/service.ts:1:import type { PackedPrivateEvent, PXE } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/pxe/service.ts:24:import type { SimulateTxOpts, ExecuteUtilityOpts, ProfileTxOpts } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/runtime.ts:16:import { BarretenbergSync } from "@aztec/bb.js"
packages/extension/src/wallet/runtime.ts:91:			BarretenbergSync.initSingleton({ wasmPath: process.env.BB_WASM_PATH }).then(() =>
packages/extension/src/wallet/services/pxe/chain-runtime.ts:1:import { getPXEConfig, type PXEConfig } from "@aztec/pxe/config"
packages/extension/src/wallet/services/pxe/chain-runtime.ts:2:import { createPXE, type PXE } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/pxe/chain-runtime.ts:3:import { WASMSimulator } from "@aztec/simulator/client"
packages/extension/src/wallet/services/pxe/chain-runtime.ts:5:import { AcceleratorProver } from "@alejoamiras/aztec-accelerator"
packages/extension/src/wallet/services/pxe/chain-runtime.ts:28:	 * aborting in-flight work (verified against upstream @aztec/pxe); so
packages/extension/src/wallet/services/pxe/chain-runtime.ts:67:		// Pass an explicit WASMSimulator into both the prover AND the PXE
packages/extension/src/wallet/services/pxe/chain-runtime.ts:75:		const simulator = new WASMSimulator()
packages/extension/src/wallet/services/pxe/chain-runtime.ts:76:		const prover = new AcceleratorProver({ simulator })
packages/extension/src/wallet/services/pxe/chain-runtime.ts:77:		const pxe = await createPXE(node, config, { proverOrOptions: prover, simulator })
packages/extension/src/wallet/services/pxe/chain-runtime.test.ts:2:import type { PXE } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/pxe/proxy.ts:2:import type { SimulateTxOpts, ExecuteUtilityOpts, ProfileTxOpts } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/pxe/proxy.ts:12:import type { PackedPrivateEvent } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/pxe/client.ts:2:import type { SimulateTxOpts, ExecuteUtilityOpts, ProfileTxOpts } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/pxe/client.ts:16:import type { PackedPrivateEvent } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/execution/service.ts:113:import type { PackedPrivateEvent } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/execution/execution-coordinator.ts:36:import type { SimulateTxOpts } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/pxe/spec.ts:3:import type { PackedPrivateEvent, NotesFilter } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/pxe/spec.ts:5:import type { SimulateTxOpts, ExecuteUtilityOpts, ProfileTxOpts } from "@aztec/pxe/client/bundle"
packages/extension/src/wallet/services/account/spec.ts:5:	/** Upstream-canonical Schnorr account (Aztec `@aztec/accounts/schnorr`). */
packages/extension/src/wallet/services/account/contracts/nulo-account.test.ts:2:import { SchnorrAccountContractArtifact } from "@aztec/accounts/schnorr"
packages/extension/src/wallet/services/account/contracts/nulo-account.ts:2: * Thin adapter over upstream @aztec/accounts/schnorr.
packages/extension/src/wallet/services/account/contracts/nulo-account.ts:30:import { SchnorrAccountContract, SchnorrAccountContractArtifact } from "@aztec/accounts/schnorr"
packages/extension/src/content-script/content.ts:5: * Uses the standardized @aztec/wallet-sdk ContentScriptConnectionHandler
packages/extension/src/content-script/content.ts:9:import { ContentScriptConnectionHandler } from "@aztec/wallet-sdk/extension/handlers"
packages/extension/src/popup/pages/settings/connected-apps/[id].vue:18:import { hashToEmoji } from "@aztec/wallet-sdk/crypto"
packages/extension/src/popup/windows/verify/index.vue:7:import { hashToEmoji } from "@aztec/wallet-sdk/crypto"

exec
/bin/zsh -lc "for f in packages/extension/src/wallet/utils/{arrays.ts,errors.ts,event-handler.ts,fn.ts,lock.ts,queue.ts,random.ts,rw-guard.ts,schemas.ts,serialization.ts,sleep.ts,mnemonic.ts,offscreen.ts,fetch.ts,auth-registry.ts,caip.ts,fee-juice.ts}; do echo '---' "'$f; sed -n '"'1,80p' "'$f; done' in (project root)
 succeeded in 0ms:
--- packages/extension/src/wallet/utils/arrays.ts
export const array_equals = (arr1: Uint8Array<ArrayBuffer>, arr2: Uint8Array<ArrayBuffer>): boolean => {
	if (arr1.length !== arr2.length) {
		return false
	}
	for (let i = 0; i < arr1.length; i++) {
		if (arr1[i] !== arr2[i]) {
			return false
		}
	}
	return true
}

export const array_max = (arr: Array<number>): number => {
	let res = 0
	for (const x of arr) {
		if (x > res) {
			res = x
		}
	}
	return res
}

function safeStringify(value: unknown): string {
	if (value === null) return "null"
	if (value === undefined) return "undefined"
	if (typeof value === "string") return value
	if (typeof value === "bigint") {
		return value.toString()
	}
	if (value instanceof Date) return value.toISOString()
	if (typeof value === "object" && !Array.isArray(value)) {
		try {
			return JSON.stringify(value, Object.keys(value).sort())
		} catch {
			return "[Unserializable Object]"
		}
	}
	return String(value)
}

export function hasIntersectionByKeys<T extends Record<string, unknown>>(arr1: T[], arr2: T[], keys: (keyof T)[]): boolean {
	const keySet = new Set<string>()

	arr1.forEach((item) => {
		const key = keys.map((k) => safeStringify(item[k])).join("|")
		keySet.add(key)
	})

	return arr2.some((item) => {
		const key = keys.map((k) => safeStringify(item[k])).join("|")
		return keySet.has(key)
	})
}
--- packages/extension/src/wallet/utils/errors.ts
export const getErrorData = (error: unknown) => (error as Error)?.stack ?? getErrorMessage(error)

export const getErrorMessage = (error: unknown) => (error as Error)?.message ?? (error as string) ?? "Unknown error"
--- packages/extension/src/wallet/utils/event-handler.ts
export interface IEventHandler<T> {
	add: (callback: (payload: T) => void) => void
	remove: (callback: (payload: T) => void) => void
}

export class EventHandler<T> implements IEventHandler<T> {
	#callbacks: ((payload: T) => void)[] = []

	public add(callback: (payload: T) => void) {
		if (!this.#callbacks.includes(callback)) {
			this.#callbacks.push(callback)
		}
	}

	public remove(callback: (payload: T) => void) {
		const index = this.#callbacks.indexOf(callback)
		if (index !== -1) {
			this.#callbacks.splice(index, 1)
		}
	}

	public invoke(payload: T) {
		for (const callback of this.#callbacks) {
			try {
				callback(payload)
			} catch {}
		}
	}
}
--- packages/extension/src/wallet/utils/fn.ts
import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { ExecutionPayload, type NestedProcessReturnValues } from "@aztec/stdlib/tx"
import { type AbiType, encodeArguments, type FunctionAbi, FunctionCall, FunctionSelector, FunctionType } from "@aztec/stdlib/abi"
import { NuloFeePaymentMethod, type IAccountContract } from "@/wallet/services/account/contracts"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { IPXE } from "@/wallet/services/pxe/proxy"

export class FnImpl {
	constructor(
		public readonly name: string,
		public readonly impl: number,
	) {}
}

export abstract class Fn extends FnImpl {
	public readonly isStatic: boolean
	public readonly type: FunctionType

	constructor(name: string, impl: number) {
		super(name, impl)

		const abi = this.abi()
		this.isStatic = abi.isStatic
		this.type = abi.functionType
	}

	protected abstract abi(): FunctionAbi

	public abstract buildArgs(...args: unknown[]): unknown[]

	public async getSelector(): Promise<FunctionSelector> {
		const abi = this.abi()
		return await FunctionSelector.fromNameAndParameters(abi.name, abi.parameters)
	}

	public encodeArgs(args: unknown[]): Fr[] {
		return encodeArguments(this.abi(), args)
	}

	public getReturnTypes(): AbiType[] {
		return this.abi().returnTypes
	}

	public getImpl(): FnImpl {
		return new FnImpl(this.name, this.impl)
	}
}

export abstract class ViewFn extends Fn {
	public abstract unpackResult(values: Fr[]): unknown
}

export async function simulate(
	node: AztecNode,
	pxe: IPXE,
	account: IAccountContract,
	contract: string,
	viewFn: ViewFn,
	args: unknown[],
): Promise<unknown> {
	const contractAddress = AztecAddress.fromString(contract)
	const fnSelector = await viewFn.getSelector()
	const encodedArgs = viewFn.encodeArgs(args)

	if (viewFn.type === FunctionType.UTILITY) {
		const call = new FunctionCall(
			viewFn.name,
			contractAddress,
			fnSelector,
			viewFn.type,
			false,
			viewFn.isStatic,
			encodedArgs,
			viewFn.getReturnTypes(),
		)
		const { result } = await pxe.executeUtility(call, { scopes: [account.address] })
		return viewFn.unpackResult(result)
	}

--- packages/extension/src/wallet/utils/lock.ts
import { type ILogger, LogLevel } from "@/wallet/logger"

/** Maximum time a lock can be held before being force-released (ms). */
const MAX_HOLD_MS = 5 * 60_000 // 5 minutes

export class Lock {
	private readonly queue: ((value: undefined) => void)[] = []
	private locked = false
	private readonly name?: string
	private readonly logger?: ILogger
	private acquiredAt = 0
	private forceReleaseTimer?: NodeJS.Timeout

	constructor(name?: string, logger?: ILogger) {
		this.name = name
		this.logger = logger
	}

	public async enter() {
		const waiting = this.locked
		const start = this.logger ? Date.now() : 0
		if (waiting && this.logger) {
			this.logger.log(this.name!, LogLevel.Debug, `Lock: waiting (queue: ${this.queue.length})`)
		}
		await new Promise<void>((resolve) => {
			this.queue.push(resolve)
			this.dispatch()
		})
		if (this.logger) {
			const waited = Date.now() - start
			if (waited > 50) {
				this.logger.log(this.name!, LogLevel.Debug, `Lock: acquired (waited ${waited}ms)`)
			}
			this.acquiredAt = Date.now()
		}
		// Safety net: force-release if holder never calls leave()
		this.forceReleaseTimer = setTimeout(() => {
			if (this.locked) {
				if (this.logger) {
					this.logger.log(this.name!, LogLevel.Error, `Lock: force-released after ${MAX_HOLD_MS}ms (holder did not call leave)`)
				}
				this.leave()
			}
		}, MAX_HOLD_MS)
	}

	public leave() {
		if (this.forceReleaseTimer) {
			clearTimeout(this.forceReleaseTimer)
			this.forceReleaseTimer = undefined
		}
		if (this.logger && this.acquiredAt) {
			const held = Date.now() - this.acquiredAt
			if (held > 100) {
				this.logger.log(this.name!, LogLevel.Debug, `Lock: released (held ${held}ms)`)
			}
			this.acquiredAt = 0
		}
		this.locked = false
		this.dispatch()
	}

	private dispatch() {
		if (!this.locked && this.queue.length) {
			this.locked = true
			this.queue.shift()!()
		}
	}
}
--- packages/extension/src/wallet/utils/queue.ts
export class Queue<TKey, TValue> {
	private readonly items: TValue[] = []
	private readonly keys: Set<TKey> = new Set()

	constructor(private readonly key: (item: TValue) => TKey) {}

	public get length(): number {
		return this.items.length
	}

	public clear() {
		this.items.splice(0, this.items.length)
		this.keys.clear()
	}

	public enqueue(item: TValue) {
		const key = this.key(item)
		if (this.keys.has(key)) {
			return
		}
		this.keys.add(key)
		this.items.push(item)
	}

	public priorityPass(item: TValue) {
		const key = this.key(item)
		if (this.keys.has(key)) {
			this.items.splice(
				this.items.findIndex((x) => this.key(x) === key),
				1,
			)
		} else {
			this.keys.add(key)
		}
		this.items.unshift(item)
	}

	public dequeue(): TValue | undefined {
		if (!this.items.length) {
			return undefined
		}
		const item = this.items.shift()!
		this.keys.delete(this.key(item))
		return item
	}

	public dequeueBatch(size: number): TValue[] {
		const res = []
		while (size-- > 0) {
			const item = this.dequeue()
			if (!item) break
			res.push(item)
		}
		return res
	}

	public peek(): TValue | undefined {
		return this.items.at(0)
	}
}
--- packages/extension/src/wallet/utils/random.ts
export const getRandomHex = (length: number): string => {
	return Buffer.from(self.crypto.getRandomValues(new Uint8Array(length / 2)).buffer).toString("hex")
}

export const getRandomElement = <T>(arr: T[]): T | undefined => {
	if (!arr.length) return undefined

	const index = Math.floor(Math.random() * arr.length)

	return arr[index]
}
--- packages/extension/src/wallet/utils/rw-guard.ts
import { type ILogger, LogLevel } from "@/wallet/logger"

/** Force-release timeout for stuck readers (ms). Mirrors `Lock.MAX_HOLD_MS`.
 *  Converts a deadlock into a loud log + forced drain so the wallet
 *  recovers on its own instead of hanging forever. */
const MAX_READER_DRAIN_MS = 5 * 60_000

interface Deferred<T> {
	promise: Promise<T>
	resolve: (value: T) => void
}

function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

/**
 * Read/write concurrency guard.
 *
 * - `read(fn)`: counts as a reader. Runs immediately if no writer is
 *   active or queued; otherwise waits for the writer to finish. Multiple
 *   concurrent reads proceed in parallel.
 * - `write(fn)`: waits for all active readers to drain, then runs
 *   exclusively. Other readers and writers queue behind it.
 * - `enterWrite()`/`leaveWrite()`: manual write-hold for destructive ops
 *   that span multiple awaits (profile switch/delete).
 *
 * Writers have FIFO priority: a reader arriving while a writer is queued
 * waits behind that writer. This prevents writer starvation under heavy
 * read load.
 *
 * Force-release: if readers don't drain within `MAX_READER_DRAIN_MS`,
 * the guard logs an error and force-unsticks queued writers. This is a
 * debuggability aid — it should never fire in practice.
 *
 * Reentry: calling `write()` from within a `read()` callback will
 * deadlock (the write waits for the read to finish; the read can't
 * finish until the write returns). The force-release unsticks this
 * after 5 minutes. MV3 lacks `AsyncLocalStorage`, so we don't detect
 * reentry statically — the sync-detector approach produces false
 * positives under legitimate concurrent reads vs. writes. Callers must
 * not nest.
 */
export class ReadWriteGuard {
	private readers = 0
	private writeActive = false
	private readonly writeWaiters: Deferred<void>[] = []
	private readonly readWaiters: Deferred<void>[] = []
	private forceReleaseTimer?: ReturnType<typeof setTimeout>

	constructor(
		private readonly name?: string,
		private readonly logger?: ILogger,
	) {}

	async read<T>(fn: () => Promise<T>): Promise<T> {
		if (this.writeActive || this.writeWaiters.length > 0) {
			const d = deferred()
			this.readWaiters.push(d)
			await d.promise
		}

		if (this.readers === 0) this.startForceReleaseTimer()
		this.readers++

		try {
			return await fn()
		} finally {
			this.readers--
			if (this.readers === 0) {
				this.stopForceReleaseTimer()
				this.drainWriteIfReady()
			}
		}
	}

--- packages/extension/src/wallet/utils/schemas.ts
import { EventSelector } from "@aztec/stdlib/abi"
import { Fr } from "@aztec/foundation/curves/bn254"
import type { ZodFor } from "@aztec/foundation/schemas"
import { Note, NoteStatus } from "@aztec/stdlib/note"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { inTxSchema, TxHash } from "@aztec/stdlib/tx"
import { BlockNumberSchema } from "@aztec/foundation/branded-types"
import type { PackedPrivateEvent, NotesFilter } from "@aztec/pxe/client/bundle"
import z from "zod"

export const NoteDaoSchema = z.object({
	note: Note.schema,
	contractAddress: AztecAddress.schema,
	owner: AztecAddress.schema,
	storageSlot: Fr.schema,
	randomness: Fr.schema,
	noteNonce: Fr.schema,
	noteHash: Fr.schema,
	siloedNullifier: Fr.schema,
	txHash: TxHash.schema,
	l2BlockNumber: BlockNumberSchema,
	l2BlockHash: z.string(),
	txIndexInBlock: z.number(),
	noteIndexInTx: z.number(),
})

export const PackedPrivateEventSchema = z.intersection(
	inTxSchema(),
	z.object({
		packedEvent: z.array(Fr.schema),
		eventSelector: EventSelector.schema,
	}),
) satisfies ZodFor<PackedPrivateEvent>

export const NotesFilterSchema = z.object({
	contractAddress: AztecAddress.schema,
	owner: AztecAddress.schema.optional(),
	storageSlot: Fr.schema.optional(),
	status: z.nativeEnum(NoteStatus).optional(),
	siloedNullifier: Fr.schema.optional(),
	scopes: z.array(AztecAddress.schema),
}) satisfies ZodFor<NotesFilter>
--- packages/extension/src/wallet/utils/serialization.ts
// copied from @aztec/foundation/json-rpc
export function jsonStringify(obj: unknown): string {
	return JSON.stringify(obj, (_key, value) => {
		if (typeof value === "bigint") {
			return value.toString()
		} else if (typeof value === "object" && value && value.type === "Buffer" && Array.isArray(value.data)) {
			return Buffer.from(value.data).toString("base64")
		} else if (typeof value === "object" && value && Buffer.isBuffer(value)) {
			return value.toString("base64")
		} else if (typeof value === "object" && value instanceof Map) {
			return Array.from(value.entries())
		} else if (typeof value === "object" && value instanceof Set) {
			return Array.from(value.values())
		} else if (value instanceof Error) {
			// Error's `name`, `message`, and `stack` are non-enumerable, so
			// JSON.stringify silently drops them and returns `{}`. Serialize
			// them explicitly. WalletError subclasses (from base/errors.ts)
			// add `code` + optional `details` which we also preserve.
			// Reconstruction on the receiving side is deserializer-agnostic:
			// consumers that check `x instanceof Error` will now at least
			// see `{ name, message, stack?, code?, details? }` and can
			// format it usefully.
			const err = value as Error & { code?: unknown; details?: unknown }
			return {
				name: err.name,
				message: err.message,
				...(err.stack !== undefined ? { stack: err.stack } : {}),
				...(err.code !== undefined ? { code: err.code } : {}),
				...(err.details !== undefined ? { details: err.details } : {}),
			}
		} else {
			return value
		}
	})
}

export function jsonSanitize<T>(obj: T): T {
	return (obj !== undefined ? JSON.parse(jsonStringify(obj)) : undefined) as T
}
--- packages/extension/src/wallet/utils/sleep.ts
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
--- packages/extension/src/wallet/utils/mnemonic.ts
const bip39Words = [
	"abandon",
	"ability",
	"able",
	"about",
	"above",
	"absent",
	"absorb",
	"abstract",
	"absurd",
	"abuse",
	"access",
	"accident",
	"account",
	"accuse",
	"achieve",
	"acid",
	"acoustic",
	"acquire",
	"across",
	"act",
	"action",
	"actor",
	"actress",
	"actual",
	"adapt",
	"add",
	"addict",
	"address",
	"adjust",
	"admit",
	"adult",
	"advance",
	"advice",
	"aerobic",
	"affair",
	"afford",
	"afraid",
	"again",
	"age",
	"agent",
	"agree",
	"ahead",
	"aim",
	"air",
	"airport",
	"aisle",
	"alarm",
	"album",
	"alcohol",
	"alert",
	"alien",
	"all",
	"alley",
	"allow",
	"almost",
	"alone",
	"alpha",
	"already",
	"also",
	"alter",
	"always",
	"amateur",
	"amazing",
	"among",
	"amount",
	"amused",
	"analyst",
	"anchor",
	"ancient",
	"anger",
	"angle",
	"angry",
	"animal",
	"ankle",
	"announce",
	"annual",
	"another",
	"answer",
	"antenna",
--- packages/extension/src/wallet/utils/offscreen.ts
export const OFFSCREEN_READY_MESSAGE = "OFFSCREEN_READY"
export const OFFSCREEN_PING = "OFFSCREEN_PING"
export const OFFSCREEN_PONG = "OFFSCREEN_PONG"
export const OFFSCREEN_KEEPALIVE = "OFFSCREEN_KEEPALIVE"

let offscreenTimeout: NodeJS.Timeout
let offscreenPromise: Promise<void> | null = null
let resolveOffscreenPromise: () => void
let rejectOffscreenPromise: (reason: string) => void

const HEALTH_CHECK_TIMEOUT_MS = 3_000
const READY_TIMEOUT_MS = 10_000

const path = "src/offscreen/index.html"
const offscreenUrl = chrome.runtime.getURL(path)
const onOffscreenReady = (message: unknown) => {
	if (message === OFFSCREEN_READY_MESSAGE) {
		chrome.runtime.onMessage.removeListener(onOffscreenReady)
		clearTimeout(offscreenTimeout)
		resolveOffscreenPromise()
		offscreenPromise = null
	}
	return false
}
const onOffscreenTimeout = () => {
	chrome.runtime.onMessage.removeListener(onOffscreenReady)
	// Kill the half-initialized offscreen so it doesn't become a ghost
	chrome.offscreen.closeDocument().catch(() => {})
	rejectOffscreenPromise("Offscreen is not responding")
	offscreenPromise = null
}

/**
 * Check if the existing offscreen document is responsive.
 * Sends a ping and waits for a pong within HEALTH_CHECK_TIMEOUT_MS.
 * Returns true if healthy, false if zombie/unresponsive.
 */
async function isOffscreenHealthy(): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => {
			chrome.runtime.onMessage.removeListener(onPong)
			resolve(false)
		}, HEALTH_CHECK_TIMEOUT_MS)

		const onPong = (message: unknown) => {
			if (message === OFFSCREEN_PONG) {
				chrome.runtime.onMessage.removeListener(onPong)
				clearTimeout(timer)
				resolve(true)
			}
			return false
		}

		chrome.runtime.onMessage.addListener(onPong)
		chrome.runtime.sendMessage(OFFSCREEN_PING).catch(() => {
			// No receiver — offscreen is definitely dead
			chrome.runtime.onMessage.removeListener(onPong)
			clearTimeout(timer)
			resolve(false)
		})
	})
}

/**
 * Close any existing offscreen document, ignoring errors.
 */
async function closeOffscreen() {
	try {
		await chrome.offscreen.closeDocument()
	} catch {
		// Already closed or Chrome cleaned it up
	}
}

/**
 * Create the offscreen document. Handles the Chrome ghost bug where
 * getContexts() returns empty but createDocument() throws "already exists".
 */
async function createOffscreen() {
	try {
--- packages/extension/src/wallet/utils/fetch.ts
/**
 * Timeout-wrapped fetch for Aztec node RPC calls.
 *
 * The Aztec SDK's default fetch (`makeFetch([1, 2, 3], false)`) has retry
 * logic but NO per-request timeout. If the node is unresponsive, each
 * attempt (and its retries) hang forever — freezing the PXE and the
 * entire wallet.
 *
 * This module mirrors the SDK's `defaultFetch` exactly (jsonStringify,
 * NoRetryError for 4xx) but adds a per-request AbortController timeout.
 * It then wraps with the SDK's own `retry` + `makeBackoff` for retries.
 */

import { jsonStringify } from "@aztec/foundation/json-rpc"
import { NoRetryError, makeBackoff, retry } from "@aztec/foundation/retry"

/** Default timeout per individual HTTP request (ms). */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

/**
 * JSON-RPC fetch signature expected by `createAztecNodeClient`.
 */
type JsonRpcFetch = (
	host: string,
	body: unknown,
	extraHeaders?: Record<string, string>,
	noRetry?: boolean,
) => Promise<{ response: unknown; headers: { get: (header: string) => string | null | undefined } }>

/**
 * Single-attempt fetch with timeout. Mirrors the SDK's `defaultFetch` but
 * adds an AbortController that fires after `timeoutMs`.
 */
function fetchOnce(timeoutMs: number): JsonRpcFetch {
	return async (host, body, extraHeaders = {}, noRetry = false) => {
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

		try {
			let resp: Response
			try {
				resp = await fetch(host, {
					method: "POST",
					body: jsonStringify(body),
					headers: { "content-type": "application/json", ...extraHeaders },
					signal: controller.signal,
				})
			} catch (err: unknown) {
				if (err instanceof DOMException && err.name === "AbortError") {
					throw new Error(`Request to ${host} timed out after ${timeoutMs}ms`)
				}
				throw new Error(`Error fetching from host ${host}: ${err}`)
			}

			let responseJson
			try {
				responseJson = await resp.json()
			} catch {
				if (!resp.ok) throw new Error(resp.statusText)
				throw new Error(`Failed to parse body as JSON`)
			}

			if (!resp.ok) {
				const errorMessage = `Error ${resp.status} from server ${host}: ${responseJson.error?.message ?? resp.statusText}`
				if (noRetry || (resp.status >= 400 && resp.status < 500)) {
					throw new NoRetryError(errorMessage)
				} else {
					throw new Error(errorMessage)
				}
			}

			return { response: responseJson, headers: resp.headers }
		} finally {
			clearTimeout(timeoutId)
		}
	}
}

/**
 * Create a JSON-RPC fetch function with per-request timeout AND retry logic.
--- packages/extension/src/wallet/utils/auth-registry.ts
import { CANONICAL_AUTH_REGISTRY_ADDRESS } from "@aztec/constants"
import { Fr } from "@aztec/foundation/curves/bn254"
import { type FunctionAbi, FunctionSelector, FunctionType } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { deriveStorageSlotInMap } from "@aztec/stdlib/hash"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"

// Auth Registry storage slots (derived from Noir contract storage layout)
const APPROVED_ACTIONS_SLOT = new Fr(1)
const REJECT_ALL_SLOT = new Fr(2)

export const getAuthRegistryAddress = () => AztecAddress.fromNumber(CANONICAL_AUTH_REGISTRY_ADDRESS)

export const getSetAuthorizedFn = () =>
	({
		name: "set_authorized",
		functionType: FunctionType.PUBLIC,
		isOnlySelf: false,
		isStatic: false,
		isInitializer: false,
		parameters: [
			{
				name: "message_hash",
				type: { kind: "field" },
				visibility: "private",
			},
			{
				name: "authorize",
				type: { kind: "boolean" },
				visibility: "private",
			},
		],
		returnTypes: [],
		errorTypes: {},
	}) as FunctionAbi

export const getSetAuthorizedSelector = async () => {
	const fn = getSetAuthorizedFn()
	return await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
}

export const isAuthwitConsumable = async (node: AztecNode, account: string, message_hash: string) => {
	const slot = await deriveStorageSlotInMap(
		await deriveStorageSlotInMap(APPROVED_ACTIONS_SLOT, AztecAddress.fromString(account)),
		Fr.fromString(message_hash),
	)
	const approved = await node.getPublicStorageAt("latest", getAuthRegistryAddress(), slot)
	return !approved.isZero()
}

export const isAuthRegistryEnabled = async (node: AztecNode, account: string) => {
	const slot = await deriveStorageSlotInMap(REJECT_ALL_SLOT, AztecAddress.fromString(account))
	const rejectAll = await node.getPublicStorageAt("latest", getAuthRegistryAddress(), slot)
	return rejectAll.isZero()
}
--- packages/extension/src/wallet/utils/caip.ts
/**
 * CAIP (Chain-Agnostic Improvement Proposal) helpers for the Aztec namespace.
 *
 * Before M2.5 the parsing + formatting patterns were duplicated across at
 * least 9 sites (dispatcher, execute window, verify window, capabilities
 * window, connected-apps settings, dapp-interaction service, fpc service,
 * token-balance service, …). Each site handrolled slightly different
 * validation — some no validation at all, some partial. This module is
 * the single source of truth.
 *
 * Spec reference: CAIP-2 chain id `aztec:<chainId>`, CAIP-10 account
 * identifier `aztec:<chainId>:<address>` where address is the
 * hex-encoded AztecAddress.
 */

import type { CaipAccount, CaipChain } from "@/wallet/services/dapp-interaction/spec"

/** Namespace segment shared by every CAIP string this wallet emits. */
export const AZTEC_NAMESPACE = "aztec" as const

/** Format a chainId into a CAIP-2 chain identifier (`aztec:<chainId>`). */
export function formatCaipChain(chainId: number): CaipChain {
	return `${AZTEC_NAMESPACE}:${chainId}` as CaipChain
}

/** Format a (chainId, address) pair into a CAIP-10 account identifier. */
export function formatCaipAccount(chainId: number, address: string): CaipAccount {
	return `${AZTEC_NAMESPACE}:${chainId}:${address}` as CaipAccount
}

/** Parse a CAIP-2 chain identifier. Throws if the shape or namespace is wrong. */
export function parseCaipChain(caip: string): { chainId: number } {
	const parts = caip.split(":")
	if (parts.length !== 2 || parts[0] !== AZTEC_NAMESPACE) {
		throw new Error(`Invalid CAIP chain identifier: ${caip}`)
	}
	// `Number("")` is 0, not NaN, so check the raw segment first.
	if (parts[1] === "") {
		throw new Error(`Invalid chainId in CAIP chain identifier: ${caip}`)
	}
	const chainId = Number(parts[1])
	if (!Number.isFinite(chainId) || !Number.isInteger(chainId)) {
		throw new Error(`Invalid chainId in CAIP chain identifier: ${caip}`)
	}
	return { chainId }
}

/** Parse a CAIP-10 account identifier. Throws if any segment is wrong. */
export function parseCaipAccount(caip: string): { chainId: number; address: string } {
	const parts = caip.split(":")
	if (parts.length !== 3 || parts[0] !== AZTEC_NAMESPACE) {
		throw new Error(`Invalid CAIP account identifier: ${caip}`)
	}
	if (parts[1] === "") {
		throw new Error(`Invalid chainId in CAIP account identifier: ${caip}`)
	}
	const chainId = Number(parts[1])
	if (!Number.isFinite(chainId) || !Number.isInteger(chainId)) {
		throw new Error(`Invalid chainId in CAIP account identifier: ${caip}`)
	}
	const address = parts[2]
	if (!address) {
		throw new Error(`Missing address in CAIP account identifier: ${caip}`)
	}
	return { chainId, address }
}

/** Minimal shape expected of a NetworkService-like object. Using the
 *  structural interface keeps this helper import-free relative to the
 *  service concrete type so it's callable from both SW and popup. */
interface NetworksQuery<TNetwork> {
	getNetworks(chainId: number): Promise<TNetwork[]>
}

/**
 * Resolve a chainId to a single Network via the default-selection rule:
 * first network marked `isDefault`, otherwise the first entry. Throws when
 * no network is configured for the chainId.
 *
 * Before this helper, 9 sites handrolled the same three-line pattern with
--- packages/extension/src/wallet/utils/fee-juice.ts
import { FEE_JUICE_ADDRESS } from "@aztec/constants"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { FeeJuiceContractArtifact } from "@aztec/noir-contracts.js/FeeJuice"
import type { Action } from "@/wallet/services/execution/spec"

export const feeJuiceAddress = AztecAddress.fromNumber(FEE_JUICE_ADDRESS).toString()

export const feeJuiceArtifact = FeeJuiceContractArtifact

export const feeJuiceName = "Fee Juice"

export const feeJuiceSymbol = "FJC"

export const getFeeJuiceClaimPayload = (to: string, amount: string, secret: string, messageLeafIndex: string): Action[] => {
	return [
		{
			kind: "call",
			contract: feeJuiceAddress,
			method: "claim_and_end_setup",
			args: [to, amount, secret, messageLeafIndex],
		},
	]
}

codex
I’ve got the main verdict. I’m pulling exact line numbers for the few files that matter so the audit notes can point to concrete breakpoints instead of paraphrasing.
exec
/bin/zsh -lc "nl -ba packages/extension/vite.config.ts | sed -n '35,205p'" in (project root)
 succeeded in 0ms:
    35				"Cross-Origin-Embedder-Policy": "require-corp",
    36				"Cross-Origin-Opener-Policy": "same-origin",
    37			},
    38		},
    39		resolve: {
    40			alias: {
    41				"@": fileURLToPath(new URL("./src", import.meta.url)),
    42				"~": fileURLToPath(new URL("./src", import.meta.url)),
    43				src: fileURLToPath(new URL("./src", import.meta.url)),
    44				"@assets": fileURLToPath(new URL("src/assets", import.meta.url)),
    45				"@private-fpc-artifact": resolvePackageFile("@wonderland/aztec-fee-payment", "target/private_contract-PrivateFPC.json"),
    46				"@wonderland-token-artifact": resolvePackageFile(
    47					"@defi-wonderland/aztec-standards",
    48					"artifacts/target/token_contract-Token.json",
    49				),
    50				"@alejoamiras/aztec-accelerator": resolvePackageFile("@alejoamiras/aztec-accelerator", "dist/index.js"),
    51				// Force detect-node to return false so @aztec/foundation's pino logger
    52				// uses the browser transport instead of Node.js worker-thread transport.
    53				// Without this, the node-polyfills process shim makes detect-node think
    54				// we're in Node.js, causing pino.transport() to fail with "window is not defined".
    55				"detect-node": fileURLToPath(new URL("./src/shims/detect-node.ts", import.meta.url)),
    56				comlink: "comlink",
    57				debug: "debug",
    58			},
    59			// Force Vite to resolve these WASM-binding packages to a single copy.
    60			// Multiple nested versions exist in node_modules (rc.2 in simulator/pxe,
    61			// rc.4 hoisted). Without dedup, initAbi() and abiEncode() end up in
    62			// different module scopes, so the WASM instance variable is never shared.
    63			dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"],
    64		},
    65		css: {
    66			preprocessorOptions: {
    67				scss: {
    68					loadPaths: [fileURLToPath(new URL("./src/assets/styles", import.meta.url))],
    69					quietDeps: true,
    70				},
    71			},
    72		},
    73		plugins: [
    74			// Replace bb.js fetchCode module to eliminate dynamic import() of embedded WASM.
    75			// Chrome MV3 service workers forbid import() at runtime. Our shim uses fetch()
    76			// against the WASM files in /assets/ instead.
    77			{
    78				name: "bb-fetch-code-shim",
    79				enforce: "pre",
    80				resolveId(source, importer) {
    81					if (importer?.includes("@aztec/bb.js") && source.includes("fetch_code") && source.endsWith("index.js")) {
    82						return fileURLToPath(new URL("./src/shims/bb-fetch-code.ts", import.meta.url))
    83					}
    84				},
    85			},
    86			vue(),
    87	
    88			usePages({
    89				dirs: [
    90					{
    91						dir: "src/pages",
    92						baseRoute: "common",
    93					},
    94					{
    95						dir: "src/setup/pages",
    96						baseRoute: "setup",
    97					},
    98					{
    99						dir: "src/popup/pages",
   100						baseRoute: "popup",
   101					},
   102					{
   103						dir: "src/popup/windows",
   104						baseRoute: "windows",
   105					},
   106				],
   107			}),
   108	
   109			useAutoImport({
   110				imports: [
   111					"vue",
   112					"vue-router",
   113					{
   114						"webextension-polyfill": [["*", "browser"]],
   115					},
   116				],
   117				dts: "src/types/auto-imports.d.ts",
   118				dirs: ["src/composables/", "src/stores/", "src/utils/"],
   119				// Rewrites compiled _ctx.<name> template references to resolve against the
   120				// auto-import registry so {{ trimAddress(...) }} works without explicit
   121				// imports in every SFC. Plugin runs enforce:"post" internally — must stay
   122				// after vue() in the plugin chain.
   123				vueTemplate: true,
   124				eslintrc: {
   125					enabled: true,
   126					filepath: "src/types/.eslintrc-auto-import.json",
   127				},
   128			}),
   129	
   130			useComponents({
   131				dirs: ["src/components"],
   132				dts: "src/types/components.d.ts",
   133			}),
   134	
   135			{
   136				name: "assets-rewrite",
   137				enforce: "post",
   138				apply: "build",
   139				transformIndexHtml(html, { path }) {
   140					const assetsPath = relative(dirname(path), "/assets").replace(/\\/g, "/")
   141					return html.replace(/"\/assets\//g, `"${assetsPath}/`)
   142				},
   143			},
   144	
   145			{
   146				name: "wasm-content-type",
   147				configureServer(server) {
   148					server.middlewares.use((req, res, next) => {
   149						if (req.url?.endsWith(".wasm")) {
   150							res.setHeader("Content-Type", "application/wasm")
   151						}
   152						next()
   153					})
   154				},
   155			},
   156	
   157			viteStaticCopy({
   158				targets: [
   159					{
   160						src: "./libs/@aztec/bb.js/*.wasm.gz",
   161						dest: "assets/",
   162					},
   163				],
   164			}),
   165	
   166			nodePolyfills({
   167				include: ["buffer", /*"crypto",*/ "net", "path", "stream", "tty", "vm", "util"],
   168			}),
   169		],
   170		build: {
   171			// Disable module preload polyfill — it references `window.dispatchEvent`
   172			// which doesn't exist in Chrome MV3 service workers.
   173			modulePreload: false,
   174			target: "esnext",
   175			rollupOptions: {
   176				input: {
   177					offscreen: "src/offscreen/index.html",
   178					popup: "src/popup/index.html",
   179					setup: "src/setup/index.html",
   180				},
   181			},
   182		},
   183		optimizeDeps: {
   184			include: ["pino", "vue", "webextension-polyfill"],
   185			exclude: ["@aztec/bb.js", "@aztec/noir-acvm_js", "@aztec/noir-noirc_abi", "vue-demi"],
   186			esbuildOptions: {
   187				target: "esnext",
   188			},
   189		},
   190		define: {
   191			__VERSION__: JSON.stringify(packageJson.version),
   192			__SENTINEL__: JSON.stringify(packageJson.sentinel),
   193			__AZTEC_VERSION__: JSON.stringify(packageJson.dependencies["@aztec/pxe"] ?? "unknown"),
   194			__NAME__: JSON.stringify(packageJson.name),
   195			__DISPLAY_NAME__: JSON.stringify(packageJson.displayName),
   196			"import.meta.env.HTML_TITLE": JSON.stringify(packageJson.displayName),
   197			"process.browser": true,
   198			"process.env": JSON.stringify({
   199				LOG_LEVEL: "verbose",
   200				BB_WASM_PATH: "/assets/barretenberg.wasm.gz",
   201			}),
   202		},
   203	})

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/storage/entity_storage.ts | sed -n '1,120p' && printf '\\n---\\n' && nl -ba packages/extension/src/wallet/storage/value-storage.ts | sed -n '1,120p' && printf '\\n---\\n' && nl -ba packages/extension/src/wallet/storage/simple_storage.ts | sed -n '1,120p'" in (project root)
 succeeded in 0ms:
     1	import type { StorageArea } from "@/core/ports"
     2	
     3	import { StorageType } from "."
     4	
     5	/**
     6	 * Minimal storage surface EntityStorage actually uses. Both
     7	 * `chrome.storage.StorageArea` (legacy path) and our port's `StorageArea`
     8	 * (injected path, used by tests via FakeBrowserApi) satisfy it.
     9	 */
    10	type MinimalArea = {
    11		get(keys?: string | string[] | null): Promise<Record<string, unknown>>
    12		set(items: Record<string, unknown>): Promise<void>
    13		remove(keys: string | string[]): Promise<void>
    14	}
    15	
    16	export class EntityStorage<T> {
    17		private readonly storage: MinimalArea
    18		private readonly root: string
    19	
    20		/**
    21		 * Two constructor shapes:
    22		 * 1. Legacy — pass a `StorageType` enum value; reaches into `chrome.storage`.
    23		 * 2. Injected — pass a `StorageArea` port; used by tests and the future
    24		 *    composition root.
    25		 */
    26		public constructor(root: string, areaOrType: StorageType | StorageArea = StorageType.Local) {
    27			this.root = root
    28			if (typeof areaOrType === "number") {
    29				this.storage = areaOrType === StorageType.Local ? chrome.storage.local : chrome.storage.session
    30			} else {
    31				this.storage = areaOrType as MinimalArea
    32			}
    33		}
    34	
    35		public async getVersion(): Promise<number> {
    36			const res = await this.storage.get(this.root)
    37			return this.root in res ? JSON.parse(res[this.root] as string) : 0
    38		}
    39	
    40		public setVersion(version: number): Promise<void> {
    41			return this.storage.set({ [this.root]: JSON.stringify(version) })
    42		}
    43	
    44		public async contains(id: string): Promise<boolean> {
    45			const key = `${this.root}@${id}`
    46			const res = await this.storage.get(key)
    47			return key in res
    48		}
    49	
    50		public async get(id: string): Promise<T | undefined> {
    51			const key = `${this.root}@${id}`
    52			const res = await this.storage.get(key)
    53			if (key in res) {
    54				return JSON.parse(res[key] as string)
    55			}
    56			return undefined
    57		}
    58	
    59		public set(id: string, entity: T): Promise<void> {
    60			return this.storage.set({ [`${this.root}@${id}`]: JSON.stringify(entity) })
    61		}
    62	
    63		public delete(id: string): Promise<void> {
    64			return this.storage.remove(`${this.root}@${id}`)
    65		}
    66	
    67		public async getAll(): Promise<Array<[string, T]>> {
    68			const path = `${this.root}@`
    69			const res = await this.storage.get(null)
    70			return Object.entries(res)
    71				.filter(([k, _]) => k.startsWith(path))
    72				.map(([k, v]) => [k.substring(path.length), JSON.parse(v as string)])
    73		}
    74	
    75		public async getKeys(): Promise<Array<string>> {
    76			const path = `${this.root}@`
    77			const res = await this.storage.get(null)
    78			return Object.keys(res)
    79				.filter((k) => k.startsWith(path))
    80				.map((k) => k.substring(path.length))
    81		}
    82	
    83		public async getValues(): Promise<Array<T>> {
    84			const path = `${this.root}@`
    85			const res = await this.storage.get(null)
    86			return Object.entries(res)
    87				.filter(([k, _]) => k.startsWith(path))
    88				.map(([_, v]) => JSON.parse(v as string))
    89		}
    90	
    91		public async findByPredicate(predicate: (entity: T) => boolean): Promise<Array<{ key: string; entity: T }>> {
    92			const allEntities = await this.getAll()
    93			const foundEntities = allEntities.filter(([, entity]) => predicate(entity)).map(([key, entity]) => ({ key, entity }))
    94	
    95			return foundEntities
    96		}
    97	}

---
     1	import type { StorageArea } from "@/core/ports"
     2	import { StorageType } from "."
     3	
     4	/**
     5	 * Minimal storage surface ValueStorage actually uses. Both
     6	 * `chrome.storage.StorageArea` (legacy path) and our port's `StorageArea`
     7	 * (injected path, used by tests via FakeBrowserApi) satisfy it.
     8	 */
     9	type MinimalArea = {
    10		get(keys?: string | string[] | null): Promise<Record<string, unknown>>
    11		set(items: Record<string, unknown>): Promise<void>
    12		remove(keys: string | string[]): Promise<void>
    13	}
    14	
    15	export class ValueStorage<T> {
    16		private readonly storage: MinimalArea
    17		private readonly root: string
    18	
    19		/**
    20		 * Two constructor shapes — mirrors `EntityStorage` exactly:
    21		 * 1. Legacy — pass a `StorageType` enum value; reaches into `chrome.storage`.
    22		 * 2. Injected — pass a `StorageArea` port; used by tests and the future
    23		 *    composition root.
    24		 */
    25		constructor(root: string, areaOrType: StorageType | StorageArea = StorageType.Local) {
    26			this.root = root
    27			if (typeof areaOrType === "number") {
    28				this.storage = areaOrType === StorageType.Local ? chrome.storage.local : chrome.storage.session
    29			} else {
    30				this.storage = areaOrType as MinimalArea
    31			}
    32		}
    33	
    34		public async get(): Promise<T | undefined> {
    35			const res = await this.storage.get(this.root)
    36			if (this.root in res) {
    37				return JSON.parse(res[this.root] as string)
    38			}
    39			return undefined
    40		}
    41	
    42		public set(value: T): Promise<void> {
    43			return this.storage.set({ [this.root]: JSON.stringify(value) })
    44		}
    45	
    46		public delete(): Promise<void> {
    47			return this.storage.remove(this.root)
    48		}
    49	}

---
     1	import { StorageType } from "."
     2	
     3	export class SimpleStorage<T> {
     4		private readonly storage: chrome.storage.StorageArea
     5		private readonly root: string
     6	
     7		constructor(root: string, type: StorageType = StorageType.Local) {
     8			this.root = root
     9			this.storage = type === StorageType.Local ? chrome.storage.local : chrome.storage.session
    10		}
    11	
    12		public async getAll(): Promise<Record<string, T>> {
    13			const all = await this.storage.get()
    14			const path = `${this.root}:`
    15			const result: Record<string, T> = {}
    16	
    17			for (const fullKey in all) {
    18				if (fullKey.startsWith(path)) {
    19					const key = fullKey.slice(path.length)
    20					try {
    21						result[key] = JSON.parse(all[fullKey])
    22					} catch {}
    23				}
    24			}
    25	
    26			return result
    27		}
    28	
    29		public async get(key: string): Promise<T | undefined> {
    30			const path = `${this.root}:${key}`
    31			const res = await this.storage.get(path)
    32			if (path in res) {
    33				return JSON.parse(res[path])
    34			}
    35			return undefined
    36		}
    37	
    38		public set(key: string, value: T): Promise<void> {
    39			const path = `${this.root}:${key}`
    40			return this.storage.set({ [path]: JSON.stringify(value) })
    41		}
    42	
    43		public delete(key: string): Promise<void> {
    44			const path = `${this.root}:${key}`
    45			return this.storage.remove(path)
    46		}
    47	}

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/rpc/types.ts | sed -n '1,80p' && printf '\\n---\\n' && nl -ba packages/extension/vitest.config.ts | sed -n '1,80p' && printf '\\n---\\n' && nl -ba packages/extension/src/types/vite-env.d.ts | sed -n '1,40p'" in (project root)
 succeeded in 0ms:
     1	import packageJson from "../../../../package.json"
     2	const { version } = packageJson
     3	
     4	export const NuloWalletInfo: WalletInfo = {
     5		name: "Nulo",
     6		description:
     7			"User-friendly self-custody wallet for Aztec network, preserving your privacy and revealing the power of account abstraction.",
     8		logo: chrome.runtime.getURL("/src/assets/logo.png"),
     9		url: "https://nulo.sh",
    10		version,
    11		capabilities: ["batch_execution"],
    12	}
    13	
    14	export type WalletInfo = {
    15		name: string
    16		description: string
    17		logo: string
    18		url: string
    19		version: string
    20		capabilities: string[]
    21	}
    22	
    23	export enum RpcMethod {
    24		get_wallet_info = "get_wallet_info",
    25		get_session = "get_session",
    26		close_session = "close_session",
    27		execute = "execute",
    28	}
    29	
    30	export enum RpcEvent {
    31		session_updated = "session_updated",
    32		session_closed = "session_closed",
    33	}

---
     1	import { fileURLToPath, URL } from "node:url"
     2	import { defineConfig } from "vitest/config"
     3	
     4	export default defineConfig({
     5		resolve: {
     6			alias: {
     7				"@": fileURLToPath(new URL("./src", import.meta.url)),
     8			},
     9		},
    10		test: {
    11			globals: true,
    12			environment: "jsdom",
    13			setupFiles: "./tests/vitest.setup.ts",
    14			exclude: ["tests/e2e/**", "node_modules/**"],
    15		},
    16	})

---
     1	/// <reference types="vite/client" />
     2	/// <reference types="vite-plugin-pages/client" />
     3	
     4	declare const __VERSION__: string
     5	declare const __SENTINEL__: string
     6	declare const __AZTEC_VERSION__: string
     7	declare const __NAME__: string
     8	declare const __DISPLAY_NAME__: string

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/base/utils.ts | sed -n '1,80p' && printf '\\n---\\n' && nl -ba packages/extension/src/wallet/base/background/service.ts | sed -n '1,120p' && printf '\\n---\\n' && nl -ba packages/extension/src/wallet/base/background/client.ts | sed -n '1,180p' && printf '\\n---\\n' && nl -ba packages/extension/src/wallet/base/offscreen/service.ts | sed -n '1,120p' && printf '\\n---\\n' && nl -ba packages/extension/src/wallet/base/offscreen/client.ts | sed -n '1,170p'" in (project root)
 succeeded in 0ms:
     1	import { array_max } from "@/wallet/utils"
     2	
     3	export const wrapParams = (params: unknown[]): Record<number, unknown> => {
     4		return params.reduce<Record<number, unknown>>((acc, v, i) => {
     5			acc[i] = v
     6			return acc
     7		}, {})
     8	}
     9	
    10	export const unwrapParams = <T>(params: T): T => {
    11		const keys = Object.keys(params as Record<number, unknown>).map((x) => +x)
    12		if (!keys.length) return [] as T
    13	
    14		const res = []
    15		const max = array_max(keys)
    16		for (let i = 0; i <= max; i++) {
    17			res.push((params as Record<number, unknown>)[i])
    18		}
    19	
    20		return res as T
    21	}

---
     1	import { type ILogger, LogLevel } from "@/wallet/logger"
     2	import { sleep } from "@/wallet/utils"
     3	import { getErrorMessage } from "@/wallet/utils/errors"
     4	import { jsonSanitize } from "@/wallet/utils/serialization"
     5	import type { EventsMap, MethodsMap, MethodsSpec, IService, EventsSpec, ServiceCollection } from "../."
     6	import { WalletError } from "../errors"
     7	import { MessageType, type EventMessage, type RequestMessage, type ResponseMessage } from "../messages"
     8	import { unwrapParams } from "../utils"
     9	
    10	export abstract class Service<TRequests extends MethodsMap, TEvents extends EventsMap = {}> implements IService {
    11		public readonly name: string
    12		protected readonly logger: ILogger
    13		private readonly clients: chrome.runtime.Port[] = []
    14		private get events() {
    15			return this as unknown as EventsSpec<TEvents>
    16		}
    17		private get requests() {
    18			return this as unknown as MethodsSpec<TRequests>
    19		}
    20		private initialized = false
    21	
    22		protected constructor(name: string, logger: ILogger) {
    23			this.name = name
    24			this.logger = logger
    25			chrome.runtime.onConnect.addListener(this.onConnect)
    26			this.logDebug("Service created")
    27		}
    28	
    29		protected async init(_services: ServiceCollection): Promise<void> {
    30			// to be overridden in derived classes
    31		}
    32	
    33		public async start(services: ServiceCollection) {
    34			if (this.initialized) return
    35			await this.init(services)
    36			this.initialized = true
    37			this.logDebug("Service started")
    38		}
    39	
    40		private readonly onConnect = (client: chrome.runtime.Port) => {
    41			if (client.name !== this.name) {
    42				return
    43			}
    44			client.onDisconnect.addListener(this.onDisconnect)
    45			client.onMessage.addListener(this.onMessage)
    46			this.clients.push(client)
    47			this.logDebug(`Client connected. Total: ${this.clients.length}`)
    48		}
    49	
    50		private readonly onDisconnect = (client: chrome.runtime.Port) => {
    51			client.onDisconnect.removeListener(this.onDisconnect)
    52			client.onMessage.removeListener(this.onMessage)
    53			const index = this.clients.indexOf(client)
    54			if (index === -1) {
    55				this.logWarn("Unknown client disconnected")
    56				return
    57			}
    58			this.clients.splice(index, 1)
    59			this.logDebug(`Client disconnected. Total: ${this.clients.length}`)
    60		}
    61	
    62		private readonly onMessage = async (message: RequestMessage<TRequests>, client: chrome.runtime.Port) => {
    63			if (message?.type !== MessageType.Request || !message.content) {
    64				this.logWarn("Invalid message received", message)
    65				return
    66			}
    67			const { requestId, method, params: wrappedParams } = message.content
    68			if (!requestId || !(method in this.requests) || typeof wrappedParams !== "object") {
    69				this.logWarn("Invalid request received", message)
    70				return
    71			}
    72			const params = unwrapParams(wrappedParams)
    73			this.logDebug("Request received", requestId, method, params)
    74			let response: ResponseMessage<TRequests>
    75			try {
    76				const result = await this.requests[method](...params)
    77				this.logDebug("Request processed", requestId, result)
    78				response = {
    79					type: MessageType.Response,
    80					content: {
    81						requestId,
    82						result: jsonSanitize(result),
    83					},
    84				}
    85			} catch (error) {
    86				const errorMessage = getErrorMessage(error)
    87				this.logDebug("Request failed", requestId, errorMessage)
    88				// WalletError subclasses round-trip as structured payloads so the
    89				// client can reconstruct the original class + code + details.
    90				const errorPayload = error instanceof WalletError ? error.toPayload() : undefined
    91				response = {
    92					type: MessageType.Response,
    93					content: {
    94						requestId,
    95						error: errorMessage,
    96						...(errorPayload ? { errorPayload } : {}),
    97					},
    98				}
    99			}
   100			this.send(response, client)
   101			this.logDebug("Response sent", response)
   102		}
   103	
   104		protected emit<T extends keyof TEvents>(event: T, payload: TEvents[T]) {
   105			const message: EventMessage<TEvents> = {
   106				type: MessageType.Event,
   107				content: {
   108					event,
   109					payload: jsonSanitize(payload),
   110				},
   111			}
   112			for (const client of this.clients) {
   113				this.send(message, client)
   114			}
   115			this.events[event].invoke(payload)
   116			this.logDebug("Event sent", message)
   117		}
   118	
   119		private send(message: unknown, client: chrome.runtime.Port) {
   120			try {

---
     1	import { type ILogger, LogLevel } from "@/wallet/logger"
     2	import { sleep } from "@/wallet/utils"
     3	import { EventHandler } from "@/wallet/utils/event-handler"
     4	import { getErrorMessage } from "@/wallet/utils/errors"
     5	import { jsonSanitize } from "@/wallet/utils/serialization"
     6	import type { EventsMap, EventsSpec, MethodsMap } from "../."
     7	import { RpcTimeoutError, walletErrorFromPayload } from "../errors"
     8	import { MessageType, type EventMessage, type RequestMessage, type ResponseMessage } from "../messages"
     9	import { wrapParams } from "../utils"
    10	
    11	/** Default upper bound on any RPC request. Individual calls can override.
    12	 *
    13	 *  30s was too tight: PXE-backed views (getGasBalances, simulateTx on
    14	 *  a cold PXE, etc.) routinely run past that on local networks and a
    15	 *  freshly-unlocked wallet. The timeout exists to catch a wedged SW, not
    16	 *  to police slow-but-healthy calls — 60s gives real work room to finish
    17	 *  while still surfacing a hang. */
    18	export const DEFAULT_RPC_TIMEOUT_MS = 60_000
    19	
    20	/** Stored per-request resolver set. The timeout handle is cleared on terminal state. */
    21	type PendingRequest = {
    22		resolve: (result: unknown) => void
    23		reject: (error: unknown) => void
    24		timeoutHandle?: ReturnType<typeof setTimeout>
    25	}
    26	
    27	export abstract class ServiceClient<TRequests extends MethodsMap, TEvents extends EventsMap = {}> {
    28		public onConnected: EventHandler<void> = new EventHandler()
    29		public onDisconnected: EventHandler<void> = new EventHandler()
    30	
    31		private readonly name: string
    32		private readonly service: string
    33		private readonly logger: ILogger
    34		private readonly defaultTimeoutMs: number
    35	
    36		private state: ClientState = ClientState.Disconnected
    37		private readonly requests: Map<number, PendingRequest> = new Map()
    38		private nextRequestId = 1
    39		private port?: chrome.runtime.Port
    40	
    41		protected constructor(service: string, logger: ILogger, name?: string, options?: { requestTimeoutMs?: number }) {
    42			this.name = name ?? `${service}-client`
    43			this.service = service
    44			this.logger = logger
    45			this.defaultTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS
    46		}
    47	
    48		public async connect() {
    49			if (this.state !== ClientState.Disconnected) {
    50				return
    51			}
    52			this.state = ClientState.Connecting
    53			while (this.state === ClientState.Connecting) {
    54				try {
    55					this.port = chrome.runtime.connect(undefined, { name: this.service })
    56					this.port.onDisconnect.addListener(this.onDisconnect)
    57					this.port.onMessage.addListener(this.onMessage)
    58					this.state = ClientState.Connected
    59					this.logDebug("Connected")
    60					this.onConnected.invoke()
    61					return
    62				} catch (error) {
    63					this.logError("Failed to connect", getErrorMessage(error))
    64					await sleep(1000)
    65				}
    66			}
    67		}
    68	
    69		public disconnect() {
    70			this.state = ClientState.Disconnecting
    71			if (this.port) {
    72				this.port.onMessage.removeListener(this.onMessage)
    73				this.port.onDisconnect.removeListener(this.onDisconnect)
    74				this.port.disconnect()
    75				this.port = undefined
    76			}
    77			if (this.requests.size) {
    78				this.requests.forEach((entry) => {
    79					if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle)
    80					entry.reject(new Error("Client disconnected"))
    81				})
    82				this.requests.clear()
    83			}
    84			this.state = ClientState.Disconnected
    85			this.logDebug("Disconnected")
    86			this.onDisconnected.invoke()
    87		}
    88	
    89		private readonly onDisconnect = () => {
    90			this.disconnect()
    91			this.connect()
    92		}
    93	
    94		private readonly onMessage = (message: ResponseMessage<TRequests> | EventMessage<TEvents>) => {
    95			if ((message?.type !== MessageType.Response && message.type !== MessageType.Event) || !message.content) {
    96				this.logWarn("Invalid message received", message)
    97				return
    98			}
    99			if (message.type === MessageType.Response) {
   100				const { requestId, result, error, errorPayload } = message.content
   101				const entry = this.requests.get(requestId)
   102				if (!entry) {
   103					this.logWarn("Invalid response received", message.content)
   104					return
   105				}
   106				if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle)
   107				this.requests.delete(requestId)
   108				if (error !== undefined || errorPayload !== undefined) {
   109					// Structured payload takes precedence so `instanceof WalletError`
   110					// (and subclass) checks work on the client. Fall back to a plain
   111					// Error when the service threw something that wasn't a WalletError.
   112					const rejection = errorPayload ? walletErrorFromPayload(errorPayload) : new Error(error ?? "Unknown error")
   113					entry.reject(rejection)
   114					this.logDebug("Request rejected", message.content)
   115				} else {
   116					entry.resolve(result)
   117					this.logDebug("Request resolved", message.content)
   118				}
   119				this.logDebug("Pending requests", this.requests.size)
   120			} else {
   121				const { event, payload } = message.content
   122				this.logDebug("Event received", event, payload)
   123				;(this as EventsSpec<TEvents>)[event].invoke(payload)
   124			}
   125		}
   126	
   127		protected async request<T extends keyof TRequests>(method: T, ...params: Parameters<TRequests[T]>): Promise<ReturnType<TRequests[T]>> {
   128			while (this.state !== ClientState.Connected) {
   129				if (this.state === ClientState.Disconnected) {
   130					this.connect()
   131					continue
   132				}
   133				await sleep(300)
   134			}
   135			const requestId = this.getRequestId()
   136			const request: RequestMessage<TRequests> = {
   137				type: MessageType.Request,
   138				content: {
   139					requestId,
   140					method: method,
   141					params: jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>,
   142				},
   143			}
   144	
   145			const methodName = String(method)
   146			const timeoutMs = this.defaultTimeoutMs
   147			const start = Date.now()
   148			this.logDebug(`→ ${methodName}`)
   149	
   150			const warnTimer = setTimeout(() => {
   151				this.logWarn(`Request pending >10s: ${methodName} (id: ${requestId})`)
   152			}, 10_000)
   153	
   154			const promise = new Promise<ReturnType<TRequests[T]>>((resolve, reject) => {
   155				// Hard timeout — rejects the pending request with a typed error so
   156				// callers can distinguish "the service worker is wedged" from
   157				// "the service worker replied with an error". Clears itself on
   158				// terminal state (response / disconnect).
   159				const timeoutHandle = setTimeout(() => {
   160					const entry = this.requests.get(requestId)
   161					if (!entry) return
   162					this.requests.delete(requestId)
   163					entry.reject(new RpcTimeoutError(`RPC '${methodName}' timed out after ${timeoutMs}ms`, { requestId, methodName }))
   164					this.logWarn(`Request timed out: ${methodName} (id: ${requestId}, ${timeoutMs}ms)`)
   165				}, timeoutMs)
   166	
   167				this.requests.set(requestId, {
   168					resolve: resolve as (result: unknown) => void,
   169					reject,
   170					timeoutHandle,
   171				})
   172			})
   173			this.port!.postMessage(request)
   174	
   175			return promise.finally(() => {
   176				clearTimeout(warnTimer)
   177				this.logDebug(`← ${methodName} (${Date.now() - start}ms)`)
   178			})
   179		}
   180	

---
     1	import { type ILogger, LogLevel } from "@/wallet/logger"
     2	import { sleep } from "@/wallet/utils"
     3	import { getErrorMessage } from "@/wallet/utils/errors"
     4	import { jsonSanitize } from "@/wallet/utils/serialization"
     5	import { OFFSCREEN_KEEPALIVE } from "@/wallet/utils/offscreen"
     6	import type { EventsMap, MethodsMap, MethodsSpec, IService, EventsSpec, ServiceCollection } from "../."
     7	import { MessageType } from "../messages"
     8	import { unwrapParams } from "../utils"
     9	import type { EventMessage, RequestMessage, ResponseMessage } from "./messages"
    10	
    11	/** Send keepalive pings every 20s to prevent Chrome from killing the service worker. */
    12	const KEEPALIVE_INTERVAL_MS = 20_000
    13	
    14	export abstract class Service<TRequests extends MethodsMap, TEvents extends EventsMap = {}> implements IService {
    15		public readonly name: string
    16		private readonly logger: ILogger
    17		private get events() {
    18			return this as unknown as EventsSpec<TEvents>
    19		}
    20		private get requests() {
    21			return this as unknown as MethodsSpec<TRequests>
    22		}
    23		private initialized = false
    24	
    25		protected constructor(name: string, logger: ILogger) {
    26			this.name = name
    27			this.logger = logger
    28			chrome.runtime.onMessage.addListener(this.onMessageListener)
    29			this.logDebug("Service created")
    30		}
    31	
    32		protected async init(_services: ServiceCollection): Promise<void> {
    33			// to be overridden in derived classes
    34		}
    35	
    36		public async start(services: ServiceCollection) {
    37			if (this.initialized) return
    38			await this.init(services)
    39			this.initialized = true
    40			this.logDebug("Service started")
    41		}
    42	
    43		private readonly onMessageListener = (message: RequestMessage<TRequests>): boolean => {
    44			if (message.to === this.name) {
    45				this.onMessage(message) // fire and forget
    46			}
    47			return false
    48		}
    49	
    50		private readonly onMessage = async (message: RequestMessage<TRequests>) => {
    51			if (message?.type !== MessageType.Request || !message.from || !message.content) {
    52				this.logWarn("Invalid message received", message)
    53				return
    54			}
    55			const { requestId, method, params: wrappedParams } = message.content
    56			if (!requestId || !(method in this.requests) || typeof wrappedParams !== "object") {
    57				this.logWarn("Invalid request received", message)
    58				return
    59			}
    60			const params = unwrapParams(wrappedParams)
    61			this.logDebug("Request received", requestId, method, params)
    62	
    63			// Keep the service worker alive during long operations (PXE proof gen, etc.).
    64			// Chrome kills idle SWs after 30s — sending any message resets that timer.
    65			const keepalive = setInterval(() => {
    66				chrome.runtime.sendMessage(OFFSCREEN_KEEPALIVE).catch(() => {})
    67			}, KEEPALIVE_INTERVAL_MS)
    68	
    69			let response: ResponseMessage<TRequests>
    70			try {
    71				const result = await this.requests[method](...params)
    72				this.logDebug("Request processed", requestId, result)
    73				response = {
    74					type: MessageType.Response,
    75					content: {
    76						requestId,
    77						result: jsonSanitize(result),
    78					},
    79					from: this.name,
    80					to: message.from,
    81				}
    82			} catch (error) {
    83				const errorMessage = getErrorMessage(error)
    84				this.logDebug("Request failed", requestId, errorMessage)
    85				response = {
    86					type: MessageType.Response,
    87					content: {
    88						requestId,
    89						error: errorMessage,
    90					},
    91					from: this.name,
    92					to: message.from,
    93				}
    94			} finally {
    95				clearInterval(keepalive)
    96			}
    97			try {
    98				await chrome.runtime.sendMessage(response)
    99				this.logDebug("Response sent", response)
   100			} catch {
   101				// Service worker is dead — response is lost. The client-side timeout
   102				// (in offscreen/client.ts) will reject the caller's promise.
   103			}
   104		}
   105	
   106		protected emit<T extends keyof TEvents>(event: T, payload: TEvents[T]) {
   107			const message: EventMessage<TEvents> = {
   108				type: MessageType.Event,
   109				content: {
   110					event,
   111					payload: jsonSanitize(payload),
   112				},
   113				from: this.name,
   114			}
   115			chrome.runtime.sendMessage(message).catch(() => {
   116				// Service worker is dead — event is lost.
   117			})
   118			this.events[event].invoke(payload)
   119			this.logDebug("Event sent", message)
   120		}

---
     1	import { type ILogger, LogLevel } from "@/wallet/logger"
     2	import { getRandomHex } from "@/wallet/utils"
     3	import { ensureOffscreenRunning } from "@/wallet/utils/offscreen"
     4	import { jsonSanitize } from "@/wallet/utils/serialization"
     5	import { MessageType } from "../messages"
     6	import type { EventsMap, EventsSpec, MethodsMap } from "../."
     7	import type { EventMessage, RequestMessage, ResponseMessage } from "./messages"
     8	import { wrapParams } from "../utils"
     9	
    10	/** Timeout for offscreen requests (ms). PXE operations can take 60s+ (fetch timeout + proof gen). */
    11	const REQUEST_TIMEOUT_MS = 90_000
    12	
    13	export abstract class ServiceClient<TRequests extends MethodsMap, TEvents extends EventsMap = {}> {
    14		private readonly uid: string
    15		private readonly name: string
    16		private readonly service: string
    17		private readonly logger: ILogger
    18	
    19		private readonly requests: Map<number, [(result: unknown) => void, (error: string) => void]> = new Map()
    20		private readonly requestTimers: Map<number, NodeJS.Timeout> = new Map()
    21		private nextRequestId = 1
    22		private connected = false
    23	
    24		protected constructor(service: string, logger: ILogger, name?: string) {
    25			this.uid = getRandomHex(8)
    26			this.name = name ?? `${service}-client`
    27			this.service = service
    28			this.logger = logger
    29		}
    30	
    31		public connect() {
    32			if (this.connected) return
    33			chrome.runtime.onMessage.addListener(this.onMessageListener)
    34			this.connected = true
    35			this.logDebug("Connected")
    36		}
    37	
    38		public disconnect() {
    39			if (!this.connected) return
    40			this.connected = false
    41			chrome.runtime.onMessage.removeListener(this.onMessageListener)
    42			this.requestTimers.forEach((timer) => clearTimeout(timer))
    43			this.requestTimers.clear()
    44			if (this.requests.size) {
    45				this.requests.forEach(([_, reject]) => reject("Client disconnected"))
    46				this.requests.clear()
    47			}
    48			this.logDebug("Disconnected")
    49		}
    50	
    51		private readonly onMessageListener = (message: ResponseMessage<TRequests> | EventMessage<TEvents>): boolean => {
    52			if (message.to === this.uid || (message.type === MessageType.Event && message.from === this.service && message.to === undefined)) {
    53				this.onMessage(message) // fire and forget
    54			}
    55			return false
    56		}
    57	
    58		private readonly onMessage = (message: ResponseMessage<TRequests> | EventMessage<TEvents>) => {
    59			if (
    60				(message?.type !== MessageType.Response && message.type !== MessageType.Event) ||
    61				message.from !== this.service ||
    62				!message.content
    63			) {
    64				this.logWarn("Invalid message received", message)
    65				return
    66			}
    67			if (message.type === MessageType.Response) {
    68				const { requestId, result, error } = message.content
    69				const requestPromise = this.requests.get(requestId)
    70				if (!requestPromise) {
    71					this.logWarn("Invalid response received", message.content)
    72					return
    73				}
    74				const [resolve, reject] = requestPromise
    75				if (error !== undefined) {
    76					reject(error)
    77					this.logDebug("Request rejected", message.content)
    78				} else {
    79					resolve(result)
    80					this.logDebug("Request resolved", message.content)
    81				}
    82				this.requests.delete(requestId)
    83				const timer = this.requestTimers.get(requestId)
    84				if (timer) {
    85					clearTimeout(timer)
    86					this.requestTimers.delete(requestId)
    87				}
    88				this.logDebug("Pending requests", this.requests.size)
    89			} else {
    90				const { event, payload } = message.content
    91				this.logDebug("Event received", event, payload)
    92				;(this as EventsSpec<TEvents>)[event].invoke(payload)
    93			}
    94		}
    95	
    96		/**
    97		 * Non-overridable template: runs base transport-readiness
    98		 * (`ensureOffscreenRunning()`), then invokes the subclass
    99		 * `onReady()` hook. Called from every request before the message
   100		 * is sent so no subclass can forget to prepare the transport.
   101		 */
   102		private async ensureReady(): Promise<void> {
   103			await ensureOffscreenRunning()
   104			await this.onReady()
   105		}
   106	
   107		/**
   108		 * Overridable hook: runs AFTER base transport-readiness for any
   109		 * subclass-specific post-transport setup. Default is no-op. Do NOT
   110		 * call `ensureOffscreenRunning()` from an override — the base has
   111		 * already done it by the time this is invoked.
   112		 */
   113		protected async onReady(): Promise<void> {
   114			// no-op by default
   115		}
   116	
   117		protected async request<T extends keyof TRequests>(method: T, ...params: Parameters<TRequests[T]>): Promise<ReturnType<TRequests[T]>> {
   118			if (!this.connected) {
   119				this.connect()
   120			}
   121			await this.ensureReady()
   122			const request: RequestMessage<TRequests> = {
   123				type: MessageType.Request,
   124				content: {
   125					requestId: this.getRequestId(),
   126					method: method,
   127					params: jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>,
   128				},
   129				from: this.uid,
   130				to: this.service,
   131			}
   132			const requestId = request.content.requestId
   133			const promise = new Promise<ReturnType<TRequests[T]>>((resolve, reject) => {
   134				this.requests.set(requestId, [resolve as (result: unknown) => void, reject])
   135				const timer = setTimeout(() => {
   136					if (this.requests.delete(requestId)) {
   137						this.requestTimers.delete(requestId)
   138						const methodName = String(method)
   139						this.logError(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${methodName}`)
   140						reject(`Offscreen request timed out: ${methodName}`)
   141					}
   142				}, REQUEST_TIMEOUT_MS)
   143				this.requestTimers.set(requestId, timer)
   144			})
   145			await chrome.runtime.sendMessage(request)
   146			this.logDebug("Request sent", request)
   147			this.logDebug("Pending requests", this.requests.size)
   148			return promise
   149		}
   150	
   151		private getRequestId() {
   152			return this.nextRequestId++
   153		}
   154	
   155		protected logDebug(...data: unknown[]) {
   156			this.logger.log(this.name, LogLevel.Debug, ...data)
   157		}
   158	
   159		protected logInfo(...data: unknown[]) {
   160			this.logger.log(this.name, LogLevel.Info, ...data)
   161		}
   162	
   163		protected logWarn(...data: unknown[]) {
   164			this.logger.log(this.name, LogLevel.Warn, ...data)
   165		}
   166	
   167		protected logError(...data: unknown[]) {
   168			this.logger.log(this.name, LogLevel.Error, ...data)
   169		}
   170	}

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/passkey/spec.ts | sed -n '1,40p' && printf '\\n---CRED---\\n' && nl -ba packages/extension/src/wallet/services/passkey/credential.ts | sed -n '1,60p' && printf '\\n---VECTORS---\\n' && nl -ba packages/extension/src/wallet/crypto/key-vectors.test.ts | sed -n '65,205p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/src/offscreen/index.ts | sed -n '1,120p' && printf '\\n---HTML---\\n' && nl -ba packages/extension/src/offscreen/index.html | sed -n '1,80p' && printf '\\n---OFFSCREEN UTIL---\\n' && nl -ba packages/extension/src/wallet/utils/offscreen.ts | sed -n '1,160p'" in (project root)
 succeeded in 0ms:
     1	import { ServiceCollection } from "@/wallet/base"
     2	import { consoleMethods, LogLevel } from "@/wallet/logger"
     3	import { LoggerServiceClient } from "@/wallet/services/logger/client"
     4	import { PxeService } from "@/wallet/services/pxe/service"
     5	import { getErrorData } from "@/wallet/utils/errors"
     6	import { OFFSCREEN_READY_MESSAGE, OFFSCREEN_PING, OFFSCREEN_PONG } from "@/wallet/utils/offscreen"
     7	
     8	// Respond to health check pings from the service worker.
     9	// Registered before anything else so even a slow init doesn't block pong.
    10	chrome.runtime.onMessage.addListener((message) => {
    11		if (message === OFFSCREEN_PING) {
    12			chrome.runtime.sendMessage(OFFSCREEN_PONG).catch(() => {})
    13		}
    14		return false
    15	})
    16	
    17	// catch console
    18	const logger = new LoggerServiceClient("offscreen")
    19	for (const [method, level] of consoleMethods) {
    20		// biome-ignore lint/suspicious/noExplicitAny: dynamic global property + console varargs
    21		;(self as any)[`on${method}`] = (...args: any[]) => {
    22			logger.log("pxe", level, ...args)
    23		}
    24	}
    25	
    26	// catch unhandled errors
    27	self.onunhandledrejection = (e: PromiseRejectionEvent) => {
    28		try {
    29			logger.log("pxe", LogLevel.Error, getErrorData(e.reason))
    30		} catch {
    31			// Logger itself may fail if SW is dead — don't cascade
    32		}
    33	}
    34	
    35	// run services — await initialization before signaling ready
    36	const t0 = Date.now()
    37	const services = new ServiceCollection()
    38	services.add(new PxeService())
    39	await services.start()
    40	logger.log("pxe", LogLevel.Info, `Offscreen services initialized (${Date.now() - t0}ms)`)
    41	
    42	// notify bg only after services are actually initialized
    43	chrome.runtime.sendMessage(OFFSCREEN_READY_MESSAGE)

---HTML---
     1	<!DOCTYPE html>
     2	<html lang="en">
     3		<head>
     4			<meta charset="UTF-8" />
     5			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
     6			<script type="module" src="../utils/console-sniffer.ts"></script>
     7		</head>
     8		<body>
     9			<script type="module" src="./index.ts"></script>
    10		</body>
    11	</html>

---OFFSCREEN UTIL---
     1	export const OFFSCREEN_READY_MESSAGE = "OFFSCREEN_READY"
     2	export const OFFSCREEN_PING = "OFFSCREEN_PING"
     3	export const OFFSCREEN_PONG = "OFFSCREEN_PONG"
     4	export const OFFSCREEN_KEEPALIVE = "OFFSCREEN_KEEPALIVE"
     5	
     6	let offscreenTimeout: NodeJS.Timeout
     7	let offscreenPromise: Promise<void> | null = null
     8	let resolveOffscreenPromise: () => void
     9	let rejectOffscreenPromise: (reason: string) => void
    10	
    11	const HEALTH_CHECK_TIMEOUT_MS = 3_000
    12	const READY_TIMEOUT_MS = 10_000
    13	
    14	const path = "src/offscreen/index.html"
    15	const offscreenUrl = chrome.runtime.getURL(path)
    16	const onOffscreenReady = (message: unknown) => {
    17		if (message === OFFSCREEN_READY_MESSAGE) {
    18			chrome.runtime.onMessage.removeListener(onOffscreenReady)
    19			clearTimeout(offscreenTimeout)
    20			resolveOffscreenPromise()
    21			offscreenPromise = null
    22		}
    23		return false
    24	}
    25	const onOffscreenTimeout = () => {
    26		chrome.runtime.onMessage.removeListener(onOffscreenReady)
    27		// Kill the half-initialized offscreen so it doesn't become a ghost
    28		chrome.offscreen.closeDocument().catch(() => {})
    29		rejectOffscreenPromise("Offscreen is not responding")
    30		offscreenPromise = null
    31	}
    32	
    33	/**
    34	 * Check if the existing offscreen document is responsive.
    35	 * Sends a ping and waits for a pong within HEALTH_CHECK_TIMEOUT_MS.
    36	 * Returns true if healthy, false if zombie/unresponsive.
    37	 */
    38	async function isOffscreenHealthy(): Promise<boolean> {
    39		return new Promise<boolean>((resolve) => {
    40			const timer = setTimeout(() => {
    41				chrome.runtime.onMessage.removeListener(onPong)
    42				resolve(false)
    43			}, HEALTH_CHECK_TIMEOUT_MS)
    44	
    45			const onPong = (message: unknown) => {
    46				if (message === OFFSCREEN_PONG) {
    47					chrome.runtime.onMessage.removeListener(onPong)
    48					clearTimeout(timer)
    49					resolve(true)
    50				}
    51				return false
    52			}
    53	
    54			chrome.runtime.onMessage.addListener(onPong)
    55			chrome.runtime.sendMessage(OFFSCREEN_PING).catch(() => {
    56				// No receiver — offscreen is definitely dead
    57				chrome.runtime.onMessage.removeListener(onPong)
    58				clearTimeout(timer)
    59				resolve(false)
    60			})
    61		})
    62	}
    63	
    64	/**
    65	 * Close any existing offscreen document, ignoring errors.
    66	 */
    67	async function closeOffscreen() {
    68		try {
    69			await chrome.offscreen.closeDocument()
    70		} catch {
    71			// Already closed or Chrome cleaned it up
    72		}
    73	}
    74	
    75	/**
    76	 * Create the offscreen document. Handles the Chrome ghost bug where
    77	 * getContexts() returns empty but createDocument() throws "already exists".
    78	 */
    79	async function createOffscreen() {
    80		try {
    81			await chrome.offscreen.createDocument({
    82				url: path,
    83				reasons: ["WORKERS"],
    84				justification: "Offscreen document is used for running PXE in it",
    85			})
    86		} catch (err) {
    87			if (String(err).includes("single offscreen document")) {
    88				// Ghost offscreen — close it and retry once
    89				await closeOffscreen()
    90				await chrome.offscreen.createDocument({
    91					url: path,
    92					reasons: ["WORKERS"],
    93					justification: "Offscreen document is used for running PXE in it",
    94				})
    95			} else {
    96				throw err
    97			}
    98		}
    99	}
   100	
   101	export async function ensureOffscreenRunning() {
   102		const existingContexts = await chrome.runtime.getContexts({
   103			contextTypes: ["OFFSCREEN_DOCUMENT"],
   104			documentUrls: [offscreenUrl],
   105		})
   106	
   107		if (existingContexts.length > 0) {
   108			// Offscreen exists — verify it's actually responsive
   109			if (await isOffscreenHealthy()) {
   110				return
   111			}
   112			// Zombie offscreen — kill it and recreate below
   113			await closeOffscreen()
   114		}
   115	
   116		if (!offscreenPromise) {
   117			offscreenPromise = new Promise((resolve, reject) => {
   118				resolveOffscreenPromise = resolve
   119				rejectOffscreenPromise = reject
   120			})
   121			offscreenTimeout = setTimeout(onOffscreenTimeout, READY_TIMEOUT_MS)
   122			chrome.runtime.onMessage.addListener(onOffscreenReady)
   123			try {
   124				await createOffscreen()
   125			} catch (err) {
   126				clearTimeout(offscreenTimeout)
   127				chrome.runtime.onMessage.removeListener(onOffscreenReady)
   128				offscreenPromise = null
   129				throw err
   130			}
   131		}
   132	
   133		await offscreenPromise
   134	}

 succeeded in 0ms:
     1	export const PASSKEY_SERVICE_NAME = "passkey"
     2	// SECURITY: Domain separator in the key derivation chain. Changing this label
     3	// produces different keys and invalidates every existing passkey wallet.
     4	export const PASSKEY_PRF_LABEL = "nulo:profile:v1"
     5	export const PASSKEY_TIMEOUT = 60_000 * 3 // 3 minutes
     6	
     7	export type PasskeyCredentialData = {
     8		id: string // base64
     9		prf: string // base64
    10		userHandle?: string // hex
    11	}
    12	
    13	export type PasskeyRequest =
    14		| {
    15				mode: "create"
    16				userHandle: string
    17		  }
    18		| {
    19				mode: "get"
    20				credentialId?: string
    21		  }
    22	
    23	import type { PasskeyCredential } from "./credential"
    24	
    25	export type PasskeyRequestPromise = {
    26		resolve: (r: PasskeyCredential) => void
    27		reject: (reason: string) => void
    28		request: PasskeyRequest
    29	}
    30	
    31	export type Methods = {
    32		/**
    33		 * Returns details for the pending request so the window can proceed.
    34		 * @param requestId Pending request identifier.
    35		 */
    36		getPendingRequest(requestId: string): PasskeyRequest
    37	
    38		/**
    39		 * Resolves a pending request, completing the promise.
    40		 * @param requestId Pending request identifier.

---CRED---
     1	import { Fr } from "@aztec/foundation/curves/bn254"
     2	import type { PasskeyCredentialData } from "./spec"
     3	
     4	const te = new TextEncoder()
     5	
     6	// SECURITY: Domain separators in the key derivation chain. Changing these labels
     7	// produces different keys and invalidates every existing passkey wallet.
     8	const PASSKEY_KDF_LABEL = te.encode("nulo:kdf:v1")
     9	const PASSKEY_MASTER_LABEL = te.encode("nulo:master:v1")
    10	
    11	export class PasskeyCredential {
    12		public readonly id: string
    13		public readonly userHandle?: string
    14		private baseKey: CryptoKey
    15		private salt: ArrayBuffer
    16	
    17		private constructor(id: string, baseKey: CryptoKey, salt: ArrayBuffer, userHandle?: string) {
    18			this.id = id
    19			this.userHandle = userHandle
    20			this.baseKey = baseKey
    21			this.salt = salt
    22		}
    23	
    24		public static async create(params: PasskeyCredentialData): Promise<PasskeyCredential> {
    25			const ikm = Buffer.from(params.prf, "base64")
    26			const credential = Buffer.from(params.id, "base64")
    27			const saltInput = Buffer.concat([PASSKEY_KDF_LABEL, credential])
    28			const baseKey = await self.crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"])
    29			const salt = await self.crypto.subtle.digest("SHA-256", saltInput)
    30			return new PasskeyCredential(params.id, baseKey, salt, params.userHandle)
    31		}
    32	
    33		public async deriveMasterSecret(): Promise<Buffer<ArrayBuffer>> {
    34			const masterBits = await self.crypto.subtle.deriveBits(
    35				{ name: "HKDF", hash: "SHA-256", salt: this.salt, info: PASSKEY_MASTER_LABEL },
    36				this.baseKey,
    37				256,
    38			)
    39			const masterFr = Fr.fromBufferReduce(Buffer.from(new Uint8Array(masterBits)))
    40			return masterFr.toBuffer() as Buffer<ArrayBuffer>
    41		}
    42	}

---VECTORS---
    65	import { describe, expect, test } from "vitest"
    66	import { Fr } from "@aztec/foundation/curves/bn254"
    67	import { deriveSigningKey } from "@aztec/stdlib/keys"
    68	import { EncryptionKey } from "@/wallet/services/profile/encryption/encryption-key"
    69	import { PasskeyCredential } from "@/wallet/services/passkey/credential"
    70	import { PASSKEY_PRF_LABEL } from "@/wallet/services/passkey/spec"
    71	import { AccountType } from "@/wallet/services/account/spec"
    72	
    73	/** Reusable hex helper — keeps fixture constants readable. */
    74	const toHex = (buf: ArrayBuffer | Uint8Array) => {
    75		const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    76		return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
    77	}
    78	const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)))
    79	
    80	describe("M2.6 — cryptographic derivation vectors", () => {
    81		// ── V1: password hash ────────────────────────────────────────────
    82		//
    83		// Locks: SHA-256(UTF-8(password)). Platform Web Crypto, no Aztec dep.
    84		// Break it: change `getPasshash` from SHA-256 to SHA-384, this fails.
    85		test("V1 — getPasshash('hunter2') matches fixture", async () => {
    86			const passhash = await EncryptionKey.getPasshash("hunter2")
    87			expect(toHex(passhash)).toBe("f52fbd32b2b3b86ff88ef6c490628285f482af15ddcb29541f94bcf526a3f6c7")
    88		})
    89	
    90		// ── V2: AES-GCM round-trip with fixed IV ─────────────────────────
    91		//
    92		// Locks: PBKDF2-SHA256 at 600_000 iterations, salt = SHA-256(iv),
    93		// AES-GCM-256, 13-byte prefix [version][iv].
    94		// The committed ciphertext was captured by running the current
    95		// encrypt() with the same password, plaintext, and IV. Two
    96		// assertions hold it in place:
    97		//   (a) decrypt(COMMITTED_CIPHERTEXT) === PLAINTEXT (verifies the
    98		//       full decrypt chain against a real stored value), and
    99		//   (b) encrypt(PLAINTEXT, mocked IV) === COMMITTED_CIPHERTEXT
   100		//       (verifies encrypt's prefix assembly + AES tag emission).
   101		// Break it: change PBKDF2_ITERATIONS — both assertions fail.
   102		const V2_PASSWORD = "hunter2"
   103		const V2_PLAINTEXT_HEX = "deadbeefcafebabe0011223344556677"
   104		const V2_IV_HEX = "aaaaaaaaaaaaaaaaaaaaaaaa" // 12 bytes of 0xAA
   105		const V2_CIPHERTEXT_HEX = "00aaaaaaaaaaaaaaaaaaaaaaaabbf9b797c51cbfaff2e2be5c04eee5303a5eac28711a196e271c960d5ab16a49"
   106	
   107		test("V2a — decrypt(COMMITTED_CIPHERTEXT, password) === PLAINTEXT", async () => {
   108			const key = await EncryptionKey.fromPassword(V2_PASSWORD)
   109			const plaintext = await key.decrypt(fromHex(V2_CIPHERTEXT_HEX))
   110			expect(toHex(plaintext)).toBe(V2_PLAINTEXT_HEX)
   111		}, 10_000)
   112	
   113		test("V2b — encrypt(PLAINTEXT, mocked IV) === COMMITTED_CIPHERTEXT", async () => {
   114			const originalGRV = self.crypto.getRandomValues.bind(self.crypto)
   115			const iv = fromHex(V2_IV_HEX)
   116			// biome-ignore lint/suspicious/noExplicitAny: narrow mock with explicit restore in finally
   117			const grv = self.crypto.getRandomValues as any
   118			self.crypto.getRandomValues = ((target: Uint8Array) => {
   119				target.set(iv.slice(0, target.length))
   120				return target
   121			}) as typeof self.crypto.getRandomValues
   122			try {
   123				const key = await EncryptionKey.fromPassword(V2_PASSWORD)
   124				const ct = await key.encrypt(fromHex(V2_PLAINTEXT_HEX))
   125				expect(toHex(ct)).toBe(V2_CIPHERTEXT_HEX)
   126			} finally {
   127				self.crypto.getRandomValues = originalGRV
   128				void grv
   129			}
   130		}, 10_000)
   131	
   132		// ── V3: passkey master-secret derivation ─────────────────────────
   133		//
   134		// Locks: HKDF-SHA256, salt = SHA-256(PASSKEY_KDF_LABEL || credentialId),
   135		// info = PASSKEY_MASTER_LABEL, 256 output bits reduced through
   136		// Fr.fromBufferReduce (big-endian, mod BN254 Fr modulus).
   137		// AZTEC-SENSITIVE: depends on Fr.fromBufferReduce semantics.
   138		// Break it: change PASSKEY_KDF_LABEL — fails.
   139		// Input PRF is 32 clean bytes base64-encoded; credentialId is a
   140		// short base64 identifier mimicking a real WebAuthn credential.
   141		const V3_PRF_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
   142		const V3_CREDENTIAL_ID_B64 = "dGVzdC1jcmVkZW50aWFsLWlk"
   143	
   144		test("V3 — PasskeyCredential master secret matches fixture", async () => {
   145			const credential = await PasskeyCredential.create({ id: V3_CREDENTIAL_ID_B64, prf: V3_PRF_B64 })
   146			const master = await credential.deriveMasterSecret()
   147			expect(toHex(master)).toBe("2db78e1a82bbf002bd36281f079f797fe194ee2b04249df6e44efb30e879919a")
   148		})
   149	
   150		// ── V6: getHashHex (backup checksum) ─────────────────────────────
   151		//
   152		// Used by ImportPopup + export/full.vue to verify backup integrity.
   153		// If byte→hex encoding drifts (case change, TextEncoder swap,
   154		// SHA-256 substitution), backup import silently fails.
   155		// Platform Web Crypto, no Aztec dep.
   156		test("V6 — getHashHex('hunter2') matches fixture", async () => {
   157			const hex = await EncryptionKey.getHashHex("hunter2")
   158			expect(hex).toBe("f52fbd32b2b3b86ff88ef6c490628285f482af15ddcb29541f94bcf526a3f6c7")
   159		})
   160	
   161		// ── V7a: deriveSigningKey(secret) ────────────────────────────────
   162		//
   163		// The signing key is what actually signs transactions. This is the
   164		// primary canary for upstream drift: `deriveSigningKey` resolves to
   165		// `sha512ToGrumpkinScalar([secret, DomainSeparator.IVSK_M])`.
   166		// Upstream has a TODO to replace IVSK_M with a dedicated signing
   167		// separator (AztecProtocol/aztec-packages#5837). When that lands,
   168		// this vector fails loudly — that's the signal to migrate.
   169		// AZTEC-SENSITIVE.
   170		test("V7a — deriveSigningKey(fixedSecret) matches fixture", () => {
   171			const secret = Fr.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000042")
   172			const signingKey = deriveSigningKey(secret)
   173			expect(signingKey.toString()).toBe("0x14a31cb4d33a144675e70634830292153f78e8318e51f26a2f212783eb0a3cbc")
   174		})
   175	
   176		// ── V8: PASSKEY_PRF_LABEL spec constant ──────────────────────────
   177		//
   178		// This label is passed to `navigator.credentials.get` as the PRF
   179		// eval info. Changing it detaches PRF output from every existing
   180		// passkey wallet — same severity as changing PASSKEY_KDF_LABEL,
   181		// but V3 starts AFTER the WebAuthn call, so label drift in the
   182		// call site alone wouldn't trip V3.
   183		test("V8 — PASSKEY_PRF_LABEL is 'nulo:profile:v1'", () => {
   184			expect(PASSKEY_PRF_LABEL).toBe("nulo:profile:v1")
   185		})
   186	
   187		// ── V9: AccountType.Nulo_v1 numeric value ────────────────────────
   188		//
   189		// The enum value feeds into poseidon2Hash([master, chainId, type,
   190		// index]) as the 3rd arg. Flipping Nulo_v1 from 0 to 1 changes
   191		// every derived account secret. The spec.ts file has a
   192		// "NEVER change it" SECURITY comment but a paranoid unit lock
   193		// catches a drive-by refactor before it breaks wallets.
   194		test("V9 — AccountType.Nulo_v1 === 0", () => {
   195			expect(AccountType.Nulo_v1).toBe(0)
   196		})
   197	
   198		// ── P1: HKDF-SHA256 RFC 5869 Appendix A.1 ────────────────────────
   199		//
   200		// Cross-checks the platform HKDF implementation against a
   201		// canonical external reference, independent of our labels or
   202		// input shapes. If V3 fails AND P1 passes, the bug is in our
   203		// label/input construction. If both fail, the platform HKDF
   204		// changed (upgrade browser / Node).
   205		test("P1 — HKDF-SHA256 RFC 5869 A.1 matches", async () => {

exec
/bin/zsh -lc "nl -ba packages/extension/src/components/ui/Popup/PopupCard.vue | sed -n '1,40p' && printf '\\n---HEADER---\\n' && nl -ba packages/extension/src/components/Header.vue | sed -n '1,30p' && printf '\\n---ADDRESS DISPLAY---\\n' && nl -ba packages/extension/src/components/ui/AddressDisplay.vue | sed -n '1,40p' && printf '\\n---BASE SCSS---\\n' && nl -ba packages/extension/src/assets/styles/_base.scss | sed -n '180,225p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/logger/index.ts | sed -n '1,80p' && printf '\\n---UTILS FN---\\n' && nl -ba packages/extension/src/wallet/utils/fn.ts | sed -n '1,30p' && printf '\\n---UTILS SCHEMAS---\\n' && nl -ba packages/extension/src/wallet/utils/schemas.ts | sed -n '1,40p' && printf '\\n---UTILS OFFSCREEN---\\n' && nl -ba packages/extension/src/wallet/utils/offscreen.ts | sed -n '1,30p'" in (project root)
 succeeded in 0ms:
     1	<script setup>
     2	/** Utils */
     3	import { Config } from "@/wallet/config"
     4	import { ConfigServiceClient } from "@/wallet/services/config/client"
     5	
     6	const props = defineProps({
     7		large: {
     8			type: Boolean,
     9			default: false,
    10		},
    11		displaceIdx: {
    12			type: Number,
    13		},
    14	})
    15	
    16	const configService = new ConfigServiceClient()
    17	configService.onUpdate.add(onSettingUpdate)
    18	
    19	const showFullscreen = ref(new Config().showPopupFullscreen)
    20	
    21	function onSettingUpdate(setting) {
    22		if (setting.key === "showPopupFullscreen") {
    23			showFullscreen.value = setting.value
    24		}
    25	}
    26	
    27	onMounted(async () => {
    28		showFullscreen.value = await configService.getValue("showPopupFullscreen")
    29		if (window.innerHeight > 600) {
    30			showFullscreen.value = true
    31		}
    32	})
    33	
    34	onBeforeUnmount(() => {
    35		configService.disconnect()
    36	})
    37	</script>
    38	
    39	<template>
    40		<Flex

---HEADER---
     1	<script setup>
     2	import { Config } from "@/wallet/config"
     3	import { LogLevel } from "@/wallet/logger"
     4	import { LogViewerServiceClient } from "@/wallet/services/log-viewer/client"
     5	import { ConfigServiceClient } from "@/wallet/services/config/client"
     6	import { TaskServiceClient } from "@/wallet/services/task/client"
     7	
     8	/** Utils */
     9	import { managers } from "@/utils/core"
    10	
    11	/** Store */
    12	import { useAppStore } from "@/stores/app.store"
    13	import { useCacheStore } from "@/stores/cache.store"
    14	import { usePopupStore } from "@/stores/popup.store"
    15	const appStore = useAppStore()
    16	const cacheStore = useCacheStore()
    17	const popupStore = usePopupStore()
    18	
    19	const route = useRoute()
    20	
    21	const handleLockWallet = () => {
    22		if (!appStore.isLogined) return
    23		appStore.isLogined = false
    24		managers.profile.lockActiveProfile()
    25	}
    26	
    27	const logViewerService = new LogViewerServiceClient()
    28	logViewerService.onLog.add(onLogAdded)
    29	
    30	const configService = new ConfigServiceClient()

---ADDRESS DISPLAY---
     1	<script setup>
     2	/** Utils */
     3	import { onMounted } from "vue"
     4	import { managers } from "@/utils/core"
     5	import { trimAddress } from "@/utils/string"
     6	
     7	/** Store */
     8	import { useAppStore } from "@/stores/app.store"
     9	const appStore = useAppStore()
    10	
    11	const emit = defineEmits(["onAddressClick"])
    12	const props = defineProps({
    13		address: {
    14			type: String,
    15			required: false,
    16		},
    17		full: {
    18			type: Boolean,
    19			default: false,
    20		},
    21		formatter: {
    22			type: Function,
    23			default: null,
    24		},
    25		size: {
    26			type: String,
    27			default: "12",
    28		},
    29		weight: {
    30			type: String,
    31			default: "500",
    32		},
    33		height: {
    34			type: String,
    35			default: "100",
    36		},
    37		color: {
    38			type: String,
    39			default: "primary",
    40		},

---BASE SCSS---
   180	
   181		--bezier: cubic-bezier(0.19, 1, 0.22, 1);
   182	}
   183	
   184	@font-face {
   185		font-family: "ClashDisplay";
   186		src: local("ClashDisplay-Medium"), url("./assets/fonts/ClashDisplay-Medium.ttf");
   187	}
   188	
   189	@font-face {
   190		font-family: InterVariable;
   191		font-style: normal;
   192		font-weight: 100 900;
   193		font-display: swap;
   194		src: url("@/assets/fonts/InterVariable.woff2") format("woff2");
   195	}
   196	
   197	@font-face {
   198		font-family: "Space Grotesk";
   199		font-style: normal;
   200		font-weight: 300 700;
   201		font-display: swap;
   202		src:
   203			url("@/assets/fonts/SpaceGrotesk-latin.woff2") format("woff2"),
   204			url("@/assets/fonts/SpaceGrotesk-latin-ext.woff2") format("woff2");
   205	}
   206	
   207	@font-face {
   208		font-family: "JetBrains Mono";
   209		font-style: normal;
   210		font-weight: 400 700;
   211		font-display: swap;
   212		src: url("@/assets/fonts/JetBrainsMono-latin.woff2") format("woff2");
   213	}
   214	
   215	@font-face {
   216		font-family: "Material Symbols Outlined";
   217		font-style: normal;
   218		font-weight: 100 700;
   219		font-display: block;
   220		src: url("@/assets/fonts/MaterialSymbolsOutlined.woff2") format("woff2");
   221	}
   222	
   223	.material-symbols-outlined {
   224		font-family: "Material Symbols Outlined";
   225		font-weight: normal;

 succeeded in 0ms:
     1	import type { EventHandler } from "@/wallet/utils/event-handler"
     2	
     3	export * from "./store"
     4	export * from "./utils"
     5	
     6	export enum LogLevel {
     7		Debug = 0,
     8		Info = 1,
     9		Warn = 2,
    10		Error = 3,
    11	}
    12	
    13	export type LogContext = "sw" | "offscreen" | "popup" | "content"
    14	
    15	export type Log = {
    16		id: number
    17		timestamp: number
    18		source: string
    19		level: LogLevel
    20		context?: LogContext
    21		data: unknown[]
    22	}
    23	
    24	export interface ILogger {
    25		log(source: string, level: LogLevel, ...data: unknown[]): void
    26	}
    27	
    28	export interface ILoggerStore extends ILogger {
    29		onLog: EventHandler<Log>
    30		get(count: number, fromId?: number): Log[]
    31		clear(): void
    32	}
    33	
    34	export const consoleMethods: [string, LogLevel][] = [
    35		["trace", LogLevel.Debug],
    36		["debug", LogLevel.Debug],
    37		["log", LogLevel.Info],
    38		["info", LogLevel.Info],
    39		["warn", LogLevel.Warn],
    40		["error", LogLevel.Error],
    41	]

---UTILS FN---
     1	import { Fr } from "@aztec/foundation/curves/bn254"
     2	import { AztecAddress } from "@aztec/stdlib/aztec-address"
     3	import { ExecutionPayload, type NestedProcessReturnValues } from "@aztec/stdlib/tx"
     4	import { type AbiType, encodeArguments, type FunctionAbi, FunctionCall, FunctionSelector, FunctionType } from "@aztec/stdlib/abi"
     5	import { NuloFeePaymentMethod, type IAccountContract } from "@/wallet/services/account/contracts"
     6	import type { AztecNode } from "@aztec/stdlib/interfaces/client"
     7	import type { IPXE } from "@/wallet/services/pxe/proxy"
     8	
     9	export class FnImpl {
    10		constructor(
    11			public readonly name: string,
    12			public readonly impl: number,
    13		) {}
    14	}
    15	
    16	export abstract class Fn extends FnImpl {
    17		public readonly isStatic: boolean
    18		public readonly type: FunctionType
    19	
    20		constructor(name: string, impl: number) {
    21			super(name, impl)
    22	
    23			const abi = this.abi()
    24			this.isStatic = abi.isStatic
    25			this.type = abi.functionType
    26		}
    27	
    28		protected abstract abi(): FunctionAbi
    29	
    30		public abstract buildArgs(...args: unknown[]): unknown[]

---UTILS SCHEMAS---
     1	import { EventSelector } from "@aztec/stdlib/abi"
     2	import { Fr } from "@aztec/foundation/curves/bn254"
     3	import type { ZodFor } from "@aztec/foundation/schemas"
     4	import { Note, NoteStatus } from "@aztec/stdlib/note"
     5	import { AztecAddress } from "@aztec/stdlib/aztec-address"
     6	import { inTxSchema, TxHash } from "@aztec/stdlib/tx"
     7	import { BlockNumberSchema } from "@aztec/foundation/branded-types"
     8	import type { PackedPrivateEvent, NotesFilter } from "@aztec/pxe/client/bundle"
     9	import z from "zod"
    10	
    11	export const NoteDaoSchema = z.object({
    12		note: Note.schema,
    13		contractAddress: AztecAddress.schema,
    14		owner: AztecAddress.schema,
    15		storageSlot: Fr.schema,
    16		randomness: Fr.schema,
    17		noteNonce: Fr.schema,
    18		noteHash: Fr.schema,
    19		siloedNullifier: Fr.schema,
    20		txHash: TxHash.schema,
    21		l2BlockNumber: BlockNumberSchema,
    22		l2BlockHash: z.string(),
    23		txIndexInBlock: z.number(),
    24		noteIndexInTx: z.number(),
    25	})
    26	
    27	export const PackedPrivateEventSchema = z.intersection(
    28		inTxSchema(),
    29		z.object({
    30			packedEvent: z.array(Fr.schema),
    31			eventSelector: EventSelector.schema,
    32		}),
    33	) satisfies ZodFor<PackedPrivateEvent>
    34	
    35	export const NotesFilterSchema = z.object({
    36		contractAddress: AztecAddress.schema,
    37		owner: AztecAddress.schema.optional(),
    38		storageSlot: Fr.schema.optional(),
    39		status: z.nativeEnum(NoteStatus).optional(),
    40		siloedNullifier: Fr.schema.optional(),

---UTILS OFFSCREEN---
     1	export const OFFSCREEN_READY_MESSAGE = "OFFSCREEN_READY"
     2	export const OFFSCREEN_PING = "OFFSCREEN_PING"
     3	export const OFFSCREEN_PONG = "OFFSCREEN_PONG"
     4	export const OFFSCREEN_KEEPALIVE = "OFFSCREEN_KEEPALIVE"
     5	
     6	let offscreenTimeout: NodeJS.Timeout
     7	let offscreenPromise: Promise<void> | null = null
     8	let resolveOffscreenPromise: () => void
     9	let rejectOffscreenPromise: (reason: string) => void
    10	
    11	const HEALTH_CHECK_TIMEOUT_MS = 3_000
    12	const READY_TIMEOUT_MS = 10_000
    13	
    14	const path = "src/offscreen/index.html"
    15	const offscreenUrl = chrome.runtime.getURL(path)
    16	const onOffscreenReady = (message: unknown) => {
    17		if (message === OFFSCREEN_READY_MESSAGE) {
    18			chrome.runtime.onMessage.removeListener(onOffscreenReady)
    19			clearTimeout(offscreenTimeout)
    20			resolveOffscreenPromise()
    21			offscreenPromise = null
    22		}
    23		return false
    24	}
    25	const onOffscreenTimeout = () => {
    26		chrome.runtime.onMessage.removeListener(onOffscreenReady)
    27		// Kill the half-initialized offscreen so it doesn't become a ghost
    28		chrome.offscreen.closeDocument().catch(() => {})
    29		rejectOffscreenPromise("Offscreen is not responding")
    30		offscreenPromise = null

exec
/bin/zsh -lc "nl -ba packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js | sed -n '206,240p' && printf '\\n---\\n' && nl -ba packages/extension/node_modules/unplugin-auto-import/dist/src-CZGMhDR1.mjs | sed -n '888,905p' && printf '\\n---\\n' && nl -ba packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs | sed -n '1121,1184p' && printf '\\n---\\n' && nl -ba packages/extension/node_modules/@crxjs/vite-plugin/dist/index.mjs | sed -n '1640,1665p'" in (project root)
 succeeded in 0ms:
   206		return slash(`${excludeReg.test(glob) ? "!" : ""}${resolve(root, glob.replace(excludeReg, ""))}`);
   207	}
   208	function resolveOptions(options, root) {
   209		const resolved = Object.assign({}, defaultOptions, options);
   210		resolved.resolvers = normalizeResolvers(resolved.resolvers);
   211		resolved.extensions = toArray(resolved.extensions);
   212		if (resolved.globs) {
   213			resolved.globs = toArray(resolved.globs).map((glob) => resolveGlobsExclude(root, glob));
   214			resolved.resolvedDirs = [];
   215		} else {
   216			const extsGlob = resolved.extensions.length === 1 ? resolved.extensions : `{${resolved.extensions.join(",")}}`;
   217			resolved.dirs = toArray(resolved.dirs);
   218			const globs = resolved.dirs.map((i) => resolveGlobsExclude(root, i));
   219			resolved.resolvedDirs = globs.filter((i) => !i.startsWith("!"));
   220			resolved.globs = globs.map((i) => {
   221				let prefix = "";
   222				if (i.startsWith("!")) {
   223					prefix = "!";
   224					i = i.slice(1);
   225				}
   226				return resolved.deep ? prefix + escapeSpecialChars(slash(join(i, `**/*.${extsGlob}`))) : prefix + escapeSpecialChars(slash(join(i, `*.${extsGlob}`)));
   227			});
   228			if (!resolved.extensions.length) throw new Error("[unplugin-vue-components] `extensions` option is required to search for components");
   229		}
   230		resolved.globsExclude = toArray(resolved.globsExclude || []).map((i) => resolveGlobsExclude(root, i));
   231		resolved.globs = resolved.globs.filter((i) => {
   232			if (!i.startsWith("!")) return true;
   233			resolved.globsExclude.push(i.slice(1));
   234			return false;
   235		});
   236		resolved.dts = !resolved.dts ? false : resolve(root, typeof resolved.dts === "string" ? resolved.dts : "components.d.ts");
   237		if (!resolved.types && resolved.dts) resolved.types = detectTypeImports();
   238		resolved.types = resolved.types || [];
   239		resolved.root = root;
   240		resolved.version = resolved.version ?? getVueVersion(root);

---
   888		const configFilePaths = [
   889			dts,
   890			eslintrc.filepath,
   891			biomelintrc.filepath,
   892			dumpUnimportItems
   893		].filter(isString).map((path) => resolve(root, path));
   894		const normalizedDirPaths = (dirs === null || dirs === void 0 ? void 0 : dirs.length) ? dirs.flatMap((dir) => normalizeScanDirs([dir], {
   895			...dirsScanOptions,
   896			cwd: root
   897		})) : [];
   898		return {
   899			root,
   900			dirs,
   901			filter,
   902			scanDirs,
   903			writeConfigFiles,
   904			writeConfigFilesThrottled,
   905			transform,

---
  1121	async function manifestFiles(manifest, options = {}) {
  1122	  let locales = [];
  1123	  if (manifest.default_locale)
  1124	    locales = await fg("_locales/**/messages.json", options);
  1125	  const rulesets = manifest.declarative_net_request?.rule_resources.flatMap(
  1126	    ({ path }) => path
  1127	  ) ?? [];
  1128	  const contentScripts = manifest.content_scripts?.flatMap(({ js }) => js) ?? [];
  1129	  const contentStyles = manifest.content_scripts?.flatMap(({ css }) => css);
  1130	  const serviceWorker = manifest.background && "service_worker" in manifest.background ? manifest.background.service_worker : void 0;
  1131	  const backgroundScripts = manifest.background && "scripts" in manifest.background ? manifest.background.scripts : void 0;
  1132	  const background = serviceWorker ? [serviceWorker].filter(isString) : backgroundScripts ? backgroundScripts.filter(isString) : [];
  1133	  const htmlPages = htmlFiles(manifest);
  1134	  const icons = [
  1135	    Object.values(
  1136	      isString(manifest.icons) ? [manifest.icons] : manifest.icons ?? {}
  1137	    ),
  1138	    Object.values(
  1139	      isString(manifest.action?.default_icon) ? [manifest.action?.default_icon] : manifest.action?.default_icon ?? {}
  1140	    )
  1141	  ].flat();
  1142	  let webAccessibleResources = [];
  1143	  if (manifest.web_accessible_resources) {
  1144	    const resources = await Promise.all(
  1145	      manifest.web_accessible_resources.flatMap(({ resources: resources2 }) => resources2).map(async (r) => {
  1146	        if (["*", "**/*"].includes(r))
  1147	          return void 0;
  1148	        if (fg.isDynamicPattern(r))
  1149	          return fg(r, options);
  1150	        return r;
  1151	      })
  1152	    );
  1153	    webAccessibleResources = [...new Set(resources.flat())].filter(isString);
  1154	  }
  1155	  return {
  1156	    contentScripts: [...new Set(contentScripts)].filter(isString),
  1157	    contentStyles: [...new Set(contentStyles)].filter(isString),
  1158	    html: htmlPages,
  1159	    icons: [...new Set(icons)].filter(isString),
  1160	    locales: [...new Set(locales)].filter(isString),
  1161	    rulesets: [...new Set(rulesets)].filter(isString),
  1162	    background,
  1163	    webAccessibleResources
  1164	  };
  1165	}
  1166	async function dirFiles(dir) {
  1167	  const files = await fg(join(dir, "**", "*"));
  1168	  return files;
  1169	}
  1170	function htmlFiles(manifest) {
  1171	  const files = [
  1172	    manifest.action?.default_popup,
  1173	    Object.values(manifest.chrome_url_overrides ?? {}),
  1174	    manifest.devtools_page,
  1175	    manifest.options_page,
  1176	    manifest.options_ui?.page,
  1177	    manifest.sandbox?.pages,
  1178	    manifest.side_panel?.default_path
  1179	  ].flat().filter(isString).map((s) => s.split(/[#?]/)[0]).sort();
  1180	  return [...new Set(files)];
  1181	}
  1182	
  1183	const pluginFileWriterPublic = () => {
  1184	  let config;

---
  1640	            contentScripts: js,
  1641	            background: sw,
  1642	            html
  1643	          } = await manifestFiles(manifest, { cwd: config2.root });
  1644	          const { entries = [] } = config2.optimizeDeps ?? {};
  1645	          let { input = [] } = config2.build?.rollupOptions ?? {};
  1646	          if (typeof input === "string")
  1647	            input = [input];
  1648	          else
  1649	            input = Object.values(input);
  1650	          input = input.map((f) => {
  1651	            let result = f;
  1652	            if (isAbsolute(f)) {
  1653	              result = relative(config2.root ?? process.cwd(), f);
  1654	            }
  1655	            return result;
  1656	          });
  1657	          const set = new Set([entries, input].flat());
  1658	          for (const x of [js, sw, html].flat())
  1659	            set.add(x);
  1660	          return {
  1661	            ...config2,
  1662	            optimizeDeps: {
  1663	              ...config2.optimizeDeps,
  1664	              entries: [...set]
  1665	            }

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/runtime.ts | sed -n '1,120p'" in (project root)
 succeeded in 0ms:
     1	/**
     2	 * Wallet composition root.
     3	 *
     4	 * `createWalletRuntime(deps)` returns a handle that can start/stop the full
     5	 * service graph. Everything that touches the Chrome / WASM / filesystem world
     6	 * flows in through `deps`, so tests can construct a runtime with fakes and
     7	 * inspect/exercise the graph without loading the MV3 shell.
     8	 *
     9	 * The shell (src/wallet/index.ts) is now a thin wiring layer: instantiate
    10	 * real adapters and call `createWalletRuntime(...).start()`.
    11	 *
    12	 * Dependencies are explicit. They are NOT module-level globals here; any
    13	 * side effect the runtime has on the outside world goes through a port.
    14	 */
    15	
    16	import { BarretenbergSync } from "@aztec/bb.js"
    17	import type { BrowserApi, ClockPort, TimerHandle } from "@/core/ports"
    18	import { ServiceCollection } from "./base"
    19	import type { ConfigStore } from "./config"
    20	import { LogLevel, type LoggerStore } from "./logger"
    21	import { AccountService } from "./services/account/service"
    22	import { AccountStateService } from "./services/account-state/service"
    23	import { AuthRegistryService } from "./services/auth-registry/service"
    24	import { ConfigService } from "./services/config/service"
    25	import { ContactService } from "./services/contact/service"
    26	import { DappInteractionService } from "./services/dapp-interaction/service"
    27	import { DappSessionService } from "./services/dapp-session/service"
    28	import { ExecutionService } from "./services/execution/service"
    29	import { FpcService } from "./services/fpc/service"
    30	import { LogViewerService } from "./services/log-viewer/service"
    31	import { LoggerService } from "./services/logger/service"
    32	import { NetworkService } from "./services/network/service"
    33	import { NoteService } from "./services/note/service"
    34	import { OperationJournalService } from "./services/operation-journal/service"
    35	import { PasskeyService } from "./services/passkey/service"
    36	import { ProfileService } from "./services/profile/service"
    37	import { TaskService } from "./services/task/service"
    38	import { TokenService } from "./services/token/service"
    39	import { TokenBalanceService } from "./services/token-balance/service"
    40	import { TransactionService } from "./services/transaction/service"
    41	import { WindowManager } from "./services/window-manager/window-manager"
    42	import { initWalletSdkHandler } from "./services/wallet-sdk/background"
    43	import { runStorageMigration } from "./storage/migrate"
    44	import { getErrorMessage } from "./utils/errors"
    45	
    46	/** Shell-supplied dependencies. All I/O goes through ports on this object. */
    47	export interface WalletRuntimeDeps {
    48		browserApi: BrowserApi
    49		clock: ClockPort
    50		config: ConfigStore
    51		logger: LoggerStore
    52	}
    53	
    54	/** Handle returned by `createWalletRuntime`. Lifecycle-controlled, not singleton. */
    55	export interface WalletRuntime {
    56		/** Kick off config load, BB init, migrations, service-graph startup, heartbeat. Idempotent. */
    57		start(): Promise<void>
    58		/** Stop the heartbeat. Services are not disposed (no mechanism yet). */
    59		stop(): void
    60		/** Exposed so shell code + tests can inspect / drive the graph. */
    61		readonly services: ServiceCollection
    62	}
    63	
    64	/** Heartbeat cadence — matches the previous MV3 keepalive cadence (see AUDIT notes). */
    65	const HEARTBEAT_INTERVAL_MS = 10_000
    66	
    67	/** Uninstall URL. Matches nulo.sh brand; documented in SECURITY.md. */
    68	const UNINSTALL_URL = "https://nulo.sh/forms/uninstall"
    69	
    70	export function createWalletRuntime(deps: WalletRuntimeDeps): WalletRuntime {
    71		const { browserApi, clock, config, logger } = deps
    72		const services = new ServiceCollection()
    73		let heartbeatHandle: TimerHandle | undefined
    74		let started = false
    75	
    76		const start = async (): Promise<void> => {
    77			if (started) return
    78			started = true
    79	
    80			// Uninstall URL comes first — zero-cost and covers the user experience
    81			// even if the rest of startup fails.
    82			try {
    83				await browserApi.runtime.setUninstallURL(UNINSTALL_URL)
    84			} catch (error) {
    85				logger.log("wallet", LogLevel.Warn, "Failed to set uninstall URL", getErrorMessage(error))
    86			}
    87	
    88			// Config + Barretenberg can load in parallel — neither depends on the other.
    89			await Promise.all([
    90				config.load().then(() => logger.log("wallet", LogLevel.Info, "Config loaded")),
    91				BarretenbergSync.initSingleton({ wasmPath: process.env.BB_WASM_PATH }).then(() =>
    92					logger.log("wallet", LogLevel.Info, "Barretenberg initialized"),
    93				),
    94			])
    95	
    96			// Destructive storage migration (version-gated) must run before any
    97			// service reads storage. Older shapes get wiped; profiles/passkeys preserved.
    98			await runStorageMigration((msg) => logger.log("wallet", LogLevel.Info, msg))
    99	
   100			// Service graph. Services migrated to ports accept `browserApi`;
   101			// remaining services still reach into chrome.* directly until their
   102			// migration PR lands. Adding in consistent order — actual startup
   103			// ordering is still concurrent (ServiceCollection.start) pending M1.6.
   104			services.add(new AccountService(logger))
   105			services.add(new AccountStateService(logger))
   106			services.add(new AuthRegistryService(logger))
   107			services.add(new ConfigService(config, logger))
   108			const windowManager = new WindowManager(browserApi.windows, clock, logger)
   109			services.add(new ContactService(logger, browserApi))
   110			services.add(new DappInteractionService(logger, windowManager))
   111			services.add(new DappSessionService(logger))
   112			services.add(new ExecutionService(logger))
   113			services.add(new FpcService(logger))
   114			services.add(new LogViewerService(logger))
   115			services.add(new LoggerService(logger))
   116			services.add(new NetworkService(logger))
   117			services.add(new NoteService(logger))
   118			services.add(new OperationJournalService(logger, browserApi))
   119			services.add(new ProfileService(config, logger))
   120			services.add(new TaskService(logger))

exec
/bin/zsh -lc "nl -ba packages/extension/manifest/manifest.config.ts | sed -n '1,120p'" in (project root)
 succeeded in 0ms:
     1	import type { ManifestV3Export } from "@crxjs/vite-plugin"
     2	import packageJson from "../package.json"
     3	
     4	const { version, name, description, displayName } = packageJson
     5	
     6	const [major, minor, patch, label = "0"] = version.replace(/[^\d.-]+/g, "").split(/[.-]/)
     7	
     8	export default {
     9		name: displayName || name,
    10		description,
    11		version: `${major}.${minor}.${patch}.${label}`,
    12		version_name: version,
    13		manifest_version: 3,
    14		host_permissions: ["https://nulo.sh/"],
    15		action: {
    16			default_popup: "src/popup/index.html#/popup/general",
    17		},
    18		background: {
    19			service_worker: "src/wallet/index.ts",
    20			type: "module",
    21		},
    22		side_panel: {
    23			default_path: "src/popup/index.html",
    24		},
    25		content_scripts: [
    26			{
    27				all_frames: true,
    28				js: ["src/content-script/content.ts"],
    29				matches: ["*://*/*"],
    30				run_at: "document_start",
    31			},
    32		],
    33		permissions: ["alarms", "offscreen", "storage", "sidePanel", "unlimitedStorage"],
    34		optional_permissions: ["downloads"],
    35		content_security_policy: {
    36			extension_pages: "script-src 'self' 'wasm-unsafe-eval'",
    37		},
    38		cross_origin_embedder_policy: {
    39			value: "require-corp",
    40		},
    41		cross_origin_opener_policy: {
    42			value: "same-origin",
    43		},
    44		icons: {
    45			16: "src/assets/logo.png",
    46			24: "src/assets/logo.png",
    47			32: "src/assets/logo.png",
    48			128: "src/assets/logo.png",
    49		},
    50		web_accessible_resources: [
    51			{
    52				matches: ["*://*/*"],
    53				resources: ["src/assets/logo.png"],
    54			},
    55		],
    56	} as ManifestV3Export

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/base/zod-helpers.ts | sed -n '1,90p'" in (project root)
 succeeded in 0ms:
     1	/**
     2	 * Thin Zod wrappers for the RPC boundary.
     3	 *
     4	 * Services pair a `paramsSchema` + `resultSchema` per method (in their
     5	 * `spec.ts`) and call these helpers at the wire boundary:
     6	 *
     7	 *   - client-side, before sending:   validateParams(...)
     8	 *   - client-side, after receiving:  validateResult(...)
     9	 *   - service-side, on entry:        validateParams(...)
    10	 *
    11	 * On failure both helpers throw `ValidationError` (a WalletError subclass)
    12	 * so the structured-error round-trip from M1-RT.A preserves subclass
    13	 * identity across the JSON boundary.
    14	 *
    15	 * This module is intentionally small. Schemas live next to the types they
    16	 * describe, not here. Rolling out to more services is one file change
    17	 * per service with no plumbing in the base classes.
    18	 */
    19	
    20	import type { ZodType } from "zod"
    21	import { ValidationError } from "./errors"
    22	
    23	/** Shorten a Zod issue path for error messages. Empty paths become "<root>". */
    24	function formatPath(path: readonly (string | number)[]): string {
    25		return path.length === 0 ? "<root>" : path.join(".")
    26	}
    27	
    28	/** Compact human-readable summary across all issues in a failed parse. */
    29	function summariseIssues(issues: readonly { path: readonly (string | number)[]; message: string }[]): string {
    30		return issues.map((i) => `${formatPath(i.path)}: ${i.message}`).join("; ")
    31	}
    32	
    33	/**
    34	 * Validate the tuple of positional params a caller sent for `method`.
    35	 * Returns the parsed tuple (lets downstream code work with the narrowed
    36	 * type). Throws `ValidationError` on any issue.
    37	 */
    38	export function validateParams<T>(schema: ZodType<T>, params: unknown, method: string): T {
    39		const result = schema.safeParse(params)
    40		if (!result.success) {
    41			throw new ValidationError(`Invalid params for ${method}: ${summariseIssues(result.error.issues)}`, {
    42				method,
    43				issues: result.error.issues,
    44			})
    45		}
    46		return result.data
    47	}
    48	
    49	/**
    50	 * Validate the value a method is about to return (or has just received).
    51	 * Used client-side to catch service bugs / wire corruption before the
    52	 * value reaches UI code.
    53	 */
    54	export function validateResult<T>(schema: ZodType<T>, value: unknown, method: string): T {
    55		const result = schema.safeParse(value)
    56		if (!result.success) {
    57			throw new ValidationError(`Invalid result from ${method}: ${summariseIssues(result.error.issues)}`, {
    58				method,
    59				issues: result.error.issues,
    60			})
    61		}
    62		return result.data
    63	}

exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/services/operation-journal/service.ts | sed -n '1,80p' && printf '\\n---\\n' && nl -ba packages/extension/src/wallet/services/network/service.ts | sed -n '1,60p' && printf '\\n---\\n' && nl -ba packages/extension/src/wallet/services/network/client.ts | sed -n '1,50p'" in (project root)
exec
/bin/zsh -lc "nl -ba packages/extension/src/wallet/config/store.ts | sed -n '1,40p' && printf '\\n---\\n' && nl -ba packages/extension/src/wallet/services/token-balance/balance-repository.ts | sed -n '1,40p'" in (project root)
 succeeded in 0ms:
     1	import { StorageType, ValueStorage } from "@/wallet/storage"
     2	import { Lock } from "@/wallet/utils"
     3	import { EventHandler } from "@/wallet/utils/event-handler"
     4	import { type IConfigStore, Config, type ConfigProp, type ConfigKey } from "."
     5	
     6	export class ConfigStore implements IConfigStore {
     7		public readonly onUpdate = new EventHandler<ConfigProp>()
     8	
     9		private readonly lock = new Lock()
    10		private readonly storage = new ValueStorage<Config>("nulo:config", StorageType.Local)
    11		private config = new Config()
    12	
    13		public get props(): ConfigProp[] {
    14			return Object.entries(this.config).map(([key, value]) => ({ key, value }) as ConfigProp)
    15		}
    16	
    17		public async load() {
    18			const storedConfig = await this.storage.get()
    19			if (storedConfig && typeof storedConfig === "object") {
    20				await this.apply(storedConfig)
    21			}
    22		}
    23	
    24		public get<TKey extends ConfigKey>(key: TKey): Config[TKey] {
    25			return this.config[key]
    26		}
    27	
    28		public async set<TKey extends ConfigKey>(key: TKey, value: Config[TKey]) {
    29			try {
    30				await this.lock.enter()
    31				if (this.config[key] === value) {
    32					return
    33				}
    34				this.config[key] = value
    35				this.onUpdate.invoke({ key, value } as ConfigProp)
    36				await this.storage.set(this.config)
    37			} finally {
    38				this.lock.leave()
    39			}
    40		}

---
     1	/**
     2	 * Storage ownership for `TokenBalanceRaw`. Extracted from
     3	 * `TokenBalanceService` in M2.4-a.
     4	 *
     5	 * Frozen invariants (from plan architecture):
     6	 * - Storage key `nulo:core:token-balances`.
     7	 * - `StorageType.Local`.
     8	 * - `TokenBalanceRaw` shape unchanged.
     9	 * - IDs are numeric; `allocateId()` mirrors today's
    10	 *   `array_max((await balances.getKeys()).map((x) => +x)) + 1`.
    11	 */
    12	
    13	import { array_max } from "@/wallet/utils"
    14	import { EntityStorage, StorageType } from "@/wallet/storage"
    15	import type { TokenBalanceRaw } from "./spec"
    16	
    17	export class BalanceRepository {
    18		private readonly storage: EntityStorage<TokenBalanceRaw>
    19	
    20		public constructor() {
    21			this.storage = new EntityStorage<TokenBalanceRaw>("nulo:core:token-balances", StorageType.Local)
    22		}
    23	
    24		public async get(id: number): Promise<TokenBalanceRaw | undefined> {
    25			return this.storage.get(`${id}`)
    26		}
    27	
    28		public async getAll(): Promise<TokenBalanceRaw[]> {
    29			return this.storage.getValues()
    30		}
    31	
    32		public async set(balance: TokenBalanceRaw): Promise<void> {
    33			await this.storage.set(`${balance.id}`, balance)
    34		}
    35	
    36		public async delete(id: number): Promise<void> {
    37			await this.storage.delete(`${id}`)
    38		}
    39	
    40		/** Allocate a fresh numeric id: `max(existing ids) + 1`. */

 succeeded in 0ms:
     1	import type { BrowserApi } from "@/core/ports"
     2	import type { ServiceSpec } from "@/wallet/base"
     3	import { Service } from "@/wallet/base/background"
     4	import { validateParams } from "@/wallet/base/zod-helpers"
     5	import type { ILogger } from "@/wallet/logger"
     6	import { EntityStorage, StorageType } from "@/wallet/storage"
     7	import { getRandomHex } from "@/wallet/utils"
     8	import { EventHandler } from "@/wallet/utils/event-handler"
     9	import {
    10		type Events,
    11		type Methods,
    12		type NewOperationInput,
    13		OPERATION_JOURNAL_SERVICE_NAME,
    14		type OperationFilter,
    15		OperationJournalMethodSchemas,
    16		type OperationRecord,
    17		type OperationState,
    18	} from "./spec"
    19	
    20	export * from "./spec"
    21	
    22	/**
    23	 * Durable operation journal. See ./spec.ts for rationale.
    24	 *
    25	 * Storage-only service — no orchestration, no business logic, no calls out
    26	 * to other services. Consumers (ExecutionService in M1.1.B) drive state
    27	 * transitions; this service only persists them and fans out events.
    28	 */
    29	export class OperationJournalService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
    30		public static name = OPERATION_JOURNAL_SERVICE_NAME
    31	
    32		public readonly onOperationAdded = new EventHandler<OperationRecord>()
    33		public readonly onOperationUpdated = new EventHandler<OperationRecord>()
    34		public readonly onOperationDeleted = new EventHandler<OperationRecord>()
    35	
    36		private readonly storage: EntityStorage<OperationRecord>
    37	
    38		public constructor(logger: ILogger, browserApi?: BrowserApi) {
    39			super(OPERATION_JOURNAL_SERVICE_NAME, logger)
    40			// Session storage: records survive SW restart (what we care about)
    41			// but clear on browser exit (stale ops post-reboot aren't actionable).
    42			this.storage = browserApi
    43				? new EntityStorage<OperationRecord>("nulo:journal", browserApi.storage.session)
    44				: new EntityStorage<OperationRecord>("nulo:journal", StorageType.Session)
    45		}
    46	
    47		public async createOperation(input: NewOperationInput): Promise<OperationRecord> {
    48			validateParams(OperationJournalMethodSchemas.createOperation.params, [input], "createOperation")
    49			await this.ensureInitialized()
    50	
    51			let id: string
    52			do {
    53				id = getRandomHex(8)
    54			} while (await this.storage.contains(id))
    55	
    56			const now = Date.now()
    57			const record: OperationRecord = {
    58				id,
    59				kind: input.kind,
    60				state: { kind: "planned" },
    61				createdAt: now,
    62				updatedAt: now,
    63				accountAddress: input.accountAddress,
    64				networkId: input.networkId,
    65				tokenId: input.tokenId,
    66				title: input.title,
    67				subtitle: input.subtitle,
    68			}
    69			await this.storage.set(record.id, record)
    70			this.emit("onOperationAdded", record)
    71			return record
    72		}
    73	
    74		public async updateOperationState(id: string, state: OperationState): Promise<OperationRecord> {
    75			validateParams(OperationJournalMethodSchemas.updateOperationState.params, [id, state], "updateOperationState")
    76			await this.ensureInitialized()
    77	
    78			const existing = await this.storage.get(id)
    79			if (!existing) {
    80				throw new Error(`Operation not found: ${id}`)

---
     1	import type { AztecNode } from "@aztec/stdlib/interfaces/client"
     2	import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
     3	import { Service } from "@/wallet/base/background"
     4	import { validateParams } from "@/wallet/base/zod-helpers"
     5	import { AztecNodeFactoryAdapter } from "@/core/adapters/aztec-node-factory-adapter"
     6	import type { NodeFactory } from "@/core/ports/node-factory-port"
     7	import type { ILogger } from "@/wallet/logger"
     8	import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
     9	import { EntityStorage, StorageType } from "@/wallet/storage"
    10	import { getRandomHex, Lock } from "@/wallet/utils"
    11	import { EventHandler } from "@/wallet/utils/event-handler"
    12	import { getErrorMessage } from "@/wallet/utils/errors"
    13	import { type Events, type Methods, type Network, NETWORK_SERVICE_NAME, NetworkMethodSchemas, NodeStatus } from "./spec"
    14	
    15	export * from "./spec"
    16	
    17	export class NetworkService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
    18		public static name = NETWORK_SERVICE_NAME
    19	
    20		public readonly onNetworkAdded = new EventHandler<Network>()
    21		public readonly onNetworkUpdated = new EventHandler<Network>()
    22		public readonly onNetworkDeleted = new EventHandler<Network>()
    23		public readonly onDefaultNetworkChanged = new EventHandler<Network>()
    24	
    25		private readonly storage = new EntityStorage<Network>("nulo:core:networks", StorageType.Local)
    26		private readonly nodes = new Map<number, AztecNode>()
    27		private readonly lock: Lock
    28		private readonly nodeFactory: NodeFactory
    29	
    30		private profileService: ProfileService = null!
    31	
    32		public constructor(logger: ILogger, nodeFactory?: NodeFactory) {
    33			super(NETWORK_SERVICE_NAME, logger)
    34			this.lock = new Lock("network", logger)
    35			this.nodeFactory = nodeFactory ?? new AztecNodeFactoryAdapter()
    36		}
    37	
    38		protected async init(services: ServiceCollection) {
    39			this.profileService = services.get(ProfileService.name)
    40			this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)
    41			this.profileService.onProfileDeleted.add(this.onProfileDeleted)
    42		}
    43	
    44		public async getOrInitNetworks(): Promise<Network[]> {
    45			await this.ensureInitialized()
    46			const profile = await this.profileService.getActiveProfile()
    47			if (!profile) {
    48				throw new Error("Profile locked")
    49			}
    50			try {
    51				await this.lock.enter()
    52				const networks = (await this.storage.getValues()).filter((x) => x.profileId === profile.id)
    53				if (networks.length) {
    54					return networks
    55				}
    56	
    57				const defaultNetworks = []
    58				try {
    59					const name = "Alpha Mainnet"
    60					const rpcUrl = "https://aztec-mainnet.drpc.org"

---
     1	import type { ServiceSpec } from "@/wallet/base"
     2	import { ServiceClient } from "@/wallet/base/background"
     3	import { validateParams, validateResult } from "@/wallet/base/zod-helpers"
     4	import { LoggerServiceClient } from "@/wallet/services/logger/client"
     5	import { EventHandler } from "@/wallet/utils/event-handler"
     6	import { type Events, type Methods, type Network, NETWORK_SERVICE_NAME, NetworkMethodSchemas, type NodeStatus } from "./spec"
     7	
     8	export * from "./spec"
     9	
    10	/**
    11	 * Every public method validates outgoing params before calling `this.request`
    12	 * and validates the incoming result before returning. Validation failures
    13	 * throw `ValidationError` (from M1-RT.A) so consumers can `instanceof`
    14	 * against it.
    15	 */
    16	export class NetworkServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
    17		public readonly onNetworkAdded = new EventHandler<Network>()
    18		public readonly onNetworkUpdated = new EventHandler<Network>()
    19		public readonly onNetworkDeleted = new EventHandler<Network>()
    20		public readonly onDefaultNetworkChanged = new EventHandler<Network>()
    21	
    22		public constructor(name?: string) {
    23			super(NETWORK_SERVICE_NAME, new LoggerServiceClient(), name)
    24		}
    25	
    26		public async getOrInitNetworks(): Promise<Network[]> {
    27			validateParams(NetworkMethodSchemas.getOrInitNetworks.params, [], "getOrInitNetworks")
    28			const result = await this.request("getOrInitNetworks")
    29			return validateResult(NetworkMethodSchemas.getOrInitNetworks.result, result, "getOrInitNetworks")
    30		}
    31	
    32		public async getNetworks(chainId?: number): Promise<Network[]> {
    33			validateParams(NetworkMethodSchemas.getNetworks.params, [chainId], "getNetworks")
    34			const result = await this.request("getNetworks", chainId)
    35			return validateResult(NetworkMethodSchemas.getNetworks.result, result, "getNetworks")
    36		}
    37	
    38		public async getNetwork(id: string): Promise<Network> {
    39			validateParams(NetworkMethodSchemas.getNetwork.params, [id], "getNetwork")
    40			const result = await this.request("getNetwork", id)
    41			return validateResult(NetworkMethodSchemas.getNetwork.result, result, "getNetwork")
    42		}
    43	
    44		public async addNetwork(name: string, rpcUrl: string): Promise<Network> {
    45			validateParams(NetworkMethodSchemas.addNetwork.params, [name, rpcUrl], "addNetwork")
    46			const result = await this.request("addNetwork", name, rpcUrl)
    47			return validateResult(NetworkMethodSchemas.addNetwork.result, result, "addNetwork")
    48		}
    49	
    50		public async updateNetwork(id: string, name: string, rpcUrl: string): Promise<Network> {

codex
**Blockers**
- M3.1 is not executable as written because the proposed `wallet-core` move list is materially impure. `SimpleStorage` is Chrome-bound ([simple_storage.ts]((project root)/packages/extension/src/wallet/storage/simple_storage.ts:1)), `logger/index.ts` re-exports the Chrome-backed logger store ([index.ts]((project root)/packages/extension/src/wallet/logger/index.ts:3)), and several `wallet/utils/*` files listed for core are Aztec- or Chrome-dependent, e.g. [fn.ts]((project root)/packages/extension/src/wallet/utils/fn.ts:1), [schemas.ts]((project root)/packages/extension/src/wallet/utils/schemas.ts:1), [offscreen.ts]((project root)/packages/extension/src/wallet/utils/offscreen.ts:14).
- M3.4’s offscreen-shell idea is incomplete unless `packages/extension/src/offscreen/index.html` stays in the extension. The offscreen path is hardcoded at runtime ([offscreen.ts]((project root)/packages/extension/src/wallet/utils/offscreen.ts:14)), and CRX bundles extra HTML pages from `build.rollupOptions.input` ([vite.config.ts]((project root)/packages/extension/vite.config.ts:175)).
- M3.2’s crypto plan has a real dependency error: `PASSKEY_PRF_LABEL` is not part of `PasskeyCredential`’s derivation chain, and `key-vectors.test.ts` also imports `AccountType` from account spec ([spec.ts]((project root)/packages/extension/src/wallet/services/passkey/spec.ts:4), [credential.ts]((project root)/packages/extension/src/wallet/services/passkey/credential.ts:8), [key-vectors.test.ts]((project root)/packages/extension/src/wallet/crypto/key-vectors.test.ts:68)). That test suite cannot move wholesale to `wallet-crypto` as planned.

**Medium Issues**
- Option A for storage is correct, but the plan understates the constructor churn. Today many services and helpers still instantiate storage with `StorageType.*`, including [NetworkService]((project root)/packages/extension/src/wallet/services/network/service.ts:25), [AccountService]((project root)/packages/extension/src/wallet/services/account/service.ts:22), [ConfigStore]((project root)/packages/extension/src/wallet/config/store.ts:10), and [BalanceRepository]((project root)/packages/extension/src/wallet/services/token-balance/balance-repository.ts:21).
- `zod` should be optional or at least isolated to a subpath. The actual messaging base does not require it; only the helpers do ([zod-helpers.ts]((project root)/packages/extension/src/wallet/base/zod-helpers.ts:20)).
- `__VERSION__` is fine for Vite build-time replacement, but current Vitest config does not define it ([vite.config.ts]((project root)/packages/extension/vite.config.ts:190), [vitest.config.ts]((project root)/packages/extension/vitest.config.ts:4)).
- `extension-ui` needs a much stricter purity audit than the plan implies. Some “UI” files already depend on service clients or stores, e.g. [PopupCard.vue]((project root)/packages/extension/src/components/ui/Popup/PopupCard.vue:3), [Header.vue]((project root)/packages/extension/src/components/Header.vue:2), [AddressDisplay.vue]((project root)/packages/extension/src/components/ui/AddressDisplay.vue:4).

**Minor Issues**
- `dependency-cruiser` is the right tool for package boundaries, but it cannot enforce “no `chrome.*` globals”; that needs Biome/ESLint as a second guard.
- The plan likely overuses TS/Vitest path aliases. With workspace deps and `exports`, Vite/Vitest should resolve package names directly once the new packages are real workspaces.

**Per-Question Answers**
1. Yes, Option A is the right direction for `EntityStorage`/`ValueStorage`. Keeping the fallback in core would keep a hard `chrome.storage` dependency in the constructors ([entity_storage.ts]((project root)/packages/extension/src/wallet/storage/entity_storage.ts:26), [value-storage.ts]((project root)/packages/extension/src/wallet/storage/value-storage.ts:25)). The risks are constructor churn, test/setup churn, and the fact that `SimpleStorage` still cannot move without a separate refactor.

2. `wrapParams`/`unwrapParams` belong in `extension-messaging`, not `wallet-core`. They are only used by the background/offscreen RPC base classes ([utils.ts]((project root)/packages/extension/src/wallet/base/utils.ts:3), [background/service.ts]((project root)/packages/extension/src/wallet/base/background/service.ts:8), [background/client.ts]((project root)/packages/extension/src/wallet/base/background/client.ts:9), [offscreen/service.ts]((project root)/packages/extension/src/wallet/base/offscreen/service.ts:8), [offscreen/client.ts]((project root)/packages/extension/src/wallet/base/offscreen/client.ts:8)).

3. `zod` is only justified in `extension-messaging` if you intentionally want RPC validation helpers shipped with the messaging package. Architecturally it should be optional, because the transport base, errors, and message types do not depend on it. A `./zod` subpath is cleaner than making every messaging consumer pull `zod`.

4. The thin `extension/src/offscreen/index.ts` shell will bundle correctly only if the extension also keeps `src/offscreen/index.html` and keeps it in `build.rollupOptions.input`. The manifest does not declare the offscreen document path; it only declares the `offscreen` permission ([manifest.config.ts]((project root)/packages/extension/manifest/manifest.config.ts:33)). CRX discovers HTML pages from manifest HTML fields plus extra HTML pages in Vite input. Docs: https://crxjs.dev/concepts/pages/ and https://crxjs.dev/concepts/manifest/

5. The current bb shim probably still works after extraction, because the intercepted `fetch_code/index.js` import originates inside `@aztec/bb.js`, not inside `aztec-runtime`. So the importer should still be a bb.js path. But the string test is brittle; I would treat it as “works today, harden before M3.4”. Current hook: [vite.config.ts]((project root)/packages/extension/vite.config.ts:80).

6. `declare const __VERSION__: string` is correct TypeScript for a Vite `define`; the repo already uses that pattern ([vite-env.d.ts]((project root)/packages/extension/src/types/vite-env.d.ts:4)). It will not automatically work in Vitest unless that Vitest config also defines `__VERSION__` or stubs it.

7. Yes. With the installed versions, both plugins resolve `dirs` relative to Vite root and convert them to absolute globs, so `../extension-ui/src/components` and `../extension-ui/src/composables` are valid. Evidence in installed code: [unplugin-vue-components]((project root)/packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js:206), [unplugin-auto-import]((project root)/packages/extension/node_modules/unplugin-auto-import/dist/src-CZGMhDR1.mjs:894).

8. For bare Sass imports like `@use 'abstracts/variables'`, yes, adding the new style directory to `loadPaths` is the right mechanism. But it is not sufficient here because current styles also reference fonts through `@/assets/...` URLs ([base.scss]((project root)/packages/extension/src/assets/styles/_base.scss:194)). `loadPaths` does nothing for those asset URLs.

9. Yes, `dependency-cruiser` is the right boundary tool. I would install `dependency-cruiser@17.3.10` today, or at minimum pin to `17.3.x`. Pitfalls in this Bun monorepo: set `tsConfig.fileName`, likely enable `tsPreCompilationDeps`, remember that `.vue` analysis requires the compiler to be visible, and do not expect it to catch `chrome` global usage. Docs: https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md and https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md

10. `extension-messaging` is genuinely independent of `wallet-crypto`. I found no code-level cross-dependency between them. The hidden coupling is elsewhere: M3.2’s vector suite still imports extension-side `PASSKEY_PRF_LABEL` and `AccountType`, so M3.2 is not as isolated as the plan claims.

11. The biggest missed risks are:
- The `wallet-core` candidate list is not actually core-safe.
- `logger/index.ts` cannot move as-is.
- `key-vectors.test.ts` cannot move as-is.
- `runtime.ts` still imports `BarretenbergSync` directly ([runtime.ts]((project root)/packages/extension/src/wallet/runtime.ts:16)), so M3.4 does not fully isolate Aztec/WASM unless that is addressed.
- `extension-ui` styles/assets are coupled to extension-root aliases.
- The offscreen HTML path is hard-coupled in two places and must remain stable.

12. The source-first exports strategy is sound for this repo as an internal-only workspace split. Vite can bundle workspace source directly, and Bun workspaces are a good fit. The tradeoff is future publication: these packages are not npm-ready, will depend on consumer tooling understanding `.ts` exports, and can quietly assume extension-specific Vite defines/shims. If publication or reuse outside the extension is a real goal, add per-package build outputs and `.d.ts` generation later.

Sources used for tool behavior:
- CRXJS pages: https://crxjs.dev/concepts/pages/
- CRXJS manifest: https://crxjs.dev/concepts/manifest/
- dependency-cruiser FAQ / CLI: https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md and https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md
tokens used
348,781
**Blockers**
- M3.1 is not executable as written because the proposed `wallet-core` move list is materially impure. `SimpleStorage` is Chrome-bound ([simple_storage.ts]((project root)/packages/extension/src/wallet/storage/simple_storage.ts:1)), `logger/index.ts` re-exports the Chrome-backed logger store ([index.ts]((project root)/packages/extension/src/wallet/logger/index.ts:3)), and several `wallet/utils/*` files listed for core are Aztec- or Chrome-dependent, e.g. [fn.ts]((project root)/packages/extension/src/wallet/utils/fn.ts:1), [schemas.ts]((project root)/packages/extension/src/wallet/utils/schemas.ts:1), [offscreen.ts]((project root)/packages/extension/src/wallet/utils/offscreen.ts:14).
- M3.4’s offscreen-shell idea is incomplete unless `packages/extension/src/offscreen/index.html` stays in the extension. The offscreen path is hardcoded at runtime ([offscreen.ts]((project root)/packages/extension/src/wallet/utils/offscreen.ts:14)), and CRX bundles extra HTML pages from `build.rollupOptions.input` ([vite.config.ts]((project root)/packages/extension/vite.config.ts:175)).
- M3.2’s crypto plan has a real dependency error: `PASSKEY_PRF_LABEL` is not part of `PasskeyCredential`’s derivation chain, and `key-vectors.test.ts` also imports `AccountType` from account spec ([spec.ts]((project root)/packages/extension/src/wallet/services/passkey/spec.ts:4), [credential.ts]((project root)/packages/extension/src/wallet/services/passkey/credential.ts:8), [key-vectors.test.ts]((project root)/packages/extension/src/wallet/crypto/key-vectors.test.ts:68)). That test suite cannot move wholesale to `wallet-crypto` as planned.

**Medium Issues**
- Option A for storage is correct, but the plan understates the constructor churn. Today many services and helpers still instantiate storage with `StorageType.*`, including [NetworkService]((project root)/packages/extension/src/wallet/services/network/service.ts:25), [AccountService]((project root)/packages/extension/src/wallet/services/account/service.ts:22), [ConfigStore]((project root)/packages/extension/src/wallet/config/store.ts:10), and [BalanceRepository]((project root)/packages/extension/src/wallet/services/token-balance/balance-repository.ts:21).
- `zod` should be optional or at least isolated to a subpath. The actual messaging base does not require it; only the helpers do ([zod-helpers.ts]((project root)/packages/extension/src/wallet/base/zod-helpers.ts:20)).
- `__VERSION__` is fine for Vite build-time replacement, but current Vitest config does not define it ([vite.config.ts]((project root)/packages/extension/vite.config.ts:190), [vitest.config.ts]((project root)/packages/extension/vitest.config.ts:4)).
- `extension-ui` needs a much stricter purity audit than the plan implies. Some “UI” files already depend on service clients or stores, e.g. [PopupCard.vue]((project root)/packages/extension/src/components/ui/Popup/PopupCard.vue:3), [Header.vue]((project root)/packages/extension/src/components/Header.vue:2), [AddressDisplay.vue]((project root)/packages/extension/src/components/ui/AddressDisplay.vue:4).

**Minor Issues**
- `dependency-cruiser` is the right tool for package boundaries, but it cannot enforce “no `chrome.*` globals”; that needs Biome/ESLint as a second guard.
- The plan likely overuses TS/Vitest path aliases. With workspace deps and `exports`, Vite/Vitest should resolve package names directly once the new packages are real workspaces.

**Per-Question Answers**
1. Yes, Option A is the right direction for `EntityStorage`/`ValueStorage`. Keeping the fallback in core would keep a hard `chrome.storage` dependency in the constructors ([entity_storage.ts]((project root)/packages/extension/src/wallet/storage/entity_storage.ts:26), [value-storage.ts]((project root)/packages/extension/src/wallet/storage/value-storage.ts:25)). The risks are constructor churn, test/setup churn, and the fact that `SimpleStorage` still cannot move without a separate refactor.

2. `wrapParams`/`unwrapParams` belong in `extension-messaging`, not `wallet-core`. They are only used by the background/offscreen RPC base classes ([utils.ts]((project root)/packages/extension/src/wallet/base/utils.ts:3), [background/service.ts]((project root)/packages/extension/src/wallet/base/background/service.ts:8), [background/client.ts]((project root)/packages/extension/src/wallet/base/background/client.ts:9), [offscreen/service.ts]((project root)/packages/extension/src/wallet/base/offscreen/service.ts:8), [offscreen/client.ts]((project root)/packages/extension/src/wallet/base/offscreen/client.ts:8)).

3. `zod` is only justified in `extension-messaging` if you intentionally want RPC validation helpers shipped with the messaging package. Architecturally it should be optional, because the transport base, errors, and message types do not depend on it. A `./zod` subpath is cleaner than making every messaging consumer pull `zod`.

4. The thin `extension/src/offscreen/index.ts` shell will bundle correctly only if the extension also keeps `src/offscreen/index.html` and keeps it in `build.rollupOptions.input`. The manifest does not declare the offscreen document path; it only declares the `offscreen` permission ([manifest.config.ts]((project root)/packages/extension/manifest/manifest.config.ts:33)). CRX discovers HTML pages from manifest HTML fields plus extra HTML pages in Vite input. Docs: https://crxjs.dev/concepts/pages/ and https://crxjs.dev/concepts/manifest/

5. The current bb shim probably still works after extraction, because the intercepted `fetch_code/index.js` import originates inside `@aztec/bb.js`, not inside `aztec-runtime`. So the importer should still be a bb.js path. But the string test is brittle; I would treat it as “works today, harden before M3.4”. Current hook: [vite.config.ts]((project root)/packages/extension/vite.config.ts:80).

6. `declare const __VERSION__: string` is correct TypeScript for a Vite `define`; the repo already uses that pattern ([vite-env.d.ts]((project root)/packages/extension/src/types/vite-env.d.ts:4)). It will not automatically work in Vitest unless that Vitest config also defines `__VERSION__` or stubs it.

7. Yes. With the installed versions, both plugins resolve `dirs` relative to Vite root and convert them to absolute globs, so `../extension-ui/src/components` and `../extension-ui/src/composables` are valid. Evidence in installed code: [unplugin-vue-components]((project root)/packages/extension/node_modules/unplugin-vue-components/dist/src-bfjkatac.js:206), [unplugin-auto-import]((project root)/packages/extension/node_modules/unplugin-auto-import/dist/src-CZGMhDR1.mjs:894).

8. For bare Sass imports like `@use 'abstracts/variables'`, yes, adding the new style directory to `loadPaths` is the right mechanism. But it is not sufficient here because current styles also reference fonts through `@/assets/...` URLs ([base.scss]((project root)/packages/extension/src/assets/styles/_base.scss:194)). `loadPaths` does nothing for those asset URLs.

9. Yes, `dependency-cruiser` is the right boundary tool. I would install `dependency-cruiser@17.3.10` today, or at minimum pin to `17.3.x`. Pitfalls in this Bun monorepo: set `tsConfig.fileName`, likely enable `tsPreCompilationDeps`, remember that `.vue` analysis requires the compiler to be visible, and do not expect it to catch `chrome` global usage. Docs: https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md and https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md

10. `extension-messaging` is genuinely independent of `wallet-crypto`. I found no code-level cross-dependency between them. The hidden coupling is elsewhere: M3.2’s vector suite still imports extension-side `PASSKEY_PRF_LABEL` and `AccountType`, so M3.2 is not as isolated as the plan claims.

11. The biggest missed risks are:
- The `wallet-core` candidate list is not actually core-safe.
- `logger/index.ts` cannot move as-is.
- `key-vectors.test.ts` cannot move as-is.
- `runtime.ts` still imports `BarretenbergSync` directly ([runtime.ts]((project root)/packages/extension/src/wallet/runtime.ts:16)), so M3.4 does not fully isolate Aztec/WASM unless that is addressed.
- `extension-ui` styles/assets are coupled to extension-root aliases.
- The offscreen HTML path is hard-coupled in two places and must remain stable.

12. The source-first exports strategy is sound for this repo as an internal-only workspace split. Vite can bundle workspace source directly, and Bun workspaces are a good fit. The tradeoff is future publication: these packages are not npm-ready, will depend on consumer tooling understanding `.ts` exports, and can quietly assume extension-specific Vite defines/shims. If publication or reuse outside the extension is a real goal, add per-package build outputs and `.d.ts` generation later.

Sources used for tool behavior:
- CRXJS pages: https://crxjs.dev/concepts/pages/
- CRXJS manifest: https://crxjs.dev/concepts/manifest/
- dependency-cruiser FAQ / CLI: https://github.com/sverweij/dependency-cruiser/blob/main/doc/faq.md and https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md
