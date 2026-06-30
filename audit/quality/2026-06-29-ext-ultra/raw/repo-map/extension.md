# Repo map — `packages/extension`

> Phase-1 structural map for the `/harden quality` (ultra) audit.
> Special lens: **TYPING quality** (`any`/`unknown` misuse, loose boundary types,
> primitive obsession, missing discriminated unions, duplicated type shapes, casts)
> and **DEDUP** (duplicated logic/types within extension or shared with siblings).
> Read-only, structure-level sampling — not a full file read.

**Package purpose.** The Manifest V3 wallet extension — the *sink* of the monorepo
layer stack (`wallet-core → wallet-crypto → extension-messaging → aztec-runtime →
wallet-bridge → extension`). Nothing imports it. It hosts the four browser contexts
(service worker, popup, content script, offscreen), the background **service graph**
(21 services, each a `spec.ts` + `service.ts` + `client.ts` triplet over the
`Service`/`ServiceClient` RPC pattern), the Vue 3 popup UI (L0–L6 component model +
C0/C1 composables), Pinia stores, and the storage/crypto/config plumbing.

**Size.** ~437 non-test source files (`.ts`/`.vue`/`.mts`) + ~188 colocated
`*.test.ts`, ~66.4k source LOC. Largest subtrees: `src/wallet/` (155 src),
`src/popup/` (125 src), `src/components/` (76 src).

---

## 1. Module inventory

### `src/wallet/` — background service worker (155 src / 81 test)

The SW entry + the 21-service graph + storage/crypto/config/logger/base plumbing.

| Group | Files (rough LOC) | Purpose |
|---|---|---|
| `wallet/index.ts`, `runtime.ts` | index (SW entry), runtime | SW bootstrap; wires the service graph. |
| `wallet/base/index.ts` | 5 LOC | Re-export of `@nulo/wallet-core/base` (`Service`/`ServiceClient`/`ServiceSpec`, errors, zod-helpers). The pattern source lives upstream. |
| `wallet/storage/` | `index.ts`, `migrate.ts` | Storage abstraction + destructive wipe-on-bump migration. |
| `wallet/config/` | `config.ts`, `store.ts`, `index.ts` | Config schema + store (5 casts, 2 double-casts in `store.ts`). |
| `wallet/crypto/` | `key-vectors.test.ts` only | Crypto test vectors (impl is upstream in `wallet-crypto`). |
| `wallet/constants/` | `explorers.ts` | Block-explorer URL table. |
| `wallet/logger/` | `index.ts`, `store.ts`, `utils.ts` | SW-side logging store. |
| `wallet/utils/` | auth-registry, caip, create-passkey-profile, fee-juice, fn, offscreen, onboarding-tab, passkey-ceremony, passkey-label, serialization, index | Cross-cutting SW helpers (CAIP-2 chain ids, passkey ceremony glue, serialization). |
| **`wallet/services/<name>/`** | **21 services** | See §service-graph below. Each: `spec.ts` (ServiceSpec + zod), `service.ts` (impl), `client.ts` (popup-side proxy). |

**The 21 services** (`spec`=21, `client`=22, `service`=21):
account, account-state, auth-registry, config, contact, dapp-interaction,
dapp-session, execution, fpc, incoming-transfer, log-viewer, logger, network,
note, operation-journal, passkey, profile, task, token, token-balance,
transaction. Plus `pxe/` (no spec — shallow-PXE port + artifact registry +
chain-runtime, consumed in-process) and `wallet-sdk/` (the dApp-facing boundary:
background dispatcher, content-script-validator, error-envelope, queued-journal,
session-baton, nulo-schema-patch) and `window-manager/`.

Heaviest service impls: `profile/service.ts` (1109), `incoming-transfer/service.ts`
(841), `network/service.ts` (794), `wallet-sdk/background.ts` (745),
`execution/service.ts` (725), `profile/session-manager.ts` (624),
`execution/dapp-send-executor.ts` (605), `token/service.ts` (576),
`dapp-interaction/service.ts` (517), `fpc/service.ts` (501),
`auth-registry/service.ts` (448), `operation-journal/service.ts` (427).

