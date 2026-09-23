I now have sufficient depth across the codebase to produce the report.

# Nulo Extension UI Map — `apps/extension/src/{popup,components,composables,onboarding,stores}`

## 1. Module inventory

**Popup pages** (`popup/pages/**`, route base `popup`, file-based via `vite-plugin-pages`):
- `index.vue`, `general.vue` (45 lines, home dashboard shell), `activity.vue` (308) — feed via `useIncomingTransfers`
- `send.vue` (691 lines) — the largest page; owns 5 service clients directly
- `tx/[id].vue` (597), `received/[id].vue` (554), `journal/[id].vue` (493) — detail/operation-journal drill-ins
- `import.vue` (484) — thin shell around `useProfileImportFlow`/`useFullBackupImport`
- `auth.vue` (376), `register.vue` (161), `profile/new.vue` — thin shell around `useProfileCreateFlow`
- `settings/**` — `index.vue`, `about.vue`, `appearance.vue` (335), `accounts/index.vue`, `tokens/index.vue`, `contacts/index.vue`, `fpcs/index.vue`, `networks/[id].vue` (315) + `index.vue`, `connected-apps/index.vue` (360) + `[id].vue` (352), `profile/index.vue`, `advanced/index.vue`, `advanced/account-state/{index,authwits,contracts,notes,senders}/index.vue` (notes/index.vue 497 — largest settings leaf), `security/{index,change-password(448),reset(354)}.vue`, `security/export/{index,full(508),seed,key}.vue`
- `[...catch].vue` — 404 fallback
- Colocated pure-fn helpers: `send-amount.ts`/`send-fiat-gate.ts` (fee/amount and fiat-quote gating logic pulled out of `send.vue`), `import-helpers.ts`, `new-profile-helpers.ts`, `received-copy.ts`, `should-advance-to-general.ts` — each paired 1:1 with a `.test.ts`.

