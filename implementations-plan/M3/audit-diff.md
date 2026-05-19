# M3 Plans — Post-Audit Diff

## Source of findings

Both audits complete. Agent audit ran first. Codex xhigh audit completed. All findings incorporated into plans.

## Blockers fixed in revised plans

### B1 — M3.1: `simple_storage.ts` cannot move to wallet-core

**Finding**: `simple_storage.ts` uses `chrome.storage.StorageArea` as a direct typed field with no `MinimalArea` abstraction and no injected-port alternative. It will fail `tsc` under wallet-core's `"types": []`.

**Fix in M3.1**: Added explicit decision: `simple_storage.ts` stays in `@nulo/extension`. It is NOT listed in the wallet-core storage move table. A note explains why (chrome type dep, no injected-port path).

---

### B2 — M3.1: Large portion of `src/wallet/utils/` cannot move to wallet-core

**Finding**: These files have disqualifying deps and CANNOT move to wallet-core:
- `offscreen.ts` — uses `chrome.runtime`, `chrome.offscreen`
- `fetch.ts` — imports `@aztec/foundation/*`
- `auth-registry.ts` — imports `@aztec/constants`, `@aztec/stdlib/*`, `@aztec/foundation/*`
- `fee-juice.ts` — imports `@aztec/constants`, `@aztec/stdlib/*`, `@aztec/noir-contracts.js/*` + `@/wallet/services/execution/spec`
- `schemas.ts` — imports `@aztec/stdlib/*`, `@aztec/foundation/*`
- `caip.ts` — imports from `@/wallet/services/dapp-interaction/spec`

Only these files are safe to move to wallet-core:
- `arrays.ts` ✅
- `errors.ts` ✅ (pure)
- `event-handler.ts` ✅
- `lock.ts` ✅
- `mnemonic.ts` ✅ (check bip39 dep — add to wallet-core devDeps if needed)
- `queue.ts` ✅
- `random.ts` ✅
- `rw-guard.ts` ✅
- `serialization.ts` ✅
- `sleep.ts` ✅

**`fn.ts` removed from safe list** — confirmed Aztec-dependent (see CB1 below).