`execution/` is a sub-package in itself: ~40 files — executors (dapp-send,
transfer, view), `execution-coordinator`, `execution-lane`, `execution-mutex`,
`operation-planner`, `tx-request-builder` (466), `contract-resolver`, `fast-path`,
`claim-helper`, `coerce-amount`, `authwit-discoverer`, `gas-balance-reader`,
`rpc-cancel`, `mark-failed-unless-cancelled`, `transfer-estimate-reuse`,
`tx-fee-details`, `models/index.ts` (re-export barrel of wallet-bridge op types),
`fee/` (6 strategies + embedded-fpc-cap), `helpers/` (batched-view-simulation 567,
block-header-anchor, get-view-simulation-deps), `utils/fee-detection`.

### `src/popup/` — Vue popup app (125 src / 36 test)

| Group | Count | Layer | Purpose |
|---|---|---|---|
| `popup/pages/**` | ~37 `.vue` | L6 | File-routed pages (vite-plugin-pages). `send.vue` (577), `tx/[id].vue` (569), `journal/[id].vue` (448), big `settings/**` tree (~24 pages incl `advanced/account-state/**`). |
| `popup/components/modules/**` | ~28 `.vue` + 7 `.ts` | L4 | Service-bound feature modules: `general/` (BalanceView 413, TokensView 409, TokenCard, GasBalanceCard, RecentActivityView 871 + `recent-activity-handlers.ts`), `send/` (FeeSettingsCard 415, FeeMethodSelector + `fee-helpers.ts` 184), `activity/`, `settings/{authwits,connected-apps,contacts,fpcs,new-profile}` (each with a `*-helpers.ts`), `tx/`. |
| `popup/components/popups/**` | ~29 `.vue` | L5 | Modal dialogs: `PopupManager.vue` + Edit*/New*/Select* family (EditContactPopup 503, NewTokenPopup, SelectFpcPopup, ReceivePopup, ConfirmPopup, …). |
| `popup/windows/**` | ~16 (.vue + .ts) | L5 | Standalone dApp windows: `execute/` (index.vue 584, OperationCard.vue 528, humanize, operation-validation, signers, types), `capabilities/` (index 434, build-items, CapabilityCard), `discover/`, `verify/`, `json/`, `logger/`, `passkey/`. |
| `popup/utils/` | `cancellable-rejection.ts` | — | Promise-rejection helper. |
| `popup/constants/` | `storage-keys.ts` | — | Popup-scoped storage keys. |
| `popup/index.ts` | entry | — | Popup app bootstrap. |

### `src/components/` — shared visual layer (76 src / 34 test)

| Group | Layer | Files |
|---|---|---|
| `components/ui/**` | L2 | Local host-coupled wrappers (`Button`, `SubPageHeader`, `ToastManager`) over `@nulo/design` bases + `Dropdown/` (Root/Item/Trigger/Title/Divider), `Settings/` (ItemsContainer, SettingField/Item/Value), `Popup/PopupHeader`, `utils.ts`. Most L2 primitives are externalized to `@nulo/design`. |
| `components/composite/**` | L3 | FormPopup, SecretRevealCard, SecretExportLayout, SecretUnlockSection, SecretCountdownClose, DappIdentityBlock/StatusStrip/CancelledOverlay, `general/` (AccountAvatar, AddressInput, EmojiGrid), `send/` (AmountCard, FeeJuiceCard, RecipientCard, SendTypesCard), `import/` (ImportFullBackupForm, ImportMethodPicker, ImportSecretForm), `activity/` (TransactionCardLayout + Awaiting/Incoming/Terminal cards), `capabilities/CapabilityDetailPanel`. |
| flat service-bound | — | `Header.vue`, `AddressDisplay.vue`, `GlobalLoader.vue`, `NotificationManager.vue`, `ScopeAddress/ScopeClassId`, `Divider`, `install.vue`, `update.vue`. |
| `components/JsonViewer/**` | — | `JsonViewer.vue`, `LogsViewer.vue`, `LogsToolbar.vue`, `useLogFilters.ts`, `logs-csv/decoration/format.ts`. |
| `components/passkey/` | — | `PasskeyCeremonyDialog.vue` (cross-shell — popup + onboarding). |
| `components/Popup/` | — | `Popup.vue`, `PopupCard.vue` (shell-level modal host). |

### `src/composables/` — C0/C1 hooks (19 src / 16 test)

C0 pure: `ticker`, `syncedRef` (.d.ts), `fullscreenPopupSetting`. C1 service hooks:
`useFormState`, `useEntityCrud<T>`, `useFeeEstimation`, `useFeeEstimationMap`,
`useDappInteractionPayload`, `useDappHostname`, `useSecretCountdown`,
`useIncomingTransfers`, `usePasskeyCeremony`, `useFullBackupImport` (468),
`useProfileBootstrap`, `useProfileCreateFlow`, `useProfileImportFlow`,
`useProfileNameField`, `waitForProfileActive`. (`toast.d.ts` = re-export shim decl.)

### Other roots

- `src/stores/` (4): `app.store.ts`, `popup.store.ts`, `cache.store.ts`, `notification.store.ts` (Pinia).
- `src/utils/` (19): activity-rows, amount, card-subtitle, confirmation-policies, console-sniffer, contacts-export-format, **core.ts** (heavy casts), fee-estimation, files, full-backup-helpers, journal-state, lastActiveProfile, primary-method, restore-error, string, transfer-intent, tx-enrichment, index (+ `general.d.ts`).
- `src/core/` (6): `adapters/` (chrome-browser-api, clock-ticker-adapter, system-clock, index), `testing/` (fake-node-factory, index).
- `src/onboarding/` (12): own Vue shell — `app.vue`, `index.ts`, `pages/` (welcome, create, import, fees, accelerator, learn, done), `components/` (OnboardingPage, StepIndicator), `composables/useAcceleratorStatus`.
- `src/setup/` (2): shared boot wiring `app.vue` + `index.ts` (+ index.html/scss).
- `src/content-script/content.ts`, `src/offscreen/` (index.ts + is-benign-sw-disconnect), `src/shims/` (bb-fetch-code, detect-node, function-bind-stub.cjs), `src/accelerator/config.ts`, `src/pages/about.vue`, `src/design/` (tokens.ts re-export + Storybook stories + theme-vars.test).

---

## 2. Public exports / entrypoints

Four browser-context entrypoints (per README + manifest):

| Entry | File |
|---|---|
| Service Worker | `src/wallet/index.ts` |
| Popup UI | `src/popup/index.ts` |
| Content Script | `src/content-script/content.ts` |
| Offscreen | `src/offscreen/index.ts` |

Plus the onboarding shell (`src/onboarding/index.ts`) and setup shell
(`src/setup/index.ts`). This is the sink package — **no other package imports it**.
Internal "public" surface = the per-service `client.ts` proxies (consumed by popup
Vue code as `new <Name>ServiceClient()`) and the `execution/models/index.ts` barrel
that re-exports `@nulo/wallet-bridge` operation/result types under
`@/wallet/services/execution/service`.

---

## 3. Trust boundaries / state owners / external calls

- **dApp → wallet boundary** (highest trust gradient): `content-script/content.ts`
  + `wallet/services/wallet-sdk/` (`background.ts` dispatcher, `content-script-validator`,
  `error-envelope`, `session-baton`) + `dapp-session/` (capability grants) +
  `dapp-interaction/` (payload materialization). Untrusted dApp input crosses here.
- **`nulo-schema-patch.ts`** mutates `@aztec/wallet-sdk`'s `WalletSchema` at runtime
  (side-effect import) to add `registerToken`/`isTokenRegistered`/`grantPublicAuthwit`.
  3 verbatim copies (extension/faucet/playground) — see §9.
- **State owners**: Pinia stores (`app`/`popup`/`cache`/`notification`) own UI state;
  each background `service.ts` owns its domain state behind the storage abstraction
  (`wallet/storage`); profile/session-manager owns the unlock/session lifecycle.
- **External calls**: PXE/RPC via `aztec-runtime` (offscreen-hosted PXE);
  `network/service.ts` does RPC; `token-balance/` polls balances; `execution/`
  simulates+proves+sends txs (bb.js proving via accelerator). `chrome.*` /
  `webextension-polyfill` accessed through `core/adapters/chrome-browser-api.ts`.
- **Crypto/secrets**: passkey ceremony (`wallet/utils/passkey-*`, `passkey/service`),
  full-backup export/import (`useFullBackupImport`, `full-backup-helpers`), seed/key
  export pages (`settings/security/export/**`).

---

## 4. Internal dependency graph (one level)

```
content-script ─▶ wallet-sdk (dispatcher) ─▶ dapp-session / dapp-interaction
                                            └▶ execution ─▶ fee/ + helpers/ + pxe/
popup/index ─▶ pages (L6) ─▶ modules (L4) ─▶ composables (C1) ─▶ <Name>ServiceClient
            └▶ windows (L5) ─▶ composite (L3) ─▶ ui (L2) ─▶ @nulo/design (L0/L1)
            └▶ popups (L5) ─▶ stores (Pinia)
wallet/index (SW) ─▶ runtime ─▶ service graph (21 svcs, phase-ordered) ─▶ storage/config/logger
offscreen/index ─▶ @nulo/aztec-runtime (PXE host)
all services ─▶ wallet/base (= @nulo/wallet-core/base)  ─▶ @nulo/wallet-bridge (op types)
```

Layer rule (enforced by biome `noRestrictedImports`): a layer imports only lower
layers. `execution/models` is the seam where wallet-bridge op types enter the
extension. `core/adapters` is the seam where `chrome.*` enters (banned in
`wallet-core`).

---

## 5. Frameworks / libs

- **UI**: Vue 3.5 (`<script setup>`), vue-router 5, Pinia 3, vite-plugin-pages
  (file routing), unplugin-auto-import + unplugin-vue-components (auto-imports),
  `@nulo/design` (externalized L0–L2), focus-trap, lean-qr, luxon, sass.
- **Aztec**: `@aztec/*` 5.0.0-rc.1 (exact-pinned: aztec.js, bb.js, pxe, stdlib,
  wallet-sdk, accounts, simulator, noir-*…), `@alejoamiras/aztec-accelerator`,
  `@defi-wonderland/aztec-standards` + `@wonderland/aztec-fee-payment` (tarball URLs).
- **Workspace**: `@nulo/{aztec-runtime,wallet-bridge,wallet-core,wallet-crypto,extension-messaging,design}`.
- **Validation/serialization**: zod 4.4, pako (gzip), webext-bridge, webextension-polyfill.
- **Editor**: CodeMirror 6 family (JsonViewer/LogsViewer).
- **Build/test**: Vite 8 + @crxjs/vite-plugin, vitest 4, @vue/test-utils,
  @webext-core/fake-browser, puppeteer 25 (e2e), Storybook 10, vue-tsc, biome.

---

## 6. Test surfaces

- **Unit + component** (`vitest.config.ts`): ~188 colocated `*.test.ts`. `chrome.*`
  stubbed in `tests/vitest.setup.ts`. Component tests mount via `@vue/test-utils`.
- **Composition layer** (`*.composition.test.ts`): drives the real service graph
  in-process against dumb fakes (shallow PXE, bb-free, no simulate/prove). Present in
  `dapp-session/`, `execution/`, `token/`. Rules in `tests/COMPOSITION-TESTS.md`.
- **Characterization / scenarios / integration / pxe-seam**: `execution/service.{characterization,pxe-seam}.test.ts`, `incoming-transfer/service.scenarios.test.ts`, `profile/service.integration.test.ts`, `helpers/batched-view-simulation.integration.test.ts`.
- **Structural-parity tests** (dedup guards): `execution/fee/{fee-structural-parity,strategies-structural}.test.ts`, `execution/feesettings-invariant.test.ts`, `execution/fingerprints.test.ts`.
- **Smoke e2e** (`vitest.e2e.config.ts`): `tests/e2e/*.test.ts`, no sandbox.
- **Network e2e** (`vitest.e2e.network.config.ts`): `tests/e2e/network/**`, per-worktree anvil+aztec+playground (agent runner).
- `src/e2e/` (3 src / 2 test): in-source e2e helpers.

