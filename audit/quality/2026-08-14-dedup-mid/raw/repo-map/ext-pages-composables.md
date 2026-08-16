# Repo map — popup/pages + composables + stores

Scope: `apps/extension/src/popup/pages/**`, `apps/extension/src/composables/**`, `apps/extension/src/stores/**`. `*.test.ts` excluded. 37 pages, 27 composables (incl. `.js`/`.d.ts`), 6 stores. Total page LOC ≈12.8k.

## 1. Page inventory (LOC, purpose; **bold** = >300 LOC)

| Path | LOC | Purpose |
|---|---|---|
| `popup/pages/[...catch].vue` | 6 | 404 catch-all redirect |
| `popup/pages/index.vue` | 6 | root redirect |
| `popup/pages/general.vue` | 45 | top settings entry redirect shim |
| `popup/pages/settings/advanced/account-state/index.vue` | 72 | account-state hub links |
| `popup/pages/settings/security/export/index.vue` | 77 | export method picker |
| `popup/pages/settings/profile/index.vue` | 87 | profile list |
| `popup/pages/settings/networks/index.vue` | 98 | network list |
| `popup/pages/settings/about.vue` | 110 | app version/about |
| `popup/pages/register.vue` | 161 | onboarding entry (create/import) |
| `popup/pages/settings/tokens/index.vue` | 161 | token registry manage |
| `popup/pages/settings/fpcs/index.vue` | 172 | FPC registry manage |
| `popup/pages/settings/advanced/account-state/contracts/index.vue` | 188 | registered contracts view |
| `popup/pages/settings/accounts/index.vue` | 199 | profile accounts list |
| `popup/pages/settings/security/export/seed.vue` | 221 | seed-phrase reveal |
| `popup/pages/settings/advanced/account-state/senders/index.vue` | 227 | registered senders view |
| `popup/pages/settings/security/index.vue` | 241 | security hub |
| `popup/pages/settings/index.vue` | 245 | settings root menu |
| `popup/pages/tokens/[id].vue` | 265 | token detail |
| `popup/pages/settings/contacts/index.vue` | 271 | contacts manage |
| `popup/pages/settings/advanced/account-state/authwits/index.vue` | 275 | authwits view |
| `popup/pages/settings/security/export/key.vue` | 290 | private-key reveal |
| `popup/pages/settings/advanced/index.vue` | 300 | advanced settings hub |
| **`popup/pages/profile/new.vue`** | 305 | new-profile flow |
| **`popup/pages/activity.vue`** | 308 | tx activity feed |
| **`popup/pages/settings/networks/[id].vue`** | 315 | network detail/edit |
| **`popup/pages/settings/appearance.vue`** | 335 | theme/appearance settings |
| **`popup/pages/settings/connected-apps/[id].vue`** | 348 | dapp connection detail |
| **`popup/pages/settings/security/reset.vue`** | 354 | wallet reset flow |
| **`popup/pages/settings/connected-apps/index.vue`** | 360 | connected dapps list |
| **`popup/pages/auth.vue`** | 376 | unlock/auth screen |
| **`popup/pages/settings/security/change-password.vue`** | 448 | password change |
| **`popup/pages/import.vue`** | 484 | seed/backup import flow |
| **`popup/pages/journal/[id].vue`** | 492 | dapp interaction journal detail |
| **`popup/pages/settings/advanced/account-state/notes/index.vue`** | 497 | notes view |
| **`popup/pages/settings/security/export/full.vue`** | 508 | full-backup export |
| **`popup/pages/received/[id].vue`** | 558 | incoming-transfer detail |
| **`popup/pages/tx/[id].vue`** | 594 | tx detail |
| **`popup/pages/send.vue`** | 691 | send flow |

16/37 pages exceed 300 LOC (43%), concentrated in detail/flow pages (`send`, `tx/[id]`, `received/[id]`, `import`, `journal/[id]`, export/reset/change-password).

## 2. Composable inventory (C0 pure vs C1 service-bound)

| File | LOC | Class | Notes |
|---|---|---|---|
| `syncedRef.d.ts` | 3 | C0 | type decl |
| `toast.d.ts` | 4 | C0 | type decl |
| `outside.js` | 5 | C0 | click-outside directive util |
| `toast.js` | 5 | C0 | toast trigger util |
| `useDappHostname.ts` | 28 | C0 | pure hostname parse |
| `syncedRef.js` | 35 | C0* | storage-synced ref; touches `chrome.storage` but CLAUDE.md names it as the canonical C0 example |
| `ticker.ts` | 38 | C0 | interval tick ref |
| `fullscreenPopupSetting.ts` | 44 | C1 (deviant) | instantiates + disconnects its own `ConfigServiceClient` — violates the "parent owns connect/disconnect" C1 rule |
| `waitForProfileActive.ts` | 47 | C0 | pure polling helper |
| `usePopupEntity.ts` | 48 | C1 | receives connected client from parent |
| `useSecretCountdown.ts` | 60 | C0 | pure countdown timer |
| `notification.js` | 65 | C0 | notification formatting |
| `usePasskeyCeremony.ts` | 65 | C0 | pure ceremony state machine |
| `completeImportWithRecovery.ts` | 67 | C0 | pure orchestration, injected fns |
| `importPreflight.ts` | 81 | C0 | pure orchestration over injected probe fn |
| `usePrices.ts` | 98 | C1 | takes `PriceServiceClient` param |
| `importChainSync.ts` | 110 | C0 | pure orchestration, type-only imports |
| `useProfileBootstrap.ts` | 121 | C1 (deviant) | instantiates own `NetworkServiceClient`/`AccountServiceClient` internally |
| `useDappInteractionPayload.ts` | 129 | C1 | takes `DappInteractionServiceClient` slice |
| `useEntityCrud.ts` | 135 | C0 | generic CRUD helper, no client import |
| `useProfileCreateFlow.ts` | 138 | C0 | pure flow state |
| `useDappApprovalWindow.ts` | 140 | C1 | uses `chrome.windows.*` |
| `useFeeEstimation.ts` | 148 | C0 | pure fee-calc helper |
| `useIncomingTransfers.ts` | 151 | C1 | takes 3 ServiceClient slices |
| `useFeeEstimationMap.ts` | 169 | C0 | pure map variant of above |
| `useProfileNameField.ts` | 181 | C0 | self-documents as C0 in header comment |
| `useFormState.ts` | 234 | C0 | generic form-state helper |
| `useProfileImportFlow.ts` | 322 | C0 | pure flow state (large) |
| `useFullBackupImport.ts` | 774 | C1 | wires 6+ ServiceClients directly (largest composable by far) |

