# 00 — Workspace map (outer layer)

Scope: apps/extension, packages/{wallet-core,wallet-crypto,extension-messaging,aztec-runtime,wallet-bridge,wallet-sdk-schema-patch}.
`packages/bridge-core` bodies out of scope; its extension call sites are in scope (§5).

## 1. Module inventory (purpose, exports, rough non-test LOC)

| Package | Purpose (one sentence) | Key exports | Non-test LOC |
|---|---|---|---|
| `packages/wallet-core` | Foundation: pure ports/types/utilities with no `chrome.*` and no I/O — the layer every other package builds on. | Barrel `src/index.ts` is intentionally empty (`export {}`); real surface is subpaths: `./ports` (`BrowserApi`, `AlarmsPort`, `RuntimePort`, `WindowPort`), `./storage` (`ValueStorage`, `EntityStorage`), `./migration` (migration engine), `./base` (`ServiceCollection`, topology), `./utils` (`Lock`, `ReadWriteGuard`, `EventHandler`), `./logger` (`ILogger`), `./testing` (`FakeBrowserApi`, `MockClock`), `./jobs`, `./activity`. | ~5438 (excl. `src/testing/`); ~5940 incl. it (testing helpers are shipped via the `./testing` subpath, consumed by other packages' tests, not test files themselves). |
| `packages/wallet-crypto` | Password/passkey KDF, `PasswordSecretBox` AES-GCM encryption, and the vector-locked derivation chain (BIP-39 → Fr master secret → account keys). | `src/index.ts` (real barrel): `EncryptionKey`, `PasswordSecretBox`, `PasskeyCredential`, `deriveNuloAccountKeys`, `deriveSigningKeyFromSeed`, `deriveAccountSeed`, `deriveBip39Seed`, `deriveMasterFromMnemonic`, `derivePxeStoreKey`, `computeEnvelopeMacV3`/`verifyEnvelopeMacV3`, `sealImportedSigningKeyV2`/`unsealImportedSigningKeyV2`, `generateImportedKeysDek`, `sealDekUnderWrapKey`/`unsealDekUnderWrapKey`, `computeWalletFingerprint`, `SessionSecretBox`, `zeroize`, branded secret-type helpers (`asBase64MasterSecret`, `asPasshash`, …). | 1425 (single `src/`, no testing subdir). |
| `packages/extension-messaging` | Typed RPC plumbing (`Service`/`ServiceClient`/`OffscreenService`) between SW, popup, and offscreen document over `chrome.runtime`. | `src/index.ts` empty barrel; subpaths: `./background` (`Service`, `ServiceClient`), `./offscreen` (`OffscreenService`, its client + telemetry), `./errors` (`WalletError` hierarchy), `./messages` (wire schema: `RequestMessage`/`ResponseMessage`/`EventMessage`/`SubscribeMessage`), `./utils` (`wrapParams`/`unwrapParams`), `./zod` (`validateParams`/`validateResult`). | ~2208 (excl. `src/testing/setup.ts`); ~2448 incl. it. |
| `packages/aztec-runtime` | PXE lifecycle + Nulo's account adapter over `@aztec/accounts/schnorr`; runs inside the offscreen document. | `src/index.ts` empty barrel; subpaths: `./pxe` (`PxeService`, client/proxy/`ipxe` spec, `chain-runtime`, `artifact-registry`), `./pxe/public-events`, `./account` (`NuloAccount`, `fee-options`), `./ports` (`AztecNodeFactory`-shaped port), `./adapters` (`AztecNodeFactoryAdapter`), `./utils` (fetch wrapper), `./offscreen/entry` (offscreen bootstrap entry point). | 4734. |
| `packages/wallet-bridge` | The dApp-facing dispatcher: implements the `@aztec/wallet-sdk` capability map, narrows protocol messages to typed service calls, enforces per-session scope. Deliberately transport-shaped, not chain-shaped (no `aztec-runtime` dep). | `src/index.ts` re-exports (`export *`) `account-resolution`, `action`, `authwit-content`, `caip`, `capabilities`, `capability-map`, `dapp-interaction-protocol`, `discovery-queue`, **`dispatcher`**, `external-id`, `fee`, `fee-payer`, `operation`, `operation-validation`, `operation-result`, `scope-enforcement`, `services-contract`, `session-types`, `transaction-origin`, `wallet-features`, `types`. Note: `src/index.ts`'s own header comment says the dispatcher "stays in `@nulo/extension`" — but `dispatcher.ts` is physically in this package and is re-exported from the barrel; documentation/reality mismatch. | 3938. |
| `packages/wallet-sdk-schema-patch` | Single-source runtime patch that adds Nulo-custom RPCs (`registerToken`, `isTokenRegistered`, `grantPublicAuthwit`, `getWalletFeatures`) to `@aztec/wallet-sdk`'s `WalletSchema` singleton, consumed identically by extension/tools/playground. | `./apply` → `applyNuloSchemaPatch(schema)` (pure, throws on upstream signature drift); `./register` → side-effect-only entry (`import "@nulo/wallet-sdk-schema-patch/register"` must be the first import in an entry module). No root barrel. | 132. |
| `apps/extension` | The MV3 wallet extension itself: service worker, popup UI (Vue 3), offscreen PXE host, content-script dApp bridge, onboarding/setup pages. Sink of the whole layer stack. | Not a library — entry points are the manifest's `background.service_worker`/`scripts`, `action.default_popup`, `side_panel.default_path`, and the content script (see §3). | 90072 (src/, excl. `*.test.ts`). |

Discrepancy note: `packages/wallet-sdk-schema-patch/src/apply.ts` header pins "upstream version: `@aztec/wallet-sdk == 5.2.0`" while the README "Signature-drift guard" section says `5.0.0-rc.2` — README stale.

## 2. Dependency graph + layer-order check

Documented order: `wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`

| Package | `@nulo/*` deps declared |
|---|---|
| `wallet-core` | none |
| `wallet-crypto` | `@nulo/wallet-core` |
| `extension-messaging` | `@nulo/wallet-core` |
| `aztec-runtime` | `@nulo/wallet-core`, `@nulo/wallet-crypto`, `@nulo/extension-messaging` |
| `wallet-bridge` | `@nulo/wallet-core`, `@nulo/extension-messaging` (NOT `aztec-runtime`; devDep on `@nulo/wallet-sdk-schema-patch` for tests only) |
| `wallet-sdk-schema-patch` | none (standalone leaf: `@aztec/aztec.js`, `@aztec/stdlib`, `zod`) |
| `apps/extension` | all six + `@nulo/bridge-core`, `@nulo/design`, `@nulo/resolve-asset` |

**No layer-order violations found.** `biome.json` `noRestrictedImports` overrides enforce the graph at lint time for every package (`wallet-core` also bans the `chrome` global via `noRestrictedGlobals`). No override for `wallet-sdk-schema-patch` (nothing to restrict).

## 3. Extension build surface

Manifest source: `apps/extension/manifest/manifest.config.ts` (shared base) + `manifest.chrome.config.ts` / `manifest.firefox.config.ts` (overlays via `@crxjs/vite-plugin`). Built by `vite.chrome.config.mts` / `vite.firefox.config.mts`.

- **`manifest_version`**: 3.
- **`permissions`**: `["alarms", "offscreen", "storage", "sidePanel", "unlimitedStorage", "downloads"]` (Chrome). Firefox overlay filters out `"offscreen"`.
- **`host_permissions`**: `["https://nulo.sh/", "http://127.0.0.1/*"]` — no `<all_urls>`.
- **`optional_permissions`**: none.
- **`content_security_policy`**: `{ extension_pages: "script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob:" }`. Also COEP `require-corp` + COOP `same-origin` (multithreaded bb.js WASM).
- **`web_accessible_resources`**: `[{ matches: ["*://*/*"], resources: ["src/assets/logo.png"] }]`.
- **`externally_connectable`**: absent.
- **`content_scripts`**: one entry — `all_frames: true`, `js: ["src/content-script/content.ts"]`, `matches: ["*://*/*"]`, `run_at: "document_start"`. Pure relay using `@aztec/wallet-sdk/extension/handlers`' `ContentScriptConnectionHandler` over `chrome.runtime.sendMessage`/`onMessage`.
- **Pages**: SW `src/wallet/index.ts` (Chrome `type: module`; Firefox `background.scripts` + `persistent: false`). Popup + side panel → `src/popup/index.html#/popup/general`. Offscreen (Chrome only, PXE host): `src/offscreen/index.html` + `index.ts`; Firefox falls back to a hidden window (ARCHITECTURE §6). Other HTML entries: `src/setup/index.html`, `src/onboarding/index.html`. No `sandbox` key.
- **`VITE_*` security-relevant env**:
  - `VITE_FEE_JUICE_BRIDGE_URL` (`src/popup/components/modules/send/fee-helpers.ts:215`) — default `https://tools.nulo.sh`.
  - `VITE_LOCAL_NETWORK_RPC_URL` (`src/wallet/services/network/service.ts:89`) — default `http://localhost:8080`.
  - `VITE_NULO_E2E_DEFAULT_NET` (`network/service.ts:97`).
  - `VITE_COINGECKO_API_KEY` (`price/service.ts:324`).
  - `VITE_NULO_E2E_PRICE_MAP` (`price/price-map.ts:52`).
  - `VITE_NULO_E2E_PROVERLESS` + `_CONFIRM` (`src/e2e/config.ts:29-30`) — double opt-in; skips proof generation ("a PRODUCTION CATASTROPHE if it ever ships"); DCE + negative bundle-grep in `_build-extension.yml`.
  - `VITE_NULO_E2E_MIGRATION_FIXTURE` (`e2e/config.ts:65`).
  - `VITE_NULO_E2E_TOKEN_SEEDS` + `_CONFIRM` (`e2e/config.ts:79-80`).
  - `VITE_NULO_ACCELERATOR_REQUIRED` (`src/accelerator/config.ts:26`).
  - Compile-time defines via `vite.shared.ts`: `__VERSION__`, `__AZTEC_VERSION__`, `__NAME__`, `__DISPLAY_NAME__`.

## 4. `@aztec/*` and crypto-lib dependencies (exact versions)

All `@aztec/*` at `5.2.0` unless noted.

| Package | `@aztec/*` | Other crypto-adjacent |
|---|---|---|
| `wallet-core` | none | Web Crypto only |
| `wallet-crypto` | `@aztec/accounts`, `@aztec/constants`, `@aztec/foundation` | none direct — Web Crypto (`SubtleCrypto`) + `@aztec/foundation` (`Fr`, `poseidon2HashWithSeparator`, `sha512ToGrumpkinScalar`, `deriveSecretKeyFromSigningKey`). |
| `extension-messaging` | none | none |
| `aztec-runtime` | accounts, aztec.js, bb.js, constants, entrypoints, foundation, kv-store, noir-contracts.js, protocol-contracts, pxe, simulator, standard-contracts, stdlib; `@alejoamiras/aztec-accelerator@5.2.0`, `@aztec-foundation/aztec-standards@5.0.1`, `@alejoamiras/private-fee-juice@5.0.1` | transitive `@noble/*`, `@scure/bip39` |
| `wallet-bridge` | aztec.js, foundation, stdlib, wallet-sdk | none |
| `wallet-sdk-schema-patch` | aztec.js, stdlib | `zod ^4.4.3` |
| `apps/extension` | accelerator, accounts, aztec.js, bb.js, constants, entrypoints, foundation, kv-store, noir-acvm_js, noir-contracts.js, noir-noirc_abi, protocol-contracts, pxe, simulator, sqlite3mc-wasm, standard-contracts, stdlib, wallet-sdk; devDeps ethereum, l1-artifacts, viem@2.38.2, wallets | `webextension-polyfill`, `zod ^4.4.3` |

Transitive crypto: `@noble/curves` 1.7.0 (exact-pinned by `@aztec/foundation`), 1.9.1 / 1.6.0 nested; `@noble/hashes` 1.8.0 / 1.6.0 / 2.3.0; `@noble/ciphers@1.3.0` (ox/viem chain); `@scure/bip39` 2.3.0 / 1.6.0; `@scure/bip32@1.7.0`, `@scure/base@1.2.6`. No tweetnacl / libsodium.

## 5. Extension → `@nulo/bridge-core` call sites

All from `./fee-juice`, same two symbols:
- `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:30` — `MinFeeNode`, `predictedWorstMinFees`
- `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:77` — `predictedWorstMinFees`
- `apps/extension/src/wallet/services/execution/transfer-estimate-reuse.ts:22` — `MinFeeNode`, `predictedWorstMinFees`
- `apps/extension/src/wallet/services/execution/fee/fee-strategy.ts:44` — `predictedWorstMinFees`
- (test-only mock in `operation-estimate-reuse.test.ts:8`)

## 6. Patches (`bun.patchedDependencies`)

Four patches under `patches/`: `@aztec/noir-acvm_js@{5.0.1,5.2.0}` and `@aztec/noir-noirc_abi@{5.0.1,5.2.0}` — each rewrites `package.json` `module` into an `exports` map with `node`/`default` conditions so Node picks `nodejs/*.js` and vite keeps `web/*.js`. Packaging-only, no WASM/logic change.