---

## 7. Generated / vendored / fixture paths to EXCLUDE

Do **not** audit for typing/dedup (generated, vendored, or fixture):

- `src/types/*.d.ts` — `auto-imports.d.ts`, `components.d.ts` (unplugin-generated),
  `console.d.ts`, `vite-env.d.ts`.
- `src/composables/syncedRef.d.ts`, `src/composables/toast.d.ts`, `src/utils/general.d.ts` — hand-written `.d.ts` shims/decls (note, but exclude from `any`/cast counts).
- `src/design/tokens.ts` — re-export of generated `@nulo/design/tokens`.
- `**/*.stories.ts` — Storybook fixtures (e.g. `CapabilityDetailPanel.stories.ts` has
  5 `any`, irrelevant — fixture data).
- `src/shims/function-bind-stub.cjs` — vendored ESM-gap stub.
- Build/output: `dist/`, `node_modules/`, `public/`, `.storybook/` config,
  `.e2e-state/`, `wallet_data_*/`, `tsconfig.*.tsbuildinfo`.
- `**/*.fake.ts` (e.g. `pxe/shallow-port.fake.ts`) — test fakes (audit only if a fake
  leaks loose types into production paths).

---

## 8. Proposed Phase-2 clusters (14)

Tests travel with their source. Clusters flagged **(split candidate)** exceed ~25
files and P2 may subdivide; they are listed whole to keep the boundary stable.

### Background / service graph (8)

1. **`extension/wallet-services-execution`** — `wallet/services/execution/`
   root: `service.ts`, `client.ts`, `spec.ts`, `execution-coordinator`,
   `execution-lane`, `execution-mutex`, `dapp-send-executor`, `transfer-executor`,
   `view-executor`, `operation-planner`, `tx-request-builder`, `tx-fee-details`,
   `contract-resolver`, `fast-path`, `claim-helper`, `coerce-amount`,
   `authwit-discoverer`, `gas-balance-reader`, `rpc-cancel`,
   `mark-failed-unless-cancelled`, `transfer-estimate-reuse`, `models/index.ts`
   (+ tests). **(split candidate)**

2. **`extension/wallet-services-fee`** — `execution/fee/` (fee-strategy,
   embedded-strategy, embedded-fpc-cap, fee-juice-strategy,
   fee-juice-with-claim-strategy, fpc-strategy + parity tests), `execution/helpers/`
   (batched-view-simulation, block-header-anchor, get-view-simulation-deps),
   `execution/utils/fee-detection`.

3. **`extension/wallet-services-profile`** — `wallet/services/profile/` (service,
   session-manager, repository, passkey-recovery-coordinator, require-active-profile,
   client, spec) + `wallet/services/passkey/` (service, check-rp-id, client, spec) +
   `wallet/utils/{passkey-ceremony,passkey-label,create-passkey-profile}`.

4. **`extension/wallet-services-dapp`** — `wallet/services/dapp-interaction/`
   (service, materialize, client, spec), `wallet/services/dapp-session/` (service,
   capability-meta, client, spec), `wallet/services/wallet-sdk/` (background,
   content-script-validator, error-envelope, queued-journal, session-baton,
   nulo-schema-patch), `wallet/services/window-manager/`. **(split candidate)**

5. **`extension/wallet-services-assets`** — `wallet/services/token/` (service,
   functions/, utils, client, spec), `wallet/services/token-balance/`
   (balance-job-queue, balance-projector, balance-repository, service, client, spec),
   `wallet/services/note/`, `wallet/services/incoming-transfer/`. **(split candidate)**

6. **`extension/wallet-services-network-account`** — `wallet/services/network/`,
   `wallet/services/transaction/`, `wallet/services/account/` (+ contracts/),
   `wallet/services/account-state/`, `wallet/services/auth-registry/` (+
   `wallet/utils/auth-registry`), `wallet/services/fpc/` (fpc, handlers/, service,
   client, spec). **(split candidate)**

7. **`extension/wallet-services-platform`** — `wallet/services/config/`,
   `wallet/services/logger/`, `wallet/services/log-viewer/`,
   `wallet/services/operation-journal/` (service, gc, reaper, client, spec),
   `wallet/services/task/`, `wallet/services/contact/`, `wallet/services/pxe/`
   (artifact-registry, chain-runtime, shallow-port, client). **(split candidate)**

8. **`extension/wallet-infra`** — `wallet/index.ts`, `wallet/runtime.ts`,
   `wallet/base/`, `wallet/storage/`, `wallet/crypto/`, `wallet/config/` (config,
   store, index), `wallet/constants/`, `wallet/logger/` (dir), remaining
   `wallet/utils/` (caip, fee-juice, fn, offscreen, onboarding-tab, serialization,
   index), `setup/`, `offscreen/`, `content-script/content.ts`, `shims/`,
   `accelerator/config.ts`.

### Popup / UI (5)

9. **`extension/popup-pages`** — `popup/pages/**` (L6, ~37 `.vue`). **(split
   candidate — by section: root vs `settings/**` vs `settings/advanced/account-state/**`)**

10. **`extension/popup-windows`** — `popup/windows/**` (L5 dApp windows: execute,
    capabilities, discover, verify, json, logger, passkey + their `.ts` helpers).

11. **`extension/popup-modules`** — `popup/components/modules/**` (L4 feature
    modules: general/, send/, activity/, tx/, settings/ + `*-helpers.ts`). **(split
    candidate — general+send vs settings)**

12. **`extension/popup-popups`** — `popup/components/popups/**` (L5 dialogs:
    PopupManager + Edit*/New*/Select*/Confirm/Receive/IncomingTrust…). **(split
    candidate)**

### Shared components / cross-cutting (2)

13. **`extension/components-primitives`** — `components/ui/**` (L2 wrappers,
    Dropdown, Settings, Popup, utils), `components/composite/**` (L3),
    `components/JsonViewer/**`, `components/passkey/`, `components/Popup/`, flat
    service-bound (Header, AddressDisplay, GlobalLoader, NotificationManager,
    Scope*, Divider, install/update). **(split candidate — ui/composite vs flat/JsonViewer)**

14. **`extension/composables-stores-utils`** — `composables/**` (C0/C1),
    `stores/**`, `utils/**`, `core/**` (adapters, testing), `popup/utils/`,
    `popup/constants/`, `onboarding/**`, `design/` (non-generated stories/tests),
    `pages/about.vue`. **(split candidate — composables vs stores+utils+core vs
    onboarding shell)**

---

## 9. Typing + dedup hotspot candidates

### Top 5 (highest-value)

1. **dApp→execution operation boundary — loose unions re-narrowed by casts.**
   `execution/dapp-send-executor.ts` (11 `as` casts), `dapp-interaction/service.ts`
   (6 casts + 1 double-cast), `dapp-interaction/materialize.ts` (6),
   `execution/operation-planner.ts` (6), `popup/windows/execute/index.vue` (5 casts
   + **6 `as unknown as`**). The `Operation`/`Action`/`OperationResult` family is a
   re-exported wallet-bridge union (`execution/models/index.ts`); consumers
   repeatedly narrow it with casts instead of exhaustive discriminated-union
   switches on `OperationKind`/`ActionKind`. Also `MaterializedRegisterTokenOperation`
   = `RegisterTokenOperation & { previewedInterface? }` is an ad-hoc intersection
   patched on at the popup seam — candidate for a proper discriminated variant.
   *Lens: missing/under-exploited discriminated unions, cast-as-narrowing.*

2. **`utils/core.ts` + `core/adapters/chrome-browser-api.ts` — `as unknown as`
   bridge zone.** `utils/core.ts` (6 `as` + **5 `as unknown as`**),
   `chrome-browser-api.ts` (**5 `as unknown as`**), `wallet/config/store.ts` (5 `as`
   + 2 double), `popup/.../useContactImportExport.ts` (1 double). These bridge
   `chrome.*`/`webextension-polyfill`/storage shapes with double-casts — the densest
   `as unknown as` concentration (22 total in non-test code). *Lens: loose boundary
   types, double-cast escapes at the platform seam.*