**Popup windows** (`popup/windows/**`, route base `windows`) — MV3 standalone approval popups, each `chrome.windows.create`d by the SW:
- `execute/` (index.vue 599 lines) — dApp tx/op approval; `OperationCard.vue`, `SignerIdentityStrip.vue`, plus pure helpers `humanize.ts`, `signers.ts`, `operation-validation.ts`, `types.ts` (all separately tested)
- `discover/` (238) — dApp connect/session approval
- `capabilities/` (417) — capability-grant approval; `AccountSelectRow.vue`, `CapabilityCard.vue`, `build-items.ts`
- `json/` (83) — raw request JSON viewer (spawned from execute's "expand" icon)
- `logger/` (80) — in-app log viewer window (hosts `JsonViewer/LogsViewer.vue`)
- `passkey/` (81) — passkey ceremony host window
- `verify/` (336) — emoji/identity verification window

**Popups** (`popup/components/popups/**`, mounted centrally by `PopupManager.vue`, toggled via `popup.store`): ~28 modal components — CRUD pairs (`New*/Edit*` for Account, Network, Endpoint, Fpc, Contact, Token, Profile, Sender), pickers (`Select{Profile,Fpc,Token,Networks,BalanceType}Popup`), auth-adjacent (`ForgotPasswordPopup`, `IncomingTrustPopup`), authwit management (`ChangeAuthwitsRegistryPopup`, `RevokeAuthwitsPopup`), misc (`ConfirmPopup`, `DataViewerPopup`, `ReceivePopup`, `TokenMetadataPopup`, `ImportContactsPopup`).

**Module components** (`popup/components/modules/**`, L4, service-bound), grouped:
- `activity/` — `TransactionCard.vue`, `TransactionsList.vue`
- `auth/` — `AuthProfilePill.vue`
- `general/` — `BalanceView.vue` (390), `GasBalanceCard.vue` (263, `balances.store` subscriber), `TokenCard.vue`, `TokenImportRow.vue`, `TokensView.vue` (558), `RecentActivityView.vue` (963 — largest module, 9 distinct service-client imports), `ActionButtonsView.vue`, `recent-activity-handlers.ts`
- `send/` — `FeeSettingsCard.vue` (714 — second-largest, `balances.store` primary consumer), `FeeMethodRow/Selector/PriorityRow`, `FeeCostReadout.vue`, `RecipientField.vue`, `SelectTokenCard.vue`, `fee-helpers.ts`
- `settings/` — `authwits/AuthwitCard.vue`+`authwit-helpers.ts`, `connected-apps/{DappSessionVerification,GrantedCapabilitiesList}.vue`+`connected-app-helpers.ts`, `contacts/ContactRow.vue`+`useContactImportExport.ts`, `fpcs/FpcRow.vue`+`fpc-helpers.ts`, `new-profile/{NewProfileCredentials,NewProfileMethodTabs}.vue`
- `tx/` — `TxDebugPanel.vue`, `TxFeeRow.vue`, `tx-detail-helpers.ts`

**Composables** (`composables/**`):
- `useFeeEstimation.ts` / `useFeeEstimationMap.ts` — single-slot vs. per-key adapters over the shared `internal/fee-estimation-engine.ts`
- `useSecretClipboardCopy.ts` — F-14 clipboard-scrub for secret export
- `useSecretCountdown.ts` — auto-close countdown timer for secret-reveal pages
- `ticker.ts` (`useTicker`) — refcounted shared `setInterval` singleton keyed by period
- `usePrices.ts` — C1 wrapper over a connected `PriceServiceClient`, staleness via `useTicker(30_000)`
- `useEntityCrud.ts` — generic add/update/delete event-wiring for entity lists
- `useFormState.ts` (234) — per-field reactive form state/validation
- `useFullBackupImport.ts` (774 — largest composable) — full-backup restore orchestration across 11 services
- `useIncomingTransfers.ts` — shared incoming-transfer feed wiring (activity page + home widget)
- `usePasskeyCeremony.ts` — drives `PasskeyCeremonyDialog`
- `usePopupEntity.ts` — shared show/hide + Enter-key-submit lifecycle for plain CRUD popups
- `useDappApprovalWindow.ts` (140) — shared lifecycle shell for execute/discover/capabilities windows
- `useDappHostname.ts`, `useDappInteractionPayload.ts` — dApp-window helpers
- `useProfileBootstrap.ts`, `useProfileCreateFlow.ts` (138), `useProfileImportFlow.ts` (325), `useProfileNameField.ts` — shared popup/onboarding profile lifecycle
- `completeImportWithRecovery.ts`, `waitForProfileActive.ts`, `importChainSync.ts`, `importPreflight.ts` — import-flow tail orchestration (SW-restart recovery, bounded chain registration)
- `useFullscreenPopupSetting.ts` (`fullscreenPopupSetting.ts`) — `PopupCard` fullscreen config flag
- `internal/fee-estimation-engine.ts` — deliberately non-auto-importable (in `internal/`, outside the auto-import `dirs` scan), Vue-free state machine
- `syncedRef.js`, `outside.js`, `notification.js`, `toast.js` — small `.js` utilities with hand-written `.d.ts` companions (`syncedRef.d.ts`, `toast.d.ts`)

**Stores** (`stores/**`, Pinia setup-stores):
- `app.store.ts` (435) — the central store: profile/account/network identity, scope-change guard, in-flight-send tracking, onboarding-completed flag, activity delegation
- `activity.store.ts` (315) — per-scope tx/awaiting slices, LRU-evicted (32 slices)
- `balances.store.ts` (637 — largest, heaviest state machine) — fee-juice/FPC balance fetching, epoch-fenced per-profile
- `popup.store.ts` (34) — open-popup registry (`{order, payload}` map)
- `cache.store.ts` (62) — grab-bag of cross-popup UI scratch state (edit indices, preselects, import staging)
- `notification.store.ts` (53) — queued single-active toast/dialog notifications

**Onboarding shells** (`onboarding/**`): `app.vue` (129) + `index.ts`; pages `welcome.vue`(112), `create.vue`(335), `import.vue`(373), `learn.vue`(154), `accelerator.vue`(311), `fees.vue`(152), `done.vue`(150); `components/{OnboardingPage,StepIndicator}.vue`; `composables/useAcceleratorStatus.ts`.

## 2. Entrypoints

- **Popup shell**: `popup/index.ts` → installs logger/`onunhandledrejection` forwarding → `initAppServiceContext()` (eager profile+contact ports) → `createRouter(createWebHashHistory)` with `~pages` (vite-plugin-pages virtual module) → `router.beforeEach` guard (register/auth redirects, active-profile resolution, passkey-interaction bypass) → mounts `App` (`popup/app.vue`) with Pinia. `popup/app.vue` owns the theme watcher, a `ConfigServiceClient` subscription, `AccountServiceClient`/network-switch watchers, a 10s `setInterval` keepalive-refresh, and renders `PopupManager`, `ToastManager`, `NotificationManager`, `GlobalLoader`, `MigrationBarrier`, `AccountIntegrityBarrier`, `Header`, `RouterView`, `Navigation`.
- **Onboarding shell**: `onboarding/index.ts` — near-identical boot sequence (same logger/`initAppServiceContext` calls), separate router rooted at `/onboarding/welcome`. `onboarding/app.vue` mirrors the popup's barrier/manager stack (`PopupManager`, `ToastManager`, `NotificationManager`, `GlobalLoader`, `MigrationBarrier` — no `AccountIntegrityBarrier`) and redirects to a real popup window (`chrome.windows.create`) once onboarding is complete or a profile already exists.
- **Approval windows** (`execute`, `discover`, `capabilities`): standalone `chrome.windows.create`d MV3 popups sharing the same `popup/index.html`/router under route base `windows-*`. Each window: `onMounted(startWindow)` from `useDappApprovalWindow` (eager connects → session-ready wait → auth redirect → `init()` → `beforeunload` registration) / `onUnmounted(disposeWindow)`.
- **Router structure**: five `vite-plugin-pages` roots configured in `vite.config.ts` (`src/pages`→`common`, `src/setup/pages`→`setup` [out of scope], `src/popup/pages`→`popup`, `src/popup/windows`→`windows`, `src/onboarding/pages`→`onboarding`), all merged into one `~pages` array consumed independently by the popup and onboarding entrypoints (each pushes its own catch-all redirect).

## 3. Coupling surfaces

- **`@/utils/core`** (`managers` proxy + `require*`/`get*` accessors) — 28 non-test consumers across the scope; this is the single service-client registry gate (profile/contact eager, network/transaction/account lazy-assigned post-unlock).
- **Heaviest service-client fan-out per file** (count of distinct `@/wallet/services/*/client` imports): `useFullBackupImport.ts` (24), `settings/security/export/full.vue` (13), `RecentActivityView.vue` (9), `execute/index.vue` (8), `app.store.ts` (7), `send.vue` (7), `balances.store.ts` (6), `execute/OperationCard.vue` (6), `activity.vue` (6).
- **`@nulo/design` auto-import resolver** (`scripts/design-resolver.ts`, `NULO_DESIGN_COMPONENTS`): 16 bare-tag names (`Flex`, `Icon`, `Text`, `MaterialIcon`, `Badge`, `BrutalistTitle`, `Checkbox`, `SectionLabel`, `Toggle`, `Spinner`, `Banner`, `LoadingState`, `Tooltip`, `Popover`, `Input`) resolve to the external package; anything not in that set resolves through `unplugin-vue-components`'s directory scan of `src/components` + `src/onboarding/components` — i.e. **every** component under those trees (any layer) is a bare-tag global, not just L1/L2.
- **L0–L6 layer boundaries**, enforced by `biome.json` `noRestrictedImports` overrides (root `biome.json` lines ~340–427):
  - `components/{core,ui,composite}/**` — banned from `@/utils/core`, all four stores by literal path, and patterns `@/wallet/services/*/client`, `@/wallet/services/*/service`, `@/stores/*`.
  - `popup/components/modules/**` (L4) — banned from importing `@/popup/pages/**` and `@/popup/windows/**`.
  - `onboarding/**` — banned from `@/popup/pages/**`, `@/popup/windows/**`, and `@/popup/components/modules/**`.
- **Near-violation — the auto-import surface bypasses the biome import-linter.** `biome`'s `noRestrictedImports` only inspects `<script>` `import` statements. `unplugin-vue-components` registers every SFC under `src/components/**` as a global bare tag with no import line. Concretely: `components/composite/FormPopup.vue` (L3, banned from service clients) renders `<Popup>`/`<PopupCard>`/`<PopupHeader>` with **zero import statements** — `PopupCard.vue` (flat, `components/Popup/PopupCard.vue`) internally calls `useFullscreenPopupSetting()`, which owns a `ConfigServiceClient` connect/disconnect lifecycle. This is architecturally sanctioned (that's exactly why `PopupCard` lives flat, not in `composite/`, per the documented flat-component carve-out), but it means the layer ban is provably enforced only for direct JS/TS imports, not template-level composition — a future flat/service-bound component accidentally referenced from a real L2/L3 file would not be caught by biome.
- **`FeeSettingsCard.vue`** (L4) is imported by `send.vue` (L6), `execute/index.vue` + `execute/OperationCard.vue` (L5 window), and `ChangeAuthwitsRegistryPopup.vue`/`RevokeAuthwitsPopup.vue` (L5 popups) — a genuine L4 fan-in hub, consistent with the "L4 cannot import L5/L6, but L5/L6 may import L4" rule.
- **`PopupManager.vue`** is the single highest-complexity orchestration surface in `popup/components/popups/`: it mounts all ~24 popups, owns an `IncomingTransferServiceClient` + `ConfigServiceClient`, and runs a hand-rolled priority queue (dedup by `profileId|networkId|contract` triple, live-triple staleness checks, replay-on-connect/replay-on-visibility-toggle) for the "first-receive friction" trust prompt.

