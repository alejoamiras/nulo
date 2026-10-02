# Addendum: quality-run incidental leads, `/harden bugs` (high), extension, 2026-09-30

Input: `audit/quality/2026-09-30-dedup-high/findings/consolidated.md` § "Incidental bugs (for the bugs run)", 39 leads. The quality file numbers them `B-01`…`B-39`; they are cited here as **QB-NN** so they cannot be confused with this run's `B-NN` findings. Base: `dev` @ `910a4def`. Every lead not already settled by `consolidated.md` was re-opened in source. The owner's "realistic scenarios only" rule applies throughout.

**Tally:** 4 covered by a B-NN finding · 1 already routed · 18 already dropped · 14 newly dropped · 2 new findings (B-21, B-22). A third new finding (B-23) was found while checking QB-21. It is not one of the 39 leads.

## Disposition of every lead

| QB | Lead (short) | Disposition |
|---|---|---|
| QB-01 | `OperationEstimateReuse.tryConsume` uncaught fee read | covered by B-08 |
| QB-02 | `updateFpcAddress` stale snapshot | covered by B-15 |
| QB-03 | `patchAccountField` accepts a transplanted row | already routed (bugs Routed-to-security #1). The chain-purge race on the same writer is B-12(b). |
| QB-04 | `exportMnemonic` legacy error string | already dropped (D-04: nothing matches on the type) |
| QB-05 | `changeProfileName` on a tombstoned-but-present row | **DROP.** Already pinned as intended by `(BUG PIN)` at `apps/extension/src/wallet/services/profile/service.integration.test.ts:3097`. It needs a crash between tombstone and row delete, and the profile is then hidden from every read, so no UI can offer to rename it. |
| QB-06 | note arm has no epoch re-check before `resolveNoteTrust` | already dropped (D-06: runs under the service lock, no destructive interleaving shown) |
| QB-07 | `parseNoteAmount` accepts negatives | already dropped (D-07: u128 input, unreachable) |
| QB-08 | `getNodeStatus` omits `network.kind` | covered by B-09 |
| QB-09 | `setActiveNetwork` with no matching primary endpoint | already dropped (D-08: no normal writer produces the row) |
| QB-10 | `BalanceView` Added without dedupe | already dropped (D-09: the Added emitter sends zero balances) |
| QB-11 | `RecentActivityView` connects ports after an unmount during `scopedTokens.reload()` | **DROP.** Mechanism confirmed (`RecentActivityView.vue:740-760`, and `ServiceClient.connect` reopens a disconnected port, `packages/extension-messaging/src/background/client.ts:63`). The effect is two ports and their listeners leaked until the popup document closes. The background keeps no port-count state (no `onConnect` bookkeeping beyond routing), and the late handlers only write refs of a dead component. No observable wrong result. This is a quality/lifecycle item. |
| QB-12 | `RevokeAuthwitsPopup` `feeSetting` typo | already dropped (D-10) |
| QB-13 | `SelectFpcPopup` double client on show/hide/show | **DROP: dead code.** Nothing opens `select_fpc`: no `popupStore.open("select_fpc")` exists, and the only references are the popup itself and its `PopupManager.vue:342` mount. |
| QB-14 | json/logger windows skip `onClose` on hash-router unmount | **DROP.** The only navigation away from a window route is the lock landing (`popup/locked-state.ts:31`). On that same lock event, the window's own still-connected profile listener closes the window (`popup/windows/json/index.vue:17-23`, `popup/windows/logger/index.vue:13-19`), and document unload then reclaims every port. |
| QB-15 | Developer Mode off leaves `debugMode` on after a failed write | covered by B-14(b) |
| QB-16 | `full.vue:375` filename sanitisation | already dropped (D-11) |
| QB-17 | passkey Encrypt with empty password gives no feedback | already dropped (D-12: intentional transition) |
| QB-18 | `connected-apps/[id].vue` `fetchAccounts` clients never disconnected | **DROP.** Up to two ports leak per visit, with no listeners attached, and they are freed when the popup closes. No wrong result; the same reasoning as QB-11 and D-03. It remains a quality item (client ownership). |
| QB-19 | `activateCreatedProfile` waits for `isLogined` forever | **NEW → B-21** |
| QB-20 | `SecretUnlockSection` global classes | already dropped (D-13) |
| QB-21 | `AddressDisplay` ignores `address` prop changes | **NEW → B-22.** The coordinator's check of its consumers also found B-23. |
| QB-22 | `LogsViewer` editor prune condition never true | **DROP.** Mechanism confirmed: `logs` is trimmed to `max+1` before `filteredLogs.length > max+100` is read (`LogsViewer.vue:56-64`), so the CodeMirror document grows with the window's lifetime. It happens only in the Developer-Mode log window, CodeMirror handles large documents, and the editor shows *more* history than the buffer, not wrong history. Same class as D-03. |
| QB-23 | `LogsViewer.handleClearLogs` rejection leaves `onLogAdded` removed | **DROP.** It needs `clearLogs` to reject (a worker restart mid-click) inside a Developer-Mode-only window. The user sees the "Failed to clear logs" toast, and reopening the window restores the stream. No data or state is affected. |
| QB-24 | `LogsViewer` document listeners survive unmount | **DROP.** The sole consumer is the logger window (`popup/windows/logger/index.vue:54`), and its document dies with the component (see QB-14). |
| QB-25 | `LogsViewer.fetchLogs` 500 ms race | already dropped (D-03) |
| QB-26 | onboarding applies `"system"` theme without reading config | **DROP.** Onboarding runs before a user can reach Settings → theme, and after completion it redirects at mount (`onboarding/app.vue:53-57`). The only residue is a stale localStorage paint hint, which makes the next popup paint briefly in the OS theme until `popup/app.vue` applies and re-persists the configured theme. That is a cosmetic flash, not a correctness bug. |
| QB-27 | History `incomingRows` lacks `isForeignProfile` | already dropped (D-14) |
| QB-28 | `mint_to_commitment` titled "Mint" | already dropped (D-15) |
| QB-29 | `useDappApprovalWindow` re-adds `beforeunload` after dispose | **DROP.** A mid-`init()` unmount only happens on the lock landing. On that lock, `onActiveProfileChanged(undefined)` has already called `options.reject()` (`useDappApprovalWindow.ts:95-97`), so the stale listener's later `reject()` targets an interaction that is already settled. No second outcome reaches the dApp. The first-close classification problem is B-07. |
| QB-30 | `EventHandler.invoke` iterates the live array, so a removal during dispatch skips the next listener | **DROP (latent).** The mechanism is real (`packages/wallet-core/src/utils/event-handler.ts:40-48`). Every production `.remove()` was traced. The only one that runs during its own dispatch is `NewTokenPopup.vue:119-128` (`onTaskUpdated` → `resolveOutcome` → `cleanup`), and it is the sole listener on its per-component `TaskServiceClient`, so no sibling exists to skip. `SendCheck.stop` and the client `unsubscribe` closures run outside dispatch. A snapshot copy in `invoke` is a cheap hardening for the quality run. |
| QB-31 | batch ban omits `grantPublicAuthwit` | already dropped (D-16). The quality run already routed it to security. |
| QB-32 | `queued-journal.ts:143` has no chain filter | already dropped (D-17) |
| QB-33 | third-party-notices collector keeps a removed stylesheet on watch rebuild | **DROP.** Only `dev:firefox` uses `vite build --watch` (`apps/extension/package.json:17`). Release artifacts come from one-shot builds, which start with an empty collector, so a shipped notices file cannot carry the stale entry. |
| QB-34 | design `Popover` leaves listeners when unmounted open | **DROP.** The sole consumer is `components/JsonViewer/LogsToolbar.vue:36`, inside the logger window, whose document dies with it (QB-14). |
| QB-35 | design `AddressDisplay` copy timer | already dropped (D-18: dead component) |
| QB-36 | light-theme hairline colour | already dropped (D-19: visual) |
| QB-37 | `integrity.ts` dead base64 catch | already dropped (D-20: fails closed) |
| QB-38 | UI-surfaced errors extend plain `Error` | already dropped (D-05) |
| QB-39 | console-sniffer replays buffered lines at the next call's level | **DROP.** Mechanism confirmed (`apps/extension/src/utils/console-sniffer.ts:11-24`). The buffering window is only the synchronous module evaluation between the sniffer import and hook install, which is the first statement of `popup/index.ts:3`, `onboarding/index.ts:10` and `wallet/index.ts:68-73`. The message is still captured and only its level can be wrong. That is a diagnostic-fidelity issue with no user-facing effect. |

---

## New findings

### B-21: [Minor] Popup profile creation waits for `isLogined` with no failure exit or timeout, so a failed bootstrap leaves "Creating…" spinning forever

- **Type:** bad error path (hang)
- **Confidence:** high on mechanism, moderate on likelihood
- **Found by:** quality-run incidental (QB-19; q07-codex, claude confirmed)
- **RECURRING?** Sibling asymmetry, the same family as the cross-cutting table. The unlock path's `awaitProfileActivation` (`apps/extension/src/composables/unlockWait.ts:32-60`) is bounded, identity-aware, and released by `appStore.bootstrapFailure`. The create path spins on `isLogined` alone.
- **Counter-example:**
  1. The user creates a profile from the popup (`/popup/profile/new`). `createProfile` resolves, and `useProfileCreateFlow` awaits `onCreated` with `isCreating` true.
  2. `activateCreatedProfile` loops on `while (!appStore.isLogined) await sleep(100)`.
  3. `app.vue`'s activation handler runs `bootstrapActiveProfile` for the new profile. It throws, for example because a worker restart rejects an in-flight bootstrap RPC with the port-disconnect error, or because `ensureDefaultAccount`/`getOrInitNetworks` fails. `runFencedBootstrap` records `bootstrapFailure = {profileId, message}` and toasts "Something went wrong", but `isLogined` never flips.
  4. The loop never exits. The button stays on "Creating…" and the page accepts no further action. The polling continues after the page unmounts, until the popup closes.
- **Violated invariant:** Activation waits are bounded and join the recorded bootstrap failure, and "a definitive rejection must release the waiter immediately" (`unlockWait.ts` doc). The create flow must end in success or a surfaced failure.
- **Failing path:** `apps/extension/src/popup/pages/profile/new.vue:66` → `apps/extension/src/popup/pages/profile/new-profile-helpers.ts:25-27` (unbounded loop) while `apps/extension/src/popup/app.vue:199-214` → `apps/extension/src/popup/profile-bootstrap.ts:23-26` records the failure that nothing on this path reads; the latch is at `apps/extension/src/composables/useProfileCreateFlow.ts:103-104`.
- **Expected vs actual:** Expected: the wait rejects on the recorded failure (or a timeout), `isCreating` resets, and the user gets a retry or recovery path. Actual: a permanent spinner. Only closing the popup recovers, after which the boot path shows the failed-boot banner.
- **Recommended fix:** Replace the loop with `await awaitProfileActivation(appStore, profile.id, <bound>)`, and on `BootstrapFailedError`/`UnlockTimeoutError` reset `isCreating` and surface the error. This reuses the existing helper.
- **Effort:** S
- **Instances:** `apps/extension/src/popup/pages/profile/new-profile-helpers.ts:25-27`. Onboarding is unaffected because it calls `useProfileBootstrap` directly.
- **Source raw ids:** quality q07-codex (QB-19).

### B-22: [Minor] `AddressDisplay` renders its address and contact name only at mount, so an unkeyed list shows the wrong addresses after a search filter

- **Type:** wrong result (display)
- **Confidence:** high
- **Found by:** quality-run incidental (QB-21; q08-codex). The coordinator supplied the reachable consumer.
- **RECURRING?** No.
- **Counter-example:**
  1. Settings → Advanced → Account state → Contracts lists contracts `[C1, C2, C3]`.
  2. The user types a fragment that matches only `C3`. `filteredContracts` becomes `[C3]`.
  3. The `v-for` at `contracts/index.vue:77` has no `:key`, so Vue patches row 0 in place: its `AddressDisplay` receives `address = C3`, but `displayedAddress` was set once in `onMounted` and still reads `trimAddress(C1)`.
  4. The search result shows C1's address as the match for C3. With two matches `[C2, C3]` it shows C1 and C2. In general a search shows the first *k* addresses of the full list rather than the *k* matches. Contact-name resolution (`@name`) is equally stale.
- **Violated invariant:** A presentational component renders its current props. `AddressDisplay` derives both `displayedAddress` and `contactName` from `props.address` only inside `onMounted` (`components/AddressDisplay.vue:68-90`), with no `watch`.
- **Failing path:** `apps/extension/src/popup/pages/settings/advanced/account-state/contracts/index.vue:27-29,68,77,83` → `apps/extension/src/components/AddressDisplay.vue:68-90`.
- **Expected vs actual:** Expected: each row shows the address it is bound to. Actual: rows show addresses from the unfiltered list.
- **Recommended fix:** Derive `displayedAddress` as a `computed` over `props.address/full/formatter`, and resolve the contact name in a `watch(() => props.address, …, {immediate: true})` with a latest-wins guard. Also add `:key="contract"` on the contracts `v-for` (the senders list survives only because `useEntityCrud`'s resync toggles `isLoading` and remounts it; it should get `:key="sender"` too).
- **Effort:** S
- **Instances:** Component at `apps/extension/src/components/AddressDisplay.vue:68-90`. Confirmed consumer: `contracts/index.vue:77,83`. At-risk consumers with index-keyed lists in the approval window: `apps/extension/src/popup/windows/execute/OperationCard.vue:240-255` (discovered authwits, `:key="${index}:authwit:${k}"`) and `CallArguments.vue:75-84`. See the security routing below. B-23 is the page-level twin.
- **Source raw ids:** quality q08-codex (QB-21).

### B-23: [Minor] The received-transfer page loads only in `onMounted`, so the arrival snack's "View" on a receipt page keeps showing the previous receipt

- **Type:** wrong result (display)
- **Confidence:** high
- **Found by:** coordinator, while checking QB-21's consumers. This is not a quality-run lead.
- **RECURRING?** No.
- **Counter-example:**
  1. The user opens receipt A (`/popup/received/A`).
  2. Incoming transfer B arrives. `useArrivals.announcesOn` is true for every route except Home, History, auth entry and `windows-*` (`apps/extension/src/composables/useArrivals.ts:106-108`), so the receipt page gets the "Received … · View" snack.
  3. The user taps View, and `openReceipt` calls `router.push('/popup/received/B')` (`apps/extension/src/popup/app.vue:90`).
  4. Only the param changed, and `<RouterView>` renders `<component :is>` without a key (`app.vue:485-487`), so vue-router reuses the page instance. `onMounted` does not rerun and nothing watches `route.params.id`. The URL is B, but the amount, sender, token, block and fee all still show A.
- **Violated invariant:** A detail page shows the record its route names. The page's own loader keys on `route.params.id` (`received/[id].vue:145`), but only once.
- **Failing path:** `apps/extension/src/composables/useArrivals.ts:365` → `apps/extension/src/popup/app.vue:90,485-487` → `apps/extension/src/popup/pages/received/[id].vue:143-145` (mount-only load).
- **Expected vs actual:** Expected: receipt B. Actual: receipt A under B's URL. Tapping "View" appears to do nothing, or the user reads A's amount as B's. Back navigation and a fresh open recover.
- **Recommended fix:** Move the load into a function keyed by `route.params.id` and invoke it from `watch(() => route.params.id, load, {immediate: true})` with a latest-wins token (reset `received`, `loaded`, `feeJuiceRaw` and `deletedIds` per id). Alternatively, key this route's component by `route.params.id`.
- **Effort:** S
- **Instances:** `apps/extension/src/popup/pages/received/[id].vue:143-181`. `apps/extension/src/popup/pages/tx/[id].vue` has the same mount-only shape, but no current path navigates from one tx detail to another.
- **Source raw ids:** none (coordinator discovery).

---

## Additions to routed-to-security

1. **Approval-window address rendering under index-keyed lists.** `apps/extension/src/popup/windows/execute/OperationCard.vue:240-255` renders each discovered authwit's **Consumer** and **Authorizes** through `AddressDisplay` inside `v-for … :key="${index}:authwit:${k}"`. If a re-estimate (a fee-method or priority change re-runs `estimateWithDiscovery`) returns the discovered authwits in a different order or count for the same operation, the patched rows keep the previous consumer and caller text while `data-message-hash` and the function name update. The approval card would then name the wrong spender for an authwit the wallet signs. This is not proven reachable: it depends on whether discovery order or count can change across re-estimates of one operation. The fixes in B-22 (reactive `AddressDisplay`, key by `messageHash`) close it regardless. The anti-phishing display is a security property, hence the routing. (Coordinator, from QB-21.)