3. **`token/functions/` — near-duplicate per-function modules (DEDUP).** Identical-LOC
   pairs betray copy-paste: `balance-of-private.ts`/`balance-of-public.ts` (104 each),
   `get-name.ts`/`get-symbol.ts` (156 each), `transfer-private.ts`/
   `transfer-public-to-private.ts` (208 each), `transfer-public.ts`/
   `transfer-private-to-public.ts` (137 each). ~1367 LOC across 9 files that likely
   collapse to a parametrized factory (contract + fn-name + visibility). *Lens:
   duplicated logic.*

4. **3-copy `nulo-schema-patch.ts` (cross-package DEDUP + `any`).** Confirmed:
   `packages/extension/.../wallet-sdk/nulo-schema-patch.ts` (119),
   `packages/faucet/src/lib/nulo-schema-patch.ts` (96),
   `packages/playground/src/lib/nulo-schema-patch.ts` (95) — **code bodies are
   identical; only the JSDoc header differs.** Each uses `(WalletSchema as any)` ×3
   (6 `any` in the extension copy — the package's #1 `any` density, all
   genuinely-boundary biome-ignored). Documented-as-intentional (CLAUDE.md), pinned by
   `wallet-bridge/dispatcher.test.ts`. P2 question: a shared *typed* helper (even if
   the schema mutation stays inline) would kill both the drift surface and the `as
   any`. *Lens: cross-package duplication + untyped boundary.*

5. **Form/import composables + per-entity CRUD helpers — casts + shape dup.**
   `composables/useFullBackupImport.ts` (10 casts, 468 LOC),
   `composables/useFormState.ts` (7 casts), `utils/full-backup-helpers.ts` (3). The
   settings entity-CRUD helpers — `modules/settings/{authwits/authwit-helpers,
   fpcs/fpc-helpers,connected-apps/connected-app-helpers}.ts` + `useEntityCrud<T>` +
   `useContactImportExport.ts` — repeat the same row/CRUD shape per entity; the
   generic `useEntityCrud<T>` only half-unifies them. *Lens: primitive obsession in
   form state, duplicated CRUD-row type shapes, loose generic boundary.*

### Secondary / lower-priority

- **Fee strategies (intentional-but-parity-fragile dedup).** `execution/fee/` 6
  strategy files (fee-strategy 196, fpc-strategy 85, embedded-strategy 54,
  fee-juice-strategy 37, fee-juice-with-claim-strategy 45, embedded-fpc-cap 82) are
  kept in lockstep by `fee-structural-parity.test.ts` + `strategies-structural.test.ts`
  — dedup-by-convention. Worth confirming whether a shared base/strategy interface
  removes the need for parity tests.
- **21× `spec.ts`/`service.ts`/`client.ts` triplet (intentional pattern, boilerplate).**
  The `Service`/`ServiceClient` RPC pattern is repeated 21 times. Not a defect, but a
  surface to check for copy-paste drift in the `client.ts` proxies and whether
  `spec.ts` zod shapes duplicate types already defined in `wallet-bridge`.
- **`profile/service.ts` (1109 LOC, 3 casts, 3 `any`)** and `incoming-transfer/`,
  `network/` mega-services — size alone makes them typing-review targets; check for
  internal type-shape duplication (e.g. repeated profile/session DTOs).
- **`utils/files.ts` (2 `any`)**, **`utils/console-sniffer.ts` (2 `any`)**,
  `composables/useFeeEstimation.ts` + `useFeeEstimationMap.ts` (1 `any` each, plus a
  likely shared estimate shape with `utils/fee-estimation.ts` — dedup check).
- **`pxe/shallow-port.fake.ts`** uses a double-cast — verify the fake's loose type
  doesn't leak into the production `shallow-port.ts` contract.
- **`tx-enrichment.ts` / `activity-rows.ts` / `tx-detail-helpers.ts` /
  `recent-activity-handlers.ts`** — transaction/activity row shaping spread across
  utils + popup module helpers; candidate for duplicated row/DTO shapes.
