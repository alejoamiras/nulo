# Map: apps/extension/src/popup/** (~31.0k production LOC, 132 *.test.ts, 0 stories)

Paths below are relative to `apps/extension/src/popup/` unless prefixed.

## 1. Inventory
| Path | Purpose | ~LOC |
|---|---|--:|
| `index.ts`, `index.html`, `index.scss` | Boot: console forwarding, `initAppServiceContext()`, hash router from `~pages`, guard, Pinia, mount | 50 |
| `app.vue` | Shell: profile bootstrap, arrivals, tab nav, locked-state, token/price/incoming clients, popup host | 528 |
| `route-guard.ts`, `auth-guard.ts`, `root-flags.ts`, `locked-state.ts`, `lock-landing.ts`, `should-advance-to-general.ts` | Router gate decisions (pure, unit-tested) | ~600 |
| `boot-session.ts`, `apply-boot-outcome.ts`, `reconcile-locked-boot.ts`, `profile-bootstrap.ts`, `scope-epoch.ts`, `network-switch.ts` | Boot/activation sequencing, scope-epoch staleness guards, network switch | ~1.5k |
| `constants/storage-keys.ts`, `utils/{cancellable-rejection,transfer-failure-copy}.ts` | Small helpers | ~200 |
| `components/popups/` (29 .vue + `popup-shared.module.css`) | Modal popups (new/edit/select/confirm/trust...), hosted by `PopupManager.vue` | ~6.3k |
| `components/modules/` (45 files) | L4 feature modules: `general/` (BalanceView, TokensView, RecentActivityView, GasBalanceCard, TokenCard), `send/` (FeeSettingsCard, SendReviewSheet, RecipientField, SelectTokenCard, fee-helpers), `settings/` (contacts, authwits, new-profile), `tx/`, `activity/`, `holdings/`, `auth/` | ~9k |
| `components/Navigation.vue` | Bottom tab nav | small |
| `pages/` (file-based routes) | L6 pages; top-level: `auth, import, register, send (+send-*.ts helpers), activity, holdings, general, index, [...catch]`; dirs `tx/[id]`, `received/[id]`, `journal/[id]`, `tokens/[id]`, `profile/new`, `legal/declined`, `settings/**` (28 files) | ~13k |
| `windows/` | dApp approval windows: `execute`, `capabilities`, `discover`, `verify`, `passkey`, `json`, `logger` (+ `ConnectStepBar.vue`, `window-shell.module.css`) | ~4.3k |

Largest .vue (>500 lines), split by block:
| File | total | script | template | style |
|---|--:|--:|--:|--:|
| components/modules/send/FeeSettingsCard.vue | 982 | 823 | 107 | 52 |
| components/modules/general/RecentActivityView.vue | 958 | 783 | 96 | 79 |
| pages/send.vue | 865 | 652 | 127 | 78 |
| windows/execute/index.vue | 736 | 618 | 95 | 23 |
| pages/settings/security/export/full.vue | 733 | 418 | 246 | 59 |
| components/modules/general/BalanceView.vue | 619 | 348 | 91 | 180 |
| windows/execute/OperationCard.vue | 611 | 180 | 344 | 87 |
| components/modules/general/TokensView.vue | 595 | 391 | 100 | 104 |
| pages/tx/[id].vue | 554 | 144 | 204 | 198 |
| app.vue | 528 | 445 | 49 | 34 |
| pages/received/[id].vue | 525 | 186 | 149 | 186 |
| windows/capabilities/index.vue | 506 | 365 | 109 | 24 |
(Script-heavy monoliths: FeeSettingsCard, RecentActivityView, send.vue, execute/index, app.vue. Style-heavy: tx/[id], received/[id], BalanceView.) Next tier 300-460: auth.vue 451, account-state/notes/index 438, journal/[id] 430, connected-apps/[id] 395, import 364, PopupManager 355, SendReviewSheet 355, NewTokenPopup 345, RevokeAuthwitsPopup 344, appearance 338, change-password 337.
Shared CSS modules: `pages/detail-page.module.css` (66), `pages/tab-hero.module.css`, `windows/window-shell.module.css`, `components/popups/popup-shared.module.css` (30), `components/modules/send/fee-shared.module.css`, `components/modules/tx/tx-shared.module.css`, `components/modules/general/list-empty.module.css`. Most pages still carry their own big `<style module>`.

## 2. Entrypoints
- Boot (`index.ts`): `installConsoleForwarding("popup")` -> `initAppServiceContext()` (`@/utils/core`, opens profile+contact SW ports eagerly) -> `createRouter(createWebHashHistory, ~pages routes + "/"->"/popup")` -> `router.beforeEach(createPopupGuard(appStore, managers.profile))` -> `createApp(App).use(router).use(createPinia())`. Note Pinia is installed AFTER the router; guard reaches the store lazily via thunk.
- Guard: `route-guard.ts` (meta `isAuthRequired`, `isPasskeyInteraction` short-circuit) + `auth-guard.ts` (authoritative active-session read beats the lagging `isLogined` flag).
- `app.vue` then runs `useProfileBootstrap` (`profile-bootstrap.ts`, `boot-session.ts`, `apply-boot-outcome.ts`, `reconcile-locked-boot.ts`).
- Routes (file-based): `/`, `auth`, `register`, `import`, `profile/new`, `general`, `holdings`, `activity`, `send`, `tx/[id]`, `received/[id]`, `journal/[id]`, `tokens/[id]`, `legal/declined`, `[...catch]`, `settings/**` (about, appearance, glossary, proving, accounts{,/import}, advanced{,/account-state/{notes,authwits,senders}}, connected-apps{,/[id]}, contacts, fpcs, networks{,/[id]}, profile, security{,/change-password,/reset,/export/{index,seed,account,full}}, tokens).
- Windows (opened by SW `WindowManager`, route `windows-*`-style, `isAuthRequired` false for passkey): `windows/execute/index.vue` (tx/authwit approval), `windows/capabilities` (connect + permission grant), `windows/discover` (wallet discovery/emoji-confirm), `windows/verify` (session verify), `windows/json` (dApp JSON viewer), `windows/logger` (log CSV viewer; Developer Mode), `windows/passkey` ("PATH B": SW-driven passkey window, doc says NO production callers - dead-code candidate).
- Popup registry: `@/stores/popup.store.ts` (42 LOC; `open(name, payload)`, `isOpened`, `getPayload`, ordered stack). `components/popups/PopupManager.vue` (355) statically imports all 27 popup SFCs and renders each as `<XPopup :show="popupStore.isOpened('x')" @onClose=...>`; payloads also ride on `cacheStore` fields (`cacheStore.confirm.*`, `cacheStore.incomingTrust`). PopupManager also owns the IncomingTransfer trust-prompt queue (dedup by profile|network|contract triple) - a service subscriber living in a "manager" component.

## 3. Trust boundaries
- dApp-supplied data rendered: `windows/execute/{index,OperationCard,CallArguments,OperationActionRow,SignerIdentityStrip}.vue` + `display-calls.ts`, `call-surface.ts`, `humanize.ts`, `operation-validation.ts`, `signers.ts`, `scope-mismatch.ts` (function names/args/selectors/authwit payloads; wire-shaped 0x+64-hex fields; regression history 2026-09); `windows/capabilities/**` (`build-items.ts`, `permission-rows.ts`, `details-table.ts`, `chain-mismatch.ts`, `AccountSelectRow`: dApp name/origin/capability manifest); `windows/discover` (dApp hostname/ids), `windows/verify` (session/emoji), `windows/json/index.vue` (raw JSON of arbitrary payload, `@/components/JsonViewer`). Hostname via `@/composables/useDappHostname`. No `v-html`/`innerHTML` in popup/ (grep clean). Also `IncomingTrustPopup` (unknown-contract notes from chain -> contract address/name), `RevokeAuthwitsPopup`, `ChangeAuthwitsRegistryPopup`, `ImportContactsPopup` (user-file JSON import; `useContactImportExport.ts`, 302 LOC), `NewTokenPopup`/`TokenMetadataPopup` (token metadata from chain/dApp), `DataViewerPopup`.
- Secrets shown: `pages/settings/security/export/{seed,account,full}.vue` (recovery phrase/account file/full backup; `SecretRevealCard`, `SecretCountdownClose` composites), `components/modules/general/TokenSeedRow.vue` (token seed? verify), `pages/profile/new.vue` (seed/credentials creation).
- Secrets entered: `pages/auth.vue` (password/passkey unlock), `pages/import.vue`, `pages/settings/accounts/import.vue` (seed/secret key import), `pages/profile/new.vue` + `modules/settings/new-profile/NewProfileCredentials.vue`, `pages/settings/security/change-password.vue`, `pages/settings/security/reset.vue`, `ForgotPasswordPopup.vue`, `SecretUnlockSection` (composite, used by exports/change-password), passkey via `components/passkey/PasskeyCeremonyDialog.vue`. Logging rule applies to all (`log-payload-ban.test.ts`).
- Legal wall: `pages/send.vue` calls `managers.legal`/`useLegalAcceptance`; `legal/declined.vue`.

## 4. Dependencies (one level; service clients `new XServiceClient()` per component - 59 files construct clients)
- Stores: `app.store` (52 uses in settings pages alone), `popup.store` (77 uses in popups), `cache.store` (48), `balances.store` (modules/general+send), `activity.store`, `notification.store`.
- `app.vue`: managers.{profile,account,transaction}; Token, Price, IncomingTransfer, Config, Account clients; composables useArrivals, useProfileBootstrap, useToast.
- `pages/send.vue`: Token, TokenBalance, Price, OperationJournal, Execution, Contact clients + managers.legal; composables useFeeEstimation, useLegalAcceptance, usePrices, useSendReview, useTicker, useToast; helpers send-{amount,submit,fiat-gate,balance-events}.ts.
- `pages/auth.vue`: managers.profile x4, managers.account, Account client.
- `pages/tx/[id]`: Token, Config, Price. `received/[id]`: IncomingTransfer, Token, Config, Price, Network. `journal/[id]`: OperationJournal, Config, Token, Price. (same Config+Token+Price triple in all three detail pages)
- `windows/execute`: Profile, DappInteraction, Execution, Token clients + locally built Account/Network clients; useDappApprovalWindow, useDappHostname, useToast.
- `windows/capabilities`: Profile, DappInteraction; useDappApprovalWindow, useDappHostname, useNetworkActivation.
- `windows/discover`: Profile, DappInteraction; `windows/verify`: Network, DappSession, Account (no approval-window composable); `windows/json`: Profile, DappInteraction; `windows/logger`: Profile; `windows/passkey`: Passkey.
- `pages/settings/**`: Config x7, AccountState x4, Profile, Account, managers.{profile,network,account}. `components/popups`: Fpc, Contact, Token, TokenBalance, Task, Profile, managers.network. `modules/general`: Price x5, TokenBalance, Task, OperationJournal, Config, Transaction, Token.
- Shared composables: `useDappApprovalWindow` (133 LOC) and `useDappInteractionPayload` (used by execute/capabilities/discover).

## 5. Frameworks
Vue 3 `<script setup>` (mix of JS and `lang="ts"`; popups/ mostly plain JS), vue-router (unplugin-vue-router `~pages`, `<route lang="json">`), Pinia, CSS modules (`<style module>`), SCSS for index, unplugin auto-imports + vue-components (design resolver for `@nulo/design`), Vite. ServiceClient RPC over chrome ports.

## 6. Test surfaces
132 colocated `*.test.ts` (vitest on Bun). Notable: `route-guard`, `auth-guard`, `boot-session`, `reconcile-locked-boot`, `scope-epoch`, `lock-landing`, `incoming-row-parity.test.ts`, `pages/send.integration.test.ts`, `windows/execute/OperationCard.*.test.ts` (7 variants), `windows/execute/scope-follow*.test.ts`, `windows/capabilities/{reentrancy,chain-switch,chain-mismatch}`, `modules/fee-cards.comount.test.ts`, `NewNetworkPopup.pins.test.ts`. Popups with NO test: AccountsPopup, DataViewerPopup, EditEndpoint/EditNetwork, ForgotPassword, ReceivePopup, SelectFpc, SelectNetworks. Windows w/o tests: json, logger, passkey. Untested large pages: import.vue? (import.test exists), export/full.vue, account.vue, appearance, most settings pages. e2e in `apps/extension/tests/e2e` (testid-only selectors).

## 7. Exclude
No generated code under popup/. Generated elsewhere in extension: `src/types/auto-imports.d.ts`, `src/types/components.d.ts`. Exclude `*.test.ts`, `incoming-row-parity.test.ts`; `constants/storage-keys.ts` is constants. `windows/passkey/index.vue` is reachable but documented as unused.

## 8. Similarity candidates (leads: `raw/jscpd-production.md`)
Script logic
- `components/popups/NewContactPopup.vue` (186) vs `EditContactPopup.vue` (245): jscpd 35 lines JS; my diff of the two script blocks still ~135 differing lines, so shared part = validation/address-resolve/name-uniqueness form state. Also EditContact 27 lines overlap with `pages/send.vue:192-212` (recipient resolve logic). Same New/Edit pairing for Account (146/111), Endpoint (127/139), Fpc (177/297), Network (197/143), plus NewSender, EditProfile: a generic `New*/Edit*` form-popup shell (show/close/submit/busy/error/toast) is repeated 7x.
- ConfirmPopup-shaped: `ConfirmPopup.vue:10-30` overlaps `ImportContactsPopup.vue:15-27`, `IncomingTrustPopup.vue:37-46`, `SelectNetworksPopup.vue:6-16` (props/emit/close boilerplate); `NewAccountPopup.vue:12-27` == `NewSenderPopup.vue:12-27`; `RevokeAuthwitsPopup.vue:26-43` == `ChangeAuthwitsRegistryPopup.vue:24-41`. Also `ConfirmPopup.css:186-203` == `IncomingTrustPopup.css:229-242`.
- Approval windows script setup: `windows/capabilities/index.vue:133-154` == `windows/discover/index.vue:65-87` (22 lines: `useDappInteractionPayload` + `useDappApprovalWindow` wiring); `capabilities:121-140` == `execute/index.vue:179-198` (20 lines: dispose/disconnectServices/guard thunks); `composables/useDappApprovalWindow.ts:100-115` == `windows/verify/index.vue:116-132` (verify hand-rolls the shell behaviour instead of using the composable). `windows/json` and `windows/logger` also each build Profile/DappInteraction clients. Semantic: all four windows repeat request-id read, cancelled-flag, reject-on-beforeunload, resolve/reject/complete trio; `execute/index.vue:331-365` has two 18-line near-identical blocks.
- Detail pages: `pages/tx/[id].vue` vs `received/[id].vue` vs `journal/[id].vue`: same Token/Config/Price client triple, same fiat-amount formatting, scope checks, copy-hash/row layout; `received-copy.ts` and `journal-detail-scope.ts` are parallel helpers. `modules/tx/{TxFeeRow,TxDebugPanel}` shared only partly (css 17 lines dup between them).
- `pages/settings/advanced/index.vue:108-124` == `settings/appearance.vue:105-121` (JS: Config get/set toggle pattern); many settings pages repeat load-config/set-config/toast.
- Likely semantic dupes jscpd misses: `TokensView` vs `RecentActivityView` vs `BalanceView` (polling/ticker/price/balance-store subscriptions and list empty/loading states; css dup 17 lines TokensView:526-542 == RecentActivityView:886-902); `SelectTokenCard` vs `SelectTokenPopup` vs `TokenList`; `SelectProfilePopup`/`SelectNetworksPopup`/`SelectFpcPopup`/`AccountsPopup` picker-list popups; `RecipientField.vue` vs `SelectFpcPopup.vue` (css 23 lines 200-222); `SendReviewSheet` vs `OperationCard` (fee/amount rows).
CSS (biggest wins)
- `pages/received/[id].vue` css 349-375, 376-394, 403-437, 441-462 == `pages/tx/[id].vue` css 370-396, 400-418, 443-477, 473-494 (~100 lines; `<style>` diff between the two is only ~106 lines total out of ~190 each). Fold into `detail-page.module.css`.
- Row/card CSS: `ContactRow.vue:62-102` == `connected-apps/index.vue:176-216` (41 lines), also :119-139 == :229-249, and `ContactRow` vs `AccountSelectRow` 19 lines; `AuthwitCard.vue:75-158` == `account-state/notes/index.vue:276-383` (~75 lines across 3 blocks); `account-state/authwits/index.vue:204-226` == `connected-apps/[id].vue:365-387` == `tokens/[id].vue:296-315` == `settings/contacts/index.vue:205-222` == `connected-apps/index.vue:295-315` (same footer/empty block repeated 5x).
- Secret flows: `change-password.vue:277-336` == `SecretCountdownClose` / `SecretUnlockSection` / `import-shared.module.css` / `export/full.vue:712-732` / `reset.vue:228-242` (css copy-paste of unlock/countdown sections).
- `windows/execute/CallArguments.vue:149-167` == `OperationCard.vue:582-600`. `SettingField`/`SettingValue` (outside popup) 42 lines css + 18 js.

## 9. For the bugs audit: async state, lifecycles, timers, error paths
- Service-client lifecycle: clients are `new`ed in component scope; cleanup convention is parent `onBeforeUnmount` disconnect (CLAUDE.md order). 66 .vue files touch listeners/timers/unmount. Highest risk: `app.vue` (only file in popup with setInterval; boot + many clients + subscriptions), `PopupManager.vue` (IncomingTransferService subscription + module-level queue, dequeue/scope race: `payloadMatchesLiveTriple`), `pages/send.vue` + `send-submit.ts` + `send-balance-events.ts` (865 LOC; 6 clients, fee estimation timers via `useFeeEstimation`, legal gate, submit/journal), `FeeSettingsCard.vue` (823 script lines), `RecentActivityView.vue` (783 script lines; 2 setTimeout/interval; activity+journal+price), `TokensView`/`BalanceView` (2 timers each, price/balance polling), `SendReviewSheet`.
- Approval windows (error-path heavy, reject-on-unload semantics): `windows/execute/index.vue` (clients constructed lazily per op: Account/Network disconnect must run on every exit path (B-30 comment); ops loop; `scope-follow.ts`/`scope-mismatch.ts` race with active-account changes), `windows/capabilities/index.vue` (reentrancy, chain-switch, `useNetworkActivation`), `windows/discover`, `windows/verify` (hand-rolled, no composable: check double-resolve/reject, `dappSessionService` disconnect at line ~171), `windows/passkey` (AbortSignal on unmount, dead path), `composables/useDappApprovalWindow.ts` + `useDappInteractionPayload`.
- Boot/auth: `boot-session.ts`, `reconcile-locked-boot.ts`, `apply-boot-outcome.ts`, `profile-bootstrap.ts`, `scope-epoch.ts`, `lock-landing.ts`, `route-guard.ts` (isLogined lag, unlock race), `pages/auth.vue` (451; password/passkey ceremony, managers.profile x4), `pages/import.vue`, `pages/profile/new.vue`, `settings/accounts/import.vue`.
- Secret-handling timers: `export/{seed,account,full}.vue` (full.vue 733 LOC: countdown, reveal/clear, backup build progress), `change-password.vue`, `reset.vue` (countdown/clear-on-unmount of secrets in refs).
- Other: `ImportContactsPopup` + `useContactImportExport.ts` (hostile file input), `NewTokenPopup` (345; chain metadata, registration), `RevokeAuthwitsPopup` (344), `account-state/notes/index.vue` (438), `network-switch.ts`, `NewNetworkPopup` (pins test suggests sensitive validation).