## 3. Store inventory

| Store | LOC | Purpose |
|---|---|---|
| `popup.store.ts` | 34 | popup route/UI open-state |
| `notification.store.ts` | 53 | in-app notification queue |
| `cache.store.ts` | 62 | ephemeral cross-page transfer/popup payloads |
| `activity.store.ts` | 315 | per-scope (account+network) tx activity slices |
| `app.store.ts` | 435 | active account/network/profile identity source of truth |
| `balances.store.ts` | 637 | single owner of fee-juice balance + FPC-list fetch (doc states it replaced duplicated logic previously split across `FeeSettingsCard`/`GasBalanceCard`) |

## 4. Duplication candidates (this audit's focus)

**A. Settings-page shell (`SubPageHeader` + back-to-settings)** — 27 pages import `SubPageHeader`; 11 use the literal identical prop pair `title="..." :backTo="'/popup/settings'"`: `settings/about.vue:36`, `settings/contacts/index.vue:154`, `settings/security/index.vue`, `settings/tokens/index.vue:65`, `settings/accounts/index.vue`, `settings/fpcs/index.vue:119`, `settings/profile/index.vue`, `settings/advanced/index.vue`, `settings/connected-apps/index.vue`, `settings/appearance.vue:165`, `settings/networks/index.vue`. Same `<Flex direction="column" gap="…" :class="$style.content">` body wrapper immediately follows in each. Candidate for a `SettingsSubPage` shell component.

**B. Copy-to-clipboard + toast handler** — near-identical 3-line handler repeated 8x with only the toast label/argument order varying: `settings/about.vue:19-22` (`handleCopy`), `settings/accounts/index.vue:60-63` (`handleCopyAddress`), `settings/contacts/index.vue:121-124` (`handleCopyContactAddress`), `settings/fpcs/index.vue:70-73` (`handleCopyAddress`), `settings/connected-apps/[id].vue:131-134` (`handleCopyAddress`), `tokens/[id].vue:101-104` (`handleCopy`), `tx/[id].vue:106-109` (`handleCopy`), `settings/advanced/account-state/senders/index.vue:48-51`. All do `window.navigator.clipboard.writeText(x); openToast({ label: ..., icon: "copy" })`. `received/[id].vue:140-144` is the one outlier (async/try-catch with failure toast). Strong candidate for a shared `useClipboardCopy(labelFn)` composable — none currently exists despite `useToast`/`openToast` already being centralized.

**C. Clipboard-scrub secret export blocks are near-verbatim duplicates** — `settings/security/export/key.vue:75-119` and `settings/security/export/seed.vue:65-109` share byte-for-byte identical `CLIPBOARD_CLEAR_MS = 60_000`, the same multi-line "F-14" rationale comment, the same `clipboardClearTimer` scrub-on-timeout logic, and the same `onBeforeUnmount` non-clear rationale comment. Only the copied value (`privateKey`/`publicKey` vs `phrase`) differs. Highest-value extraction target in this set (security-sensitive logic duplicated, not just boilerplate).

**D. Account-state subpage lifecycle + identity-scope watcher** — the four `settings/advanced/account-state/{authwits,senders,notes,contracts}/index.vue` pages each repeat the same triad: (1) `watch(() => appStore.account, () => refetchFn())` (or `.network` for senders) at `authwits/index.vue:103-109`, `senders/index.vue:72-77`, `notes/index.vue:184-189`, `contracts/index.vue:45-50`; (2) an `onMounted` guard `if (appStore.network && appStore.isLogined) fetchX()` at `notes/index.vue:192`, `contracts/index.vue:53` (authwits/senders use a variant of the same guard inline); (3) `onBeforeUnmount(() => xClientService.disconnect())`. Candidate for a shared `useAccountScopedFetch(fetchFn, { onNetworkChange? })` composable.

**E. Multi-client connect/disconnect wiring repeated per page** — pages instantiating 2+ `new XServiceClient()` and disconnecting each individually in `onBeforeUnmount`: `activity.vue` (6 clients, `.disconnect()` x7), `send.vue` (5 clients, x5), `received/[id].vue` (5, x5), `journal/[id].vue` (4, x4), `tx/[id].vue` (3, x3), `settings/connected-apps/[id].vue` (3), `settings/contacts/index.vue`/`tokens/[id].vue`/`settings/security/index.vue` (2 each). No shared "own N service clients, tear down together" helper exists; each page hand-writes its own disconnect list, risking the ordering bug class CLAUDE.md's `onBeforeUnmount` rule already warns about for composables.

**F. `formatFeeJuice(BigInt(...))` call shape repeated** — `received/[id].vue:135` and `tx/[id].vue:113,120` each wrap a possibly-undefined raw fee in an identical `computed(() => (x.value ? formatFeeJuice(BigInt(x.value)) : null))` guard; minor but a 3rd near-duplicate in `tx/[id].vue` alone.