Aztec-util files (`fetch.ts`, `auth-registry.ts`, `fee-juice.ts`, `schemas.ts`) → move to `@nulo/aztec-runtime` or keep in extension.
Chrome-util files (`offscreen.ts`) → stay in `@nulo/extension`.
Extension-internal files (`caip.ts`, `fee-juice.ts`) → stay in `@nulo/extension` for now (they import from extension's spec.ts).

**Fix in M3.1**: Replaced the "move ALL of wallet/utils/" table with a per-file safe list. Unsupported files are explicitly kept in extension with reasons.

---

### B3 — M3.5: `background.ts` imports 6 concrete service classes → circular dep

**Finding**: `services/wallet-sdk/background.ts` value-imports `NetworkService`, `AccountService`, `ExecutionService`, `ProfileService`, `DappInteractionService`, `DappSessionService` for `.name` static property access via `services.get(ClassName.name)`. Moving this file to `@nulo/wallet-bridge` while these implementations stay in `@nulo/extension` creates a circular workspace dep.

**Fix in M3.5**:
- **Option chosen**: Export service-name string constants from each service's `spec.ts`. Then `background.ts` imports only those string constants (which live in spec.ts files — those can be in wallet-bridge or re-exported).

Wait — spec.ts files currently live in `@nulo/extension/src/wallet/services/*/spec.ts`. Importing them into wallet-bridge still creates a dep on extension.

**Revised option**: Keep `background.ts` in `@nulo/extension`. Extract to wallet-bridge only: `dispatcher.ts`, `capability-map.ts`, `scope-enforcement.ts`, `discovery-queue.ts`, `types.ts`, `rpc/types.ts`, `rpc/utils.ts`. The `initWalletSdkHandler` function (defined in background.ts) stays in extension.

This is actually cleaner: wallet-bridge = the Aztec wallet-sdk protocol layer (dispatcher, scope enforcement, discovery) WITHOUT the service-graph wiring (background.ts). The background wiring is extension-specific because it knows about the concrete services.

**Revised M3.5 scope**:
| Moves to wallet-bridge | Stays in extension |
|---|---|
| `dispatcher.ts` | `background.ts` |
| `capability-map.ts` | |
| `discovery-queue.ts` | |
| `scope-enforcement.ts` | |
| `types.ts` | |
| `rpc/types.ts` | |
| `rpc/utils.ts` | |

`initWalletSdkHandler` stays in extension (it's the wiring point). `runtime.ts` keeps importing it from `@/wallet/services/wallet-sdk/background`.

---

### B4 — M3.5: `dispatcher.ts` also imports `packageJson.version`

**Finding**: `dispatcher.ts` line 73 also imports `packageJson` and uses `.version` in 3 places (lines 364, 392, 489). Plan only mentions `rpc/types.ts` and `background.ts`.

**Fix in M3.5**: Added `dispatcher.ts` to the `__VERSION__` substitution list. All 3 usages in `dispatcher.ts` must be replaced with `__VERSION__`. wallet-bridge's `vitest.config.ts` must include `define: { __VERSION__: '"0.0.0-test"' }`.

---

### B5 — M3.7: depcruiser `chrome-types` rule doesn't catch `chrome.*` global usage

**Finding**: `chrome.*` in wallet-core appears as global access, not a module import. dependency-cruiser's `to: { path: "chrome-types" }` rule only catches `import ... from "chrome-types"` — not `chrome.storage.local` usage.

**Fix in M3.7**: Clarified that `tsc --noEmit` with `"types": []` in wallet-core's tsconfig IS the real enforcement boundary. The depcruiser rule is documentation-only for this case. Added note to plan.

---

## Improvements incorporated

### I1 — M3.1 internal inconsistency on `utils.ts`
Removed `src/wallet/base/utils.ts` from M3.1's move table. Explicit note added: stays in extension during M3.1, moves to extension-messaging in M3.3.

### I3 — `config/store.ts` missing from StorageType migration list
Added to M3.1's StorageType migration section with note that `ConfigStore` needs `browserApi.storage.local` passed explicitly.

### I5 — `offscreen.ts` must NOT move to aztec-runtime
`offscreen.ts` has `chrome.runtime` + `chrome.offscreen` deps. It stays in `@nulo/extension`. Added explicit exclusion in M3.1's utils move table.

### MR1 — `wrapParams` → `array_max` import update
Added to M3.3 plan: when `utils.ts` moves to extension-messaging, the `array_max` import must change from `@/wallet/utils` to `@nulo/wallet-core/utils`.

### MR2 — `config/store.ts` StorageType usage
Added to M3.1 migration task list.

### MR4 — `handleEncryptedMessage` monkey-patch risk
Added to M3.5 risk register.

### MR5 — `@assets` alias vite config change
Added explicit vite.config update to M3.6: `"@assets": fileURLToPath(new URL("../extension-ui/src/assets", import.meta.url))`.

---

## Codex audit findings (xhigh — completed)

### CB1 — M3.1: `fn.ts` is NOT pure — has heavy Aztec deps

**Finding**: `src/wallet/utils/fn.ts` imports from `@aztec/foundation/curves/bn254`, `@aztec/stdlib/*`, `@/wallet/services/account/contracts`, and `@/wallet/services/pxe/proxy`. It is an Aztec function execution builder, NOT a generic utility. The agent audit incorrectly listed it as ✅ safe for wallet-core.

**Fix in M3.1**: Remove `fn.ts` from the utils safe list. It stays in `@nulo/extension` for M3.1 and moves to `@nulo/aztec-runtime` in M3.4.

Updated safe list (fn.ts removed):
- `arrays.ts` ✅
- `errors.ts` ✅ (pure)
- `event-handler.ts` ✅
- `lock.ts` ✅
- `mnemonic.ts` ✅ (check bip39 dep)
- `queue.ts` ✅
- `random.ts` ✅
- `rw-guard.ts` ✅
- `serialization.ts` ✅
- `sleep.ts` ✅

---

### CB2 — M3.1: `logger/index.ts` re-exports Chrome-backed `LoggerStore`

**Finding**: `src/wallet/logger/index.ts` line 3: `export * from "./store"`. `store.ts` uses `chrome.storage.session` directly. If index.ts moves to wallet-core, it drags in the chrome dependency.

**Fix in M3.1**: Move only the pure parts from logger/ to wallet-core. Create `packages/wallet-core/src/logger/interfaces.ts` with `ILogger`, `ILoggerStore`, `LogLevel`, `LogContext`, `Log`, `consoleMethods` (these are declared inline in index.ts and are pure). `logger/index.ts` itself, `store.ts`, and `utils.ts` stay in extension. Extension's `logger/index.ts` re-exports from `@nulo/wallet-core/logger` for the interfaces.

Plan exports from wallet-core: `ILogger`, `ILoggerStore`, `LogLevel`, `LogContext`, `Log`, `consoleMethods`.

---

### CB3 — M3.2: `key-vectors.test.ts` imports `AccountType` from account spec

**Finding**: `key-vectors.test.ts` line 71: `import { AccountType } from "@/wallet/services/account/spec"`. This test imports from the extension's account spec, preventing wholesale move to wallet-crypto.

**Fix in M3.2**: Keep `key-vectors.test.ts` in `@nulo/extension`'s test suite — do NOT move it to wallet-crypto. After M3.2, update it to import crypto primitives from `@nulo/wallet-crypto` and update the `@/` paths for EncryptionKey, PasskeyCredential, PASSKEY_PRF_LABEL. The test runs as an extension integration test, not a wallet-crypto unit test. The crypto source files (encryption-key.ts, password-secret-box.ts, passkey-credential.ts) still move; only the test file stays.

---

### C_M1 — All packages: `__VERSION__` not defined in any vitest config

**Finding**: The extension's `vitest.config.ts` does not define `__VERSION__`. Any test that imports a file using `__VERSION__` (e.g. `about.vue`, files in wallet-bridge) will fail at test time with `__VERSION__ is not defined`.

**Fix**: Add `define` block to extension's `vitest.config.ts` in M3.1 (before any other extraction):
```ts
define: {
  __VERSION__: '"0.0.0-test"',
  __SENTINEL__: '"test"',
  __AZTEC_VERSION__: '"0.0.0-test"',
  __NAME__: '"test"',
  __DISPLAY_NAME__: '"test"',
}
```
Wallet-bridge's `vitest.config.ts` also needs `define: { __VERSION__: '"0.0.0-test"' }` (already planned in B4 fix).

---

### C_M2 — M3.3: Zod should be isolated to `./zod` subpath in extension-messaging

**Finding**: The transport base (Service<T>, ServiceClient<T>, errors.ts, messages.ts) does not need Zod. Only `zod-helpers.ts` uses it. Making every consumer of extension-messaging transitively depend on Zod is heavier than needed.

**Fix in M3.3**: Expose `zod-helpers.ts` via a separate `"./zod": "./src/zod-helpers.ts"` subpath export. The root `index.ts` does NOT re-export zod-helpers. Consumers that want Zod validation import from `@nulo/extension-messaging/zod`. Make `zod` a peer dependency (not a hard dependency) in extension-messaging's package.json.

---

### C_M4 — M3.6: Component purity audit must include PopupCard, Header, AddressDisplay

**Finding**: Some components in `src/components/ui/` already import from service clients or stores. Specifically: `PopupCard.vue`, `Header.vue`, `AddressDisplay.vue` have service deps and CANNOT move to extension-ui as-is.

**Fix in M3.6**: Before moving any component, run:
```
grep -r "wallet/services\|stores/\|composables/configClient\|composables/externalLinks\|composables/externalImage" src/components/
```
Document which components have service deps and keep them in `@nulo/extension`. Only move confirmed-pure components.

---

### C_M5 — M3.7: dependency-cruiser version pin + `tsPreCompilationDeps`

**Finding**: Should pin `dependency-cruiser@17.3.10`. In Bun monorepos, need `tsPreCompilationDeps: true` and explicit `tsConfig.fileName` to ensure TypeScript path resolution works. `.vue` analysis requires the Vue compiler to be visible.

**Fix in M3.7**: Update dependency-cruiser config options:
```js
options: {
  moduleSystems: ["es6"],
  tsConfig: { fileName: "tsconfig.json" },
  tsPreCompilationDeps: true,
}
```
And install at exact version: `dependency-cruiser@17.3.10`.
