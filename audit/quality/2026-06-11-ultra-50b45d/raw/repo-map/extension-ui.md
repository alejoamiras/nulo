# UI Layer Map — Nulo Browser Extension (`packages/extension`)

Mapper: Fable Explore subagent. All paths under `packages/extension/` unless absolute.

## 1. Module inventory

LOC = source lines (`.vue`/`.ts`/`.js`, excluding tests/stories). Whole scope: ~40.0k src LOC + ~11.8k test LOC.

| Subsystem | Purpose | src LOC |
|---|---|---|
| `src/design/` | L0 design tokens (`tokens.ts`) plus Storybook token galleries. | ~198 (514 with stories) |
| `src/components/core/` | L1 primitives: `Flex`, `Icon`, `MaterialIcon`, `Text`. No chrome.*. | 305 |
| `src/components/ui/` | L2 primitives: Button, Input, Toggle, Tooltip, Badge, Banner, Spinner, Popover, ToastManager, SubPageHeader, `Dropdown/` (7 files), `Settings/`, `Popup/PopupHeader`. Service/store imports banned by biome. | ~2,600 |
| `src/components/composite/` | L3: `FormPopup`, `activity/` transaction cards, `send/` (AmountCard, FeeJuiceCard, SendTypesCard), `import/` forms, `capabilities/CapabilityDetailPanel`, Secret* export components, Dapp* blocks, `general/EmojiGrid`. | ~3,300 |
| `src/components/` (flat) | Service-bound exemptions (CLAUDE.md:91): `Header.vue` (399), `AddressDisplay`, `ScopeAddress`, `ScopeClassId`, `GlobalLoader`, `NotificationManager`, `Popup/`, `Divider`, `install.vue`, `update.vue`, `JsonViewer/` (1,267 incl. vendored creator.js/theme.js). | ~2,500 |
| `src/composables/` | C0/C1: fee estimation twins (`useFeeEstimation`, `useFeeEstimationMap`), `useEntityCrud`, `useFormState`, `useFullBackupImport` (468), `usePasskeyCeremony`, `useProfileBootstrap`, `useProfileNameField`, `useSecretCountdown`, `useDappHostname`, `useDappInteractionPayload`, `waitForProfileActive`, `ticker`, legacy `.js` (toast/notification/outside/syncedRef with `.d.ts` shims). | 1,880 |
| `src/stores/` | 4 Pinia setup stores: app.store (active profile/account/network), popup.store (popup stack), cache.store (tx/balance cache, imports tx-enrichment), notification.store. | 349 |
| `src/popup/pages/` | L6 routed pages incl. 22-file `settings/` tree. | ~7,800 |
| `src/popup/windows/` | L5 dapp windows: `execute/` (10 files, 1,609), `capabilities/` (7 files, 1,315), discover, verify, json, logger, passkey. | ~3,600 |
| `src/popup/components/popups/` | 30 popups + PopupManager dispatcher. | ~7,400 |
| `src/popup/components/modules/` | L4 modules: general/ (BalanceView, TokensView, RecentActivityView…), send/ (Fee* family), activity/, auth/, tx/, settings/*. | ~6,200 |
| `src/onboarding/` | Separate entrypoint: 7 pages, components, useAcceleratorStatus. | 2,198 |

## 2. L5/L6 service bindings (highlights)

- `execute/` window — 8 service clients (heaviest binder)
- `settings/security/export/full.vue` — **11 services** (widest fan-in)
- Onboarding pages bind zero clients directly — go through composables.
- PopupManager dispatches 30 popups via popup.store; binds config + incoming-transfer.

## 3. Dependency graph notes

- stores → service client **types only**; cache.store → app.store.
- L1-L3 clean: zero biome violations found. EXCEPT: `CapabilityDetailPanel.vue` and `DappIdentityBlock.vue` live in `composite/` (L3) and import services — against the stated L3 ban (sanctioned-by-list in CLAUDE.md but located in composite/).
- Onboarding boundary exception: `onboarding/pages/import.vue` + `create.vue` import `@/popup/components/popups/PasskeyCeremonyDialog.vue` — popup/components/popups is not in the banned glob list (rule gap).
- Top import tallies: app.store (73), popup.store (47), toast (41+14), cache.store (33).

## 4. Similarity candidates (concrete)

1. **New/Edit popup pairs** — 11 popups share FormPopup + useEntityCrud/useFormState scaffold but remain pairwise near-duplicates: New/EditContactPopup (504), New/EditFpcPopup (320), New/EditNetworkPopup, New/EditEndpointPopup, New/EditAccountPopup.
2. **Select\*Popup family** — five list-selection popups, same pick-from-list shape: SelectBalanceTypePopup (221), SelectFpcPopup (235), SelectNetworksPopup (150), SelectProfilePopup (165), SelectTokenPopup (122).
3. **Fee estimation/display** — useFeeEstimation vs useFeeEstimationMap (deliberate twins); 4+ places render fee/gas balances: modules/send/Fee* family (FeeSettingsCard 415 + 4 more), composite/send/FeeJuiceCard, modules/general/GasBalanceCard, modules/tx/TxFeeRow.
4. **Transaction cards** — composite/activity/ TransactionCardLayout + variants; modules/activity/TransactionCard wraps layout; RecentActivityView (894) re-renders activity rows with own recent-activity-handlers.ts. Two activity list surfaces: RecentActivityView vs TransactionsList + pages/activity.
5. **Import flows** — popup/pages/import.vue (668) and onboarding/pages/import.vue (540) import the IDENTICAL set of composite forms + composables; page shells are parallel implementations. Similarly profile/new.vue (397) vs onboarding/create.vue (377).
6. **Secret export pages** — settings/security/export/{key,seed,full}.vue share Secret* kit; key/seed are thin twins, full.vue (485) outlier.
7. **Account-state list pages** — settings/advanced/account-state/{authwits,contracts,notes,senders}/index.vue (275/188/497/225) repeat the same SubPageHeader+Banner+LoadingState+fetch-list scaffold; zero data-testids.
8. **Hash-display chips** — ScopeAddress (102) vs ScopeClassId (65) vs AddressDisplay (111): three truncate-and-copy displays.
9. **Balance views** — BalanceView (405) vs SplittedBalancesView (179).

## 5. House conventions

L0-L6 + C0/C1 enforced via biome noRestrictedImports (biome.json:235-322). Cleanup-order invariant (CLAUDE.md:147-162). SFC block order. testid discipline (e2e selects only by data-testid). Colocated tests, createTestingPinia, chrome stubbed in tests/vitest.setup.ts. Coverage minimums: L1/L2 ≥5, L3 ≥10, composables ≥10, L4-L6 optional.

## 6. Test surfaces

| Layer | files | tests | shape |
|---|---|---|---|
| L1 core | 4 | 0 | Untested (below stated minimums) |
| L2 ui | 24 | 17 | Strong |
| L3 composite | 20 | 19 | Near-complete |
| flat components | ~14 | 5 | Partial; Header/AddressDisplay/NotificationManager untested |
| composables | ~17 | 13 | Strong |
| stores | 4 | 1 (app.store only) | Thin |
| L4 modules | 28 | 17 | send/ good; general/ views mostly untested |
| L5 popups | 30 | 6 | Sparse (per policy) |
| L6 pages | 37 | 1 | e2e-covered by policy |
| windows | 11 | 7 | Helper-focused |
| onboarding | 10 | 3 | |

## 7. Generated/vendored exclusions

src/types/{auto-imports,components,console,vite-env}.d.ts (biome-excluded), src/shims/, JsonViewer/creator.js + theme.js (vendored CodeMirror), composables/{syncedRef,toast}.d.ts shims.

## 8. Change hotspots (3 months)

```
5 popup/windows/execute/index.vue        5 popup/windows/capabilities/index.vue
5 modules/general/RecentActivityView.vue 4 popup/windows/execute/OperationCard.vue
4 popup/pages/profile/new.vue            4 popup/pages/import.vue
3 stores/app.store.ts                    3 windows/verify/index.vue
3 windows/discover/index.vue             3 pages/tx/[id].vue
3 pages/send.vue ... (see git)           3 popups/PopupManager.vue
3 popups/NewTokenPopup.vue               3 popups/IncomingTrustPopup.vue
3 modules/general/recent-activity-handlers.ts
3 composite/activity/TransactionCardLayout.vue
```
Hotspot centers: execute window, capabilities window, RecentActivityView — also size outliers.

## 9. Size outliers (top 15 + flags)

894 RecentActivityView.vue (**god-component flag**, top-3 hotspot) · 668 pages/import.vue · 577 pages/send.vue · 574 windows/execute/index.vue (**flag**: 8 clients + top hotspot) · 569 pages/tx/[id].vue · 540 onboarding/import.vue · 504 EditContactPopup.vue (**flag**) · 497 account-state/notes/index.vue · 489 execute/OperationCard.vue · 485 export/full.vue (11 services) · 468 useFullBackupImport.ts · 448 journal/[id].vue · 446 change-password.vue · 434 windows/capabilities/index.vue · 415 FeeSettingsCard.vue.
Near-misses: TokensView 409, verify/index 407, BalanceView 405, Header 399, ui/Input 394 (large L2 primitive).