## 4. State owners

- **`app.store.ts`** — identity (`profile`, `account`, `network`, `accounts`, `networks`), auth flags (`isLogined`, `isSessionChecked`), `onboardingCompleted` (persisted via `storageLocalGet/Set`), and the **in-flight-send guard**: owns one app-lifetime `OperationJournalServiceClient` (connect-once, `inFlightConnected` flag), exposes `commitScopeChange(commit)` — a synchronous-commit pattern that refuses account/network/profile switches while `hasInFlightSend` is true. Delegates transaction storage to `activity.store` via `activeScope` watcher (`flush: 'sync'`).
- **`activity.store.ts`** — per-`(profileId, networkId, chainId, accountAddress)` slice map (`ActivitySlice`), LRU-capped at 32 (`MAX_CACHED_SLICES`), with `txScope()`/`txBelongsToScope()` quarantine logic for unscoped legacy rows (sole-profile-only attribution).
- **`balances.store.ts`** — the most complex state owner in scope: owns app-lifetime `ExecutionServiceClient`, `FpcServiceClient`, `TransactionServiceClient` (lazy tx-subscription via `ensureTxSubscription`); per-key epoch fencing (profile switch bumps `epochs` Map + synchronously clears entries via a `watch(..., { flush: "sync" })` "belt", with a last-subscriber-release "suspenders" fence in `subscribe().release`); raw-RPC flight reuse (`rawFlights`) and single-flight leg runs (`legFlights`) keyed by `${key}|${leg}|${epoch}`; retry backoff timers (`retryTimers`, `INIT_RETRY_BACKOFF_MS = [5s,10s,20s,30s]`) gated on subscriber capability (`SubscribeCaps.retry`); tx-settle-triggered forced refresh (`onTransactionSettled`) with sequence-numbered supersession (`forcedGasSeq`).
- **`internal/fee-estimation-engine.ts`** (via `useFeeEstimation`/`useFeeEstimationMap`) — per-key `setTimeout` debounce (`timers`), monotonic staleness counters (`counters`), caller-minted `crypto.randomUUID()` cancellation tokens, in-flight/completed token maps, and a `handedOff` set that prevents remote-cancel racing a submitted estimate. Consumed by `send.vue` (single-slot, 800ms) and `execute/index.vue` (keyed map, 500ms).
- **`ticker.ts`** — module-level `Map<period, TickerEntry>` of refcounted `setInterval`s shared across all `useTicker()` callers (e.g. `usePrices` at 30s, `send.vue`'s fiat-gate at 30s); last unmount clears the interval and deletes the map entry.
- **`useSecretClipboardCopy.ts`** — owns a `setTimeout`-based clipboard scrub (`CLIPBOARD_CLEAR_MS = 60_000`) that is **deliberately not tied to any lifecycle hook** (documented exception to the repo's dispose convention — a route-nav away from the export page keeps the popup JS context alive, so unmount-cancelling the scrub would defeat it).
- **`useSecretCountdown.ts`** — owns `closeTimeout`/`tickInterval`, self-registers `onScopeDispose(clear)` (a second documented exception — the composable owns its own lifecycle hook rather than exposing `dispose()` to the parent).
- **`useDappApprovalWindow.ts`** does NOT own lifecycle hooks itself (per convention) — it returns `start`/`dispose` that each window calls from its own `onMounted`/`onUnmounted`.
- **Service-client lifecycles owned by pages/windows** (construct-in-`<script setup>`, disconnect in `onBeforeUnmount`/`useDappApprovalWindow`'s injected `disconnectServices`): `send.vue` owns `TokenServiceClient`, `TokenBalanceServiceClient`, `ContactServiceClient`, `PriceServiceClient`, `ExecutionServiceClient` (the last is explicitly `.disconnect()`'d inside the `executeTransfer(...).finally()`, not in `onBeforeUnmount`); `execute/index.vue` owns `ExecutionServiceClient`, `DappInteractionServiceClient`, `TokenServiceClient`, `ProfileServiceClient`; `PopupManager.vue` owns `IncomingTransferServiceClient` + `ConfigServiceClient` for its lifetime as the always-mounted popup root; `MigrationBarrier.vue`/`AccountIntegrityBarrier.vue` bypass the service-client layer entirely and read `chrome.storage.local` raw (explicitly allowlisted in the storage-facade-ban, since they must observe state the facade itself would deadlock on).

## 5. Dependency graph

Clean top-down shape, no import cycles found in the scoped surface:

```
L6 pages (popup/pages, onboarding/pages)
   → L5 windows (popup/windows/*)         [pages don't import windows]
   → L5 popups (popup/components/popups)
   → L4 modules (popup/components/modules)
        → L3 composites (components/composite)
             → L2 ui (components/ui, @nulo/design/ui)
                  → L1 core (@nulo/design/core)
                       → L0 tokens (@nulo/design)
   → C1 composables (composables/*.ts)     [receive connected clients from the page/window]
        → C0 pure (composables/internal/fee-estimation-engine.ts, ticker.ts)
   → stores (pinia)                        [app.store → activity.store; balances.store → app.store]
   → flat service-bound components (components/*.vue, components/Popup/*, components/passkey/*)
```

- **Twin-shell reuse (popup + onboarding), not duplication**: `popup/pages/profile/new.vue` and `onboarding/pages/create.vue` both drive `useProfileCreateFlow` + `usePasskeyCeremony`; `popup/pages/import.vue` and `onboarding/pages/import.vue` both drive `useProfileImportFlow` + `completeImportWithRecovery` + `useProfileBootstrap`, and both render the same three composites `ImportFullBackupForm.vue`/`ImportMethodPicker.vue`/`ImportSecretForm.vue` (`components/composite/import/`) plus `components/passkey/PasskeyCeremonyDialog.vue` — all deliberately placed flat under `src/components/` (never `src/popup/**`) specifically so onboarding's biome ban on `@/popup/**` doesn't block the shared import.
- **Store→store edge**: `app.store.ts` imports `activity.store.ts` (`useActivityStore`, `txBelongsToScope`, `txScope`); `balances.store.ts` imports `app.store.ts` (`useAppStore`) for its epoch-fence watcher. `activity.store.ts` and `popup.store.ts`/`cache.store.ts`/`notification.store.ts` have no store-to-store imports. No cycle: `activity ← app ← balances` is a strict chain.
- **`internal/fee-estimation-engine.ts`** is a leaf with zero Vue imports; `useFeeEstimation.ts` and `useFeeEstimationMap.ts` are thin sibling adapters over it — no cycle, and it's intentionally excluded from the auto-import `dirs` scan (only reachable by explicit relative import) since the scan is non-recursive.

## 6. Frameworks/primitives

- **Vue 3.5** (`^3.5.38`) — Composition API via `<script setup>`, global auto-import of `ref`/`computed`/`watch`/`onMounted`/etc. (no explicit Vue imports in most SFCs); `useTemplateRef`, `shallowRef`/`triggerRef` (activity.store), `reactive` (cache.store, useFormState), `Teleport` (MigrationBarrier, AccountIntegrityBarrier), `defineAsyncComponent` (setup shell, out of scope).
- **Pinia 3.0.4** — all six stores use the `defineStore(id, () => {...})` setup-store form (not options API); `useSyncedRef` (app.store's `loggerWindowId`) bridges Pinia state to `chrome.storage`.
- **vue-router 5.1.0** + **`vite-plugin-pages`** (file-based routing, `~pages` virtual module, `<route lang="json">` block per page for `meta.isAuthRequired`/`showBottomNav`/`isPasskeyInteraction`/`requirePasswordProfile`), `createWebHashHistory` (MV3-safe — no server-side routing).
- **`unplugin-auto-import`** — global imports of `vue`, `vue-router`, `webextension-polyfill` (aliased `browser`), plus directory scans of `src/composables/`, `src/stores/`, `src/utils/`, `src/onboarding/composables/` (non-recursive — hence `composables/internal/` opt-out). Generates `src/types/auto-imports.d.ts` + ESLint config at `src/types/.eslintrc-auto-import.json`.
- **`unplugin-vue-components`** — directory scan of `src/components/`, `src/onboarding/components/`, custom resolver `nuloDesignResolver()` (see §3). Generates `src/types/components.d.ts`.
- **Pinia + `@vue/test-utils`** testing: `createTestingPinia()` for store consumers (per `CLAUDE.md`); `chrome.*` globally stubbed by `tests/vitest.setup.ts`.
- **Third-party UI-adjacent**: `focus-trap` (dialog focus containment), `lean-qr` (Receive popup), `luxon` (date formatting), `codemirror` + `@codemirror/*` + `@lezer/highlight` (JsonViewer / DataViewerPopup / log viewer), `pako` (compression, likely backup blobs).

## 7. Test surfaces

Per `CLAUDE.md` mandate: L1/L2 ≥5 cases, L3 ≥10 cases, composables ≥10 cases; L4/L5/L6 not required.

- **L1/L2 (`components/ui/**`, local wrappers)**: 3 top-level `.vue` files (`Button.vue`, `SubPageHeader.vue`, `ToastManager.vue` — the host-coupled holdouts) plus `Dropdown/`, `Popup/PopupHeader.vue`, `Settings/*`. Test-case counts: `Dropdown.test.ts` 33, `Settings.test.ts` 22, `SubPageHeader.test.ts` 8, `PopupHeader.test.ts` 7, `Button.test.ts` 6 — all ≥5. **`ToastManager.test.ts` has only 2 cases — below the ≥5 mandate.** `Dropdown/{DropdownRoot,DropdownItem,DropdownTrigger,DropdownTitle,DropdownDivider}.vue` and `Settings/{ItemsContainer,SettingField,SettingItem,SettingValue}.vue` have no dedicated `.test.ts` (covered only via the parent `Dropdown.test.ts`/`Settings.test.ts` mount).
- **L3 (`components/composite/**`)**: full coverage — every `.vue` file has a colocated `.test.ts`. Counts range from `FeeJuiceCard.test.ts` (5, exactly at floor) up to `AmountCard.test.ts` (34); `send/AmountCard.vue` and `activity/TransactionCardLayout.test.ts` (21) are the deepest-tested composites.
- **Composables**: 34 of 35 have a `.test.ts`; **`ticker.ts` has none**. Test-case counts below the ≥10 floor: `waitForProfileActive.test.ts` (5), `completeImportWithRecovery.test.ts` (7), `importPreflight.test.ts` (8), `useDappHostname.test.ts` (8), `usePopupEntity.test.ts` (8). `useFullBackupImport.test.ts` is the deepest (49 cases, matching its size/risk).
- **Flat service-bound components** (`components/*.vue`): `AccountIntegrityBarrier.test.ts` (10), `MigrationBarrier.test.ts` (11) are well covered; **`Header.test.ts` has only 2 cases**. `GlobalLoader.vue`, `NotificationManager.vue`, `Divider.vue`, `Popup/{Popup,PopupCard}.vue`, `passkey/PasskeyCeremonyDialog.vue`? — `PasskeyCeremonyDialog.test.ts` exists (not counted above); `Popup/Popup.vue`/`PopupCard.vue`/`GlobalLoader.vue`/`NotificationManager.vue`/`Divider.vue`/`AddressDisplay.vue`/`install.vue`/`update.vue` have **no** test file (acceptable — not mandated, but zero coverage on `AddressDisplay.vue`, which is reused widely, is notable).
- **L4/L5/L6** (not required, "optional for complex pieces"): a handful nonetheless have tests — `TransactionCard.test.ts`, `AuthProfilePill.test.ts`, `BalanceView.test.ts`, `GasBalanceCard.test.ts`, `RecentActivityView.test.ts`, `TokenCard.test.ts`, `TokenImportRow.test.ts`, `TokensView.test.ts`, `FeeCostReadout.test.ts`, `FeeMethodRow.test.ts`, `FeeMethodSelector.test.ts`, `FeePriorityRow.test.ts`, `FeeSettingsCard.test.ts` (1341 lines — the single largest test file in the whole scope), `RecipientField.test.ts`, `ContactRow.test.ts`, `FpcRow.test.ts` at L4; `ChangeAuthwitsRegistryPopup`, `EditContactPopup`, `ImportContactsPopup`, `IncomingTrustPopup`, `NewContactPopup`, `NewTokenPopup`, `PopupManager`, `RevokeAuthwitsPopup` at L5 popups; `AccountSelectRow`, `build-items`, `capabilities/index`, `discover/index`(+`.lifecycle.test.ts`), `execute/{humanize,index,OperationCard.authwit,operation-validation,signers}` at L5 windows; `auth.vue`, `networks/index.vue` at L6 pages. The large majority of L4/L5/L6 (all popups except 8, all pages except 2, most modules) have **zero** test coverage, consistent with "covered by e2e + manual smoke" — the sibling e2e mapper's territory, out of scope here.

## 8. Generated/vendored/fixture code

- **`src/types/auto-imports.d.ts`** (42 KB) — generated by `unplugin-auto-import`; do not hand-edit.
- **`src/types/components.d.ts`** (6.4 KB) — generated by `unplugin-vue-components`; do not hand-edit.
- **`src/types/.eslintrc-auto-import.json`** (9 KB) — generated ESLint globals list paired with the above.
  - All three are checked into git (not `.gitignore`d) but regenerate on every dev/build run (mtimes track the latest `vite` invocation, not the last hand-authored commit) — treat as build output, exclude from manual review/diff-reading.
- **Hand-written, non-generated, but adjacent**: `src/shims-vue.d.ts`, `src/types/vite-env.d.ts`, `src/types/console.d.ts`, `src/composables/toast.d.ts`, `src/composables/syncedRef.d.ts` — these are real authored type shims, not generated; do not exclude them.
- No fixture/catalog data files were found inside the scoped paths themselves (no `*.fixtures.ts`, no vendored JSON catalogs under `popup/`, `components/`, `composables/`, `onboarding/`, `stores/`). Any vendored artifacts (e.g. `SchnorrAccount.json`, backup-migration fixtures) live under `src/wallet/**`, explicitly out of scope.

## 9. Apparent duplication

- **Enter-to-submit + connect/disconnect popup lifecycle, hand-rolled 10 times instead of using `usePopupEntity`.** `usePopupEntity.ts` exists exactly to extract `watch(() => props.show, ...)` + a document `keydown` Enter-submit listener, but is consumed by only 5 popups (`EditEndpointPopup`, `NewNetworkPopup`, `NewAccountPopup`, `EditNetworkPopup`, `EditAccountPopup`). Ten other popups hand-roll the identical `document.addEventListener("keydown", onKeydown)` pattern verbatim, with `NewContactPopup.vue`'s comment ("Only fire on input/textarea fields...") copy-pasted into `EditContactPopup.vue` and `NewFpcPopup.vue`: `NewEndpointPopup.vue`, `ChangeAuthwitsRegistryPopup.vue`, `NewContactPopup.vue`, `EditContactPopup.vue`, `RevokeAuthwitsPopup.vue`, `NewFpcPopup.vue`, `EditProfilePopup.vue`, `EditFpcPopup.vue`, `NewTokenPopup.vue`, `NewSenderPopup.vue`.
- **Entity add/update/delete event wiring, hand-rolled in creation popups instead of `useEntityCrud`.** `useEntityCrud.ts` is used by 5 settings *list* pages (`fpcs/index.vue`, `contacts/index.vue`, `tokens/index.vue`, `advanced/account-state/{authwits,senders}/index.vue`), but the matching *creation* popups (`NewFpcPopup.vue` shown in full above, and structurally similar `NewContactPopup.vue`, `NewTokenPopup.vue`, `NewSenderPopup.vue`) each hand-write their own `onXAdded`/`onXUpdated`/`onXDeleted` splice-into-array handlers rather than reusing the composable — same shape, different call sites.
- **`popup/windows/{execute,discover,capabilities}/index.vue` footer/status-strip markup and styles.** The `useDappApprovalWindow` composable already extracted the *logic* skeleton, but the three windows still duplicate the `<style module>` block verbatim (`.wrapper`/`.scroll_area`/`.footer` — identical CSS in `execute/index.vue` and `discover/index.vue`, confirmed byte-similar) and the Reject/Confirm `<Button>` + `<Tooltip>`-error-banner template structure. A shared `DappApprovalFooter`-style composite would close this; today it's copy-pasted markup, not copy-pasted logic.
- **`settings/security/export/{seed,key}.vue`** are near-identical twins: same 4 composite imports (`SecretExportLayout`, `SecretRevealCard`, `SecretCountdownClose`, `SecretUnlockSection`), same `useSecretCountdown` usage, differing only in which `managers.*` secret-retrieval call they make and copy text — reasonable given the differing secret semantics, but structurally a template to watch for drift.
- **`MigrationBarrier.vue` and `AccountIntegrityBarrier.vue`** independently reimplement the same "raw `chrome.storage.local` observer behind a full-screen `Teleport to="body"` overlay" pattern (allowlisted in the storage-facade-ban for both), each with its own out-of-order-resolution guard (`eventTouched` Set in one, `refreshGeneration` monotonic counter in the other) — same problem solved twice with two different guard mechanisms.

## 10. Error-path hotspots

- **`send.vue` → `handleSend`**: constructs an optimistic `AwaitingTx` placeholder (unique `crypto.randomUUID()` id) via `appStore.addAwaitingTransaction` *before* the RPC, then `executionService.executeTransfer(...).then(...).catch(...).finally(...)` — on catch, removes exactly that placeholder, classifies the rejection via `popup/utils/cancellable-rejection.ts`'s `classifyCancellableRejection` (silent for user-cancel vs. toast for real failure), and always disconnects `executionService` in `.finally()` regardless of outcome. The fiat-quote gate (`send-fiat-gate.ts`'s `evaluateFiatGate`) is re-evaluated at the actual click time (not the reactive computed) specifically to close a TOCTOU window against the 30s ticker.
- **`execute/index.vue` → `approve()`/`reject()`**: the deepest error surface in scope — guards against empty-operations races (`initComplete`), in-flight token-metadata prefetch (`tokenMetadataLoading`), per-op fee-selection completeness (`requiresFeeSelection`), and on catch distinguishes `JobCancelledError` (render the cancelled overlay, not an error banner — a raced dApp-side cancel) from generic failures (`setError` + `rearmFeeEstimates()` to un-hand-off the fee estimates so unmount can still clean them up). `init()` swallows all errors into `setError("Something went wrong")` by design (per `useDappApprovalWindow`'s documented contract: a rejecting `init()` would skip `beforeunload` registration, leaving a half-loaded popup unable to reject on close).
- **`useDappApprovalWindow.ts`**: codifies frozen, pinned-by-test semantics for the shared three-window teardown order (`disconnectServices()` → remove `beforeunload` listener, always last) and `closeWindow(interactionCompleted?)`'s asymmetric listener-removal (only removes on the "decided" path, deliberately leaves it attached on overlay-dismiss so the rejection still fires via the unload event).
- **`useFullBackupImport.ts`** (774 lines, 49 test cases) is the single heaviest error-handling surface in the scope: nested try/catch around parse → decrypt → passkey-ceremony (with its own inner catch for "ceremony not wired") → per-slice network/account/token restore (with a specific `catch` for `AccountService`'s `"Duplicate account"` throw that triggers a delete-and-continue sub-flow, itself wrapped in its own `catch (deleteErr)`) → chain registration tail → an outer `catch (err)` that runs full rollback bookkeeping (deleting partially-created profiles, with yet another nested `catch (deleteErr)` around *that* cleanup). Explicitly designed to survive an MV3 service-worker restart mid-import (`completeImportWithRecovery.ts`'s whole reason for existing).
- **`importPreflight.ts`/`importChainSync.ts`**: bounded-deadline network-connectivity preflight with exponential backoff (`PREFLIGHT_BACKOFF_WAITS_MS = [2s, 4s]`, `PREFLIGHT_CONCURRENCY = 3`) feeding a single-record-guarantee chain-registration race — every failure path funnels into exactly one `record(...)` call (never a bare throw) so the restore-errors screen always gets a consistent, non-duplicated log.
- **`PopupManager.vue`'s incoming-trust queue** has multiple documented stale-state races it defends against post-hoc (per inline "codex post-impl audit" comments): rapid profile-switch (A→B→A) landing a stale replay, a token deleted while its trust prompt is queued/open, and an `onConnected` replay racing the popup's own `loadProfile` cascade — each defended with an explicit live-triple comparison rather than trusting event ordering.
- **Toast error paths** are consistently routed through `useToast()`'s `openToast({label, icon, color}, duration)` with `TOAST_DURATION.LONG` for failures (`send.vue`, `execute/index.vue`, `FeeSettingsCard.vue` fee-estimation failures) — a uniform convention, not a hotspot itself, but the landing point for nearly every catch block enumerated above.