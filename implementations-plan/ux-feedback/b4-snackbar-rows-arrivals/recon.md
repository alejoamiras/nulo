# Batch 4 recon · snackbar, rows, arrivals

Two read-only agents (Explore, sonnet), 2026-09-24: one reuse sweep across toasts, rows and incoming
transfers, and one mapper that classified every `openToast` call site. The base is
`feat/ux-1-first-run-wording` at `803da36d` (the reports named `fee6b4a2`; the plan audit
re-checked every citation at `803da36d`, and the citations are refreshed again once the arcs
below this one land). As far as their plans list, batches 2 and 3 touch
no file below except `BalanceView.vue` (batch 3 removes one comment and adds the split's icon
labels) and `settings/index.vue` (batch 3 adds the Glossary `SettingItem`). The driver's
own reads, which correct both reports, are in the last section.

The stack was later rebased onto dev `9f11de70`, which removed the tools app and the bridge
packages (#691; `@nulo/design`'s `Toast.vue` stays, with no consumer here) and moved the protocol
FPC derivation into `fpc/protocol-fpcs.ts` (#690). The plan's round 4 re-checked every citation
against the rebased tree: of the cited files, `components/ui/ToastManager.vue` and
`tests/e2e/fixtures/aztec.ts` changed in comments with no line moved, and `manifest.test.ts`'s
Firefox minimum moved to `:138-139`.

## Reuse map

| Capability | Existing (file:line) | Verdict |
|---|---|---|
| Toast state | `packages/design/src/composables/toast.ts:1-44`: a module singleton `toast` ref (`:23`), `TOAST_DURATION {SHORT 1_500, DEFAULT 2_000, LONG 4_000}`, `ToastOptions {label, icon?, color?}`; `openToast(t, duration = DEFAULT)` always arms a close timer (`:27-36`); `closeToast` (`:38-41`) | adapt in place: `kind` replaces `icon`/`color`, the `duration` argument goes, success arms 6 s and error arms nothing, and a hold pauses the timer and resumes the remainder |
| Toast view | `packages/design/src/ui/ToastManagerBase.vue` (105 lines): `<Transition name="toast">` around a teleport to `#toast` (`:31-52`); the whole card closes on click (`:37`); icon `toast.icon \|\| 'check-circle'` 14px (`:44`) plus a decorative close-circle 12px (`:46`); one nowrap uppercase label (`:83-92`); `position:absolute; top:12px; left:50%; translateX(-50%); z-index:2000` (`:55-63`); variants red/green/orange (`:22-28`, `:94-104`); no live region | adapt in place: the drawn snack (`nulo.css:189-197`, `:471-474`) at the bottom, two always-mounted live regions, real buttons, no click-to-close |
| Transition classes | `base.css:332-339` `.toast-enter-*` (`translateX(-50%) translateY(-20px)`, 0.15s `var(--bezier)`). `base.css` is hash-pinned (`packages/design/src/base.css.test.ts:22`) | build new: module classes bound through `enter-from-class` and friends; `base.css` untouched, and its `.toast-*` rules go dead but stay |
| Extension wrapper | `apps/extension/src/components/ui/ToastManager.vue` renders `<ToastManagerBase />` (host-coupled holdout, CLAUDE.md § L0–L6); stale "design-system round-2, D-SEAM" comment (`:2-5`) | adapt: passes the bottom inset from `route.meta.showBottomNav`, and the comment shrinks to why the wrapper exists |
| Composable shim | `apps/extension/src/composables/toast.js` + `.d.ts`: named re-exports with a "design-system round-2" comment | adapt: re-export the new names; the workflow comment goes |
| Bottom placement | `Navigation.vue:49-65` (absolute bottom, 64px, `bottom-nav`), shown by `v-if="$route.meta.showBottomNav"` (`popup/app.vue:442`); `--nav-clearance` 96px / 24px (`base.css:68-70`, `:79`) is page padding, not the drawn 76px; that rule keys on `:root[data-has-nav="true"]`, which the popup shell writes from the same route meta (`popup/app.vue:44-51`), so the design package already reads that attribute | reuse `route.meta.showBottomNav`; the inset is the drawn 76px (64 + 12), not the token |
| Transaction success copy | `popup/pages/send-submit.ts:59-61` "Transaction submitted", which drops the hash; `ExecutionService.executeTransfer` already returns `Promise<string>` (`wallet/services/execution/service.ts:469-485`; `transfer-executor.ts:206` returns `txHash.toString()`); `SubmitDeps.executeTransfer: Promise<unknown>` (`send-submit.ts:21-30`) | adapt: type it `string`, keep the hash, add the sub line and View |
| Amount and address formats | `utils/amount.ts:79` `balanceFormatted(units, decimals, length?)` (the incoming row's formatter, `TransactionIncomingCard.vue`); `utils/string.ts:11` `trimAddress(a, start = 8, end = 4, sep = "..")`; `trimAddress(a, 6, 4, "…")` gives "0x8c02…41fa" | reuse both |
| Send failure copy | `popup/utils/transfer-failure-copy.ts`: three constants | reuse as the error's sub line (owner ask S-9) |
| Detail routes for View | `/popup/tx/[id].vue:62` finds by hash in `appStore.transactions`; `/popup/received/[id].vue:147` `getIncomingTransferById(route.params.id)` | reuse |
| Row target | none that is both full-row and a real element: `TransactionCard.vue:157` `<div class="row">` with pointer and hover (`:210-218`), no tabindex, keys or role; `TokenCard.vue:70` `RouterLink` root (hover `:118-132`, no focus style); `SettingItem.vue:44-51` `router-link`/`a`/`div` with `tabindex` 0 (−1 when disabled, `:50`), a click-mode `div` with no key handler; `ContactRow.vue:19-80` and `connected-apps/index.vue:127-171` `role="button" tabindex="0"`, Enter only, nesting `span role="button"` actions (`ContactRow.vue:199-219`). Both of those navigate (`popup/pages/settings/contacts/index.vue:118-121` preselects the contact in the Pinia `cacheStore.preselectedContactToSend`, then pushes `/popup/send`; `connected-apps/index.vue:67-69` pushes the app's detail page), so item 11 makes them links. Searched `role="button"`, `tabindex`, `@keydown.enter` in `apps/extension/src` | build new `components/ui/RowTarget.vue` (L2, local and host-coupled like `Button.vue`: it renders `RouterLink custom`, `Button.vue:34-53`): a stretched real `<a>` or `<button>` over the row that is the hit surface, so nested controls stay siblings above it |
| Row inner buttons | bare `<Icon @click.stop>` (14-16px, not focusable): `FpcRow.vue:31-79`, `AccountsPopup.vue:74-98`, `settings/accounts/index.vue:83-157`, `settings/tokens/index.vue:82-101`, `settings/networks/[id].vue:209-232` (`endpoint-edit-btn`, `endpoint-delete-btn`), `AuthwitCard.vue:15-28` (revoke hidden until hover); `TransactionAwaitingCard.vue:173-197` real buttons, 16×28, under a comment saying the 16px width was user-tuned | build new `RowAction` (L2, router-free, so in `@nulo/design/ui` behind the resolver): a 24×24 `<button>` with an `aria-label`; the awaiting buttons grow to 24×28 |
| Row focus ring | none drawn in code: every row focus is tint-only or absent (`SettingItem.vue:108-173`: focus-visible = surface-high, no outline) | build: the mock's ring (`nulo.css:243-244`) on the row through `:has(:focus-visible)` |
| Arrival seen marker | none (searched `seen`, `lastSeen`, `watermark`, `incomingSeen`). Precedent for a per-profile UI key: `pinnedTokensKey = nulo:ui:pinnedTokens@${profileId}` (`popup/constants/storage-keys.ts:9`), read through `@/utils/storage`. The incoming service's repository holds four EntityStorage tables keyed by profile, network and contract or account, all purged under the service lock (`incoming-transfer/repository.ts:1-60`) | build new (round 2): a fifth table in that repository plus an optional floor on the trust row, a pure `arrival-state.ts` shared with the popup, and a C1 coordinator; not a UI key, which could not share the service's lock with its purges |
| Live receipt feed | `composables/useIncomingTransfers.ts`: `onAdded` unshifts the raw record (`:92-97`); `refresh` with a sequence guard (`:71-81`); `onQuotesUpdated` refreshes; `dispose` (`:137-148`). Mounted by `RecentActivityView.vue:246` and `popup/pages/activity.vue:63`. `RecentActivityView` also renders on the token page (`tokens/[id].vue:279`) and shows only its row budget (`RecentActivityView.vue:97-118`) | adapt: on Added, one coalesced refresh of the filtered list; never render the raw event |
| Cross-document lock | `navigator.locks.request(...)` in `popup/windows/execute/scope-follow.ts:47`; the incoming service's own `withServiceLock` plus `serviceEpoch` fence (`service.ts:250`, `:1201-1211`) | reuse the service lock (round 2): claims go through the service, which every document already calls, so no Web Lock is needed |
| Chain position | none reachable from the popup (`incoming-transfer/client.ts:36-48`); the public scan's tips are checkpointed (`packages/aztec-runtime/src/pxe/public-events.ts:393-406`); the node's untagged `getBlockNumber()` is the latest proposed block (`@aztec/stdlib` 5.2.0 `dest/interfaces/aztec-node.d.ts:143-146`) | build new: a PXE service method `getLatestBlockNumber`, where `getPublicScanTips` lives in `packages/aztec-runtime/src/pxe/` (`spec.ts:100`, `descriptors.ts:64` with `descriptors.test.ts`' 25-method pin and SW-only list, `service.ts:101`, `:686-687`, `client.ts:356-357`), read by the incoming service through its `PublicEventReader` (`public-event-indexer.ts:26-30`; the adapter at `incoming-transfer/service.ts:272-287`, which tests replace), fresh on every use |
| Display sanitizer | `sanitizeWireString(input, maxLen)` and `stripWireControl` (`wallet/services/dapp-session/capability-meta.ts:170-181`), already imported by UI (`utils/clipboard.ts:1`, `tokens/[id].vue`, `IncomingTrustPopup.vue`) | reuse for the token symbol on the snack and chip |
| Count-up | none in the app (only `LogsViewer.vue:117` and `useProfileNameField.ts:121` use `requestAnimationFrame`, for scrolling and focus); the mock's is `page.js:663-674` | build new, inside `BalanceView` |
| Reduced motion | CSS only: `TokensView.vue:520`, `received/[id].vue:514`, `Skeleton.vue:48`; the "Disable animations" setting adds `.noanimations` to `<html>` (`popup/app.vue:68-70`), which kills transitions only (`base.css:389-392`) | reuse both: CSS `@media` for the keyframes, one `matchMedia` read plus the `.noanimations` class for the count |
| e2e toast reader | `tests/e2e/fixtures/helpers.ts:1366-1377` `waitForToast`: body `textContent` substring, 200ms polling | adapt: read `[data-testid="snackbar"]`, optionally by kind |

## Facts the plan relies on

1. **Call sites.** 130 production `openToast(` calls in 56 files, all in `apps/extension/src`
   (`grep -rn "openToast(" apps/extension/src --include=*.vue --include=*.ts --include=*.js`, tests
   excluded). Seven pass `color: "red"`: `LegalAcceptanceSheet.vue:50`, `useNetworkActivation.ts:33`
   (a multi-line call opening at `:32`), `onboarding/pages/terms.vue:34`, `send-submit.ts:67`,
   `send.vue:337`, `execute/index.vue:155`, `:178`. Five calls put the argument's `{` on the next
   line (`useNetworkActivation.ts:32`, `onboarding/pages/import.vue:47`, `NewNetworkPopup.vue:133`,
   `RevokeAuthwitsPopup.vue:94`, `NewTokenPopup.vue:247`). No `openToast(` appears in a Vue
   template. The mapper classifies them as 55 errors, 47 successes, 24 neutral notices and 4 mixed
   (a ternary between two messages); its per-site table is the P1 input and is re-derived there.
2. **Indirect callers.** `utils/clipboard.ts:30-53` (`copyWithToast`, `copyToClipboard`) opens a
   copy success (icon `copy`) or "Couldn't copy" (`3_000`). 20 production call sites invoke the
   helpers directly, plus `components/header-copy-address.ts:11-13`, which wraps them for
   `Header.vue:197`; three of them pass their own toast spec (`IncomingTrustPopup.vue:78`,
   `received/received-copy.ts:10`, `header-copy-address.ts:13`). They change through the helper's
   spec type, not one by one. (The reports' "42 callers" counted UI controls that reach those
   20 sites.)
3. **One toast at a time.** The singleton replaces the current toast on every open (`toast.ts:27`).
4. **Teleport roots.** `#toast` is the fifth teleport anchor, after `#popup`, `#tooltip`,
   `#dropdown` and `#popover`, in both shells (`popup/app.vue:407-411`, `onboarding/app.vue:79-83`),
   and all five precede `Header` and the page; `ToastManager` is mounted at `popup/app.vue:415` and
   `onboarding/app.vue:86`. Because the anchor comes before the page, a focusable snack today would
   take the first Tab stop.
5. **Popups do not block the snack's pointer, but they block its keyboard.** `Popup.vue` traps
   focus with `allowOutsideClick: true` (`Popup.vue:58-64`) and closes on its own `close_area`
   (`:100`), so a click on the snack reaches it and leaves the popup open; keyboard focus cannot
   leave the trap to reach it. The trap is focus-trap 8.2.2, whose Tab handling recomputes the
   tabbable nodes on every Tab (`focus-trap.esm.js:559-565`). Popups sit at z-index
   `(displaceIdx + 1) × 500` (`Popup.vue:98`), the toast at 2000.
6. **dApp windows.** The execute, discover, capabilities and verify windows are popup-app routes
   without `showBottomNav`; the execute window opens two red toasts (`execute/index.vue:155`,
   `:178`) and no success toast.
7. **Send leaves at once.** `send.vue:374` calls `submitTransfer(submitDeps, snapshotTransfer())`
   and navigates away; `snapshotTransfer` (`:385-406`) has `activeToken.value` with `symbol` and
   `decimals`, which `TransferSnapshot` (`send-submit.ts:6-18`) lacks. A cancel is silent (`:65`).
8. **Rows.** `TransactionCardLayout.vue` is the shared frame of the four activity cards: a `Flex`
   root carrying the testid and `data-tx-*`, `data-stage`, `data-backend` (`:103-115`), `.wrapper
   {padding:6px 0; position:relative}` (`:148-151`), an actions slot absolute at `top:6px; right:0`
   (`:176-182`) with 20px/36px reservations (`:164-171`). Clicks come from `TransactionsList.vue:
   107-117` (History) and `RecentActivityView.vue:856-900` (Home), routing to `/popup/tx/${hash}`,
   `/popup/journal/${op.id}` and `/popup/received/${inc.id}` (`TransactionsList.vue:55-75`).
9. **Pending rows.** `TransactionAwaitingCard.vue:65`: `focusable = jobId && stage === "queued"`;
   only then does the card take `display:block; cursor:pointer` (`:125-132`) and open the approval
   window through `buildFocusHandler` (`RecentActivityView.vue:294`). History renders no awaiting
   card.
10. **SettingItem use.** 67 tags in 26 files (regex scan of `<SettingItem …>`): 29 with `to`, 24
    with `@click`, 14 with neither (toggle rows, value rows, `raw`). Every one that is not
    `disabled` is a Tab stop today (`SettingItem.vue:50`, `-1` when disabled); the 24 click rows
    have no key handler. `useAttrs().onClick` tells the component which mode it is in. Three
    click-mode sites nest controls (`AccountsPopup.vue:74`, `settings/accounts/index.vue:83`,
    `settings/networks/[id].vue:196`), which rules out a `<button>` root.
11. **Incoming records.** Common fields `id, profileId, networkId, accountAddress, contract, tokenId?,
    amountRaw, txHash, l2BlockNumber, txIndexInBlock, indexInTx, hidden, discoveredAt,
    blockTimestamp?` (`wallet/services/incoming-transfer/spec.ts`). Ids are `note:…` and `pub:…`.
    `IncomingPublicEventRecord` also carries `from` (the sender) and `blockHash`.
12. **Added events.** The service emits `onIncomingTransferAdded` from `commitDiscoveredNote`
    (`service.ts:1270-1272`), `commitPublicRecord` (`:1955-1957`) and `setTrustAllow` for the
    records it un-hides (`:586-605`), when the record is trusted and visible. `setTrustAllow` keeps
    each record's `discoveredAt`. The dust filter runs only at read time (`getIncomingTransfers`,
    `:440-462`; `applyDustFilter`, `:533-564`) and fails open whenever config, network, token or a
    fresh quote is unavailable, so a dust receipt can render while quotes are stale. The poll is
    30 s (`:50`).
12a. **History arrives after the fact.** Every record takes `discoveredAt: Date.now()` when it is
    committed (`:1985`, `:2161`). `onAccountAdded` resets the public cursors and re-scans from
    `startBlock` (`:341-374`); `onTokenAdded` sets the token trusted and rebuilds the schedulers,
    so the token's whole history is committed visible and emitted as Added (`:930-960`). So
    `discoveredAt` says when this wallet found a receipt, not when it arrived. `blockTimestamp`
    (chain UTC seconds) is optional and a missing one is backfilled by the next scan with no
    event (`spec.ts:77-82`, `service.ts:1185-1211`); `l2BlockNumber` is required (`spec.ts:63-64`,
    `:130`). Neither the account nor the token record carries a creation time. `setTrustAllow`
    flips the hidden records of every account for the contract (`service.ts:578-608`,
    `listByContract` at `repository.ts:96-98`).
13. **Home's hero is the aggregate.** `BalanceView.vue` shows `aggregateFiatDisplay` from
    `prices.formatUsdMicro` (`:102-106`; template `:261-276`, `balance-amount` at `:264`) unless it
    has a `tokenBalance`, which only the token page passes (`general.vue:51` passes none;
    `tokens/[id].vue:271` does). A commit only marks the balance dirty (`service.ts:1267`), so the
    aggregate usually changes after the Added event. The unmount cleanup is `:245-254`
    (`capTimer`/`retryTimer` at `:247-248`).
14. **Receipt formatting.** `utils/received-display.ts:58-71` `buildIncomingCardProps` gives the
    row's symbol, raw amount, decimals and receiver label; it reads `from` through
    `resolveReceivedType` (`:30-35`, `:69`), though it never returns it. The row formats the
    amount in `TransactionIncomingCard.vue:41-44` with `balanceFormatted(amountRaw, decimals, 8)`,
    which slices the whole output string to 8 characters (`utils/amount.ts:111-113`), so an amount
    with more than 8 whole-number characters loses whole digits.
15. **Motion kill-switch.** `.noanimations` is a class on `<html>` (`popup/app.vue:68-70`); it does
    not stop keyframe animations.
16. **Storage facade.** UI code reads and writes `chrome.storage.local` only through
    `@/utils/storage` (`storageLocalGet`, `storageLocalSet`); backups are explicit service slices
    (`wallet/services/backup/backup-migration-registry.ts:195`), so a `nulo:ui:*` key is not backed
    up. But nothing removes one on deletion: profile reset deletes the profile through the
    deletion coordinator (`reset.vue:66`), whose purge (`profile-deletion/coordinator.ts:115-129`)
    calls `incoming.clearProfile` and the other service purges and touches no `nulo:ui:*` key, and
    the reset page itself removes only `nulo:ui:feePaymentMethods` and the send selections
    (`reset.vue:85-87`).
17. **Lock.** `enterLockedState` closes popups and clears activity but leaves an open toast
    (`popup/app.vue:174-186`).
18. **dApp windows are popup-app routes** named `windows-*` (`utils/legal-sheet.ts:22-28`), so
    anything mounted in `popup/app.vue` also mounts in them.

## Test impact

Unit and component:

- `packages/design/src/composables/toast.test.ts`: 10 `it` (`:12`, `:18`, `:27`, `:36`, `:48`,
  `:55`, `:65`, `:71`, `:81`, `:85`); the durations pin (`:82`) and every `TOAST_DURATION` case are
  rewritten for the 6 s rule, the hold and the error without a timer.
- `packages/design/src/ui/ToastManagerBase.test.ts`: 9 tests; `:71-80` "clicking the toast card
  closes it" inverts (a click on the card does nothing; × closes an error); the variant and icon
  cases are rewritten for `kind`.
- `packages/design/src/ui/ToastManagerBase.stories.ts:14` (`openToast({label, color, icon},
  60_000)`): rewritten to success and error stories.
- `apps/extension/src/components/ui/ToastManager.test.ts`: 2 tests; gains the inset cases.
- 43 test files reference `openToast` or `TOAST_DURATION` (41 in the extension, two in the design
  package; list below). A reference scan does not show which of them assert `openToast`
  arguments; each is re-read when its call site changes. Four mock the constant
  as `LONG: 5_000`: `EditProfilePopup.test.ts:29`, `auth.test.ts:42`, `execute/scope-follow.test.ts
  :78`, `execute/index.test.ts:155`; the mocks go with the constant.
  - components: `Header`, `ScopeAddress`, `ScopeClassId`, `header-copy-address`, `ToastManager`;
  - composables: `useNetworkActivation`, `useProfileImportFlow`, `useSecretClipboardCopy`,
    `useContactImportExport` (and `.pins`);
  - popups: `ChangeAuthwitsRegistryPopup`, `ConfirmPopup`, `EditAccountPopup`, `EditContactPopup`,
    `EditFpcPopup`, `EditProfilePopup`, `ImportContactsPopup`, `IncomingTrustPopup`,
    `NewAccountPopup`, `NewContactPopup`, `NewEndpointPopup`, `NewFpcPopup`, `NewNetworkPopup`
    (and `.pins`), `NewSenderPopup`, `NewTokenPopup`, `RevokeAuthwitsPopup`, `SelectProfilePopup`,
    `TokenMetadataPopup`;
  - pages: `auth`, `received-copy`, `send-submit`, `send.integration`, `send`,
    `settings/networks/[id]`, `export/full-passkey.pins`, `export/full`, `tokens/[id]`;
  - windows: `execute/index`, `execute/scope-follow`;
  - `utils/clipboard`; the design package's `toast.test` and `ToastManagerBase.test`.
- Rows: `TransactionCardLayout.test.ts` (the reservation cases and the root attributes),
  `popup/components/modules/activity/TransactionCard.test.ts` (chips and fiat; it has no row-click
  test today), `TransactionIncomingCard.test.ts`, `TransactionTerminalCard.test.ts`,
  `TransactionAwaitingCard.test.ts:168-176` ("no nested interactive controls": it checks only for
  `[role="button"]` and that the two buttons do not contain each other, so it would pass with
  both inside a native button; it is rewritten to assert that no interactive element contains
  another) and `:200` (real-layout reservation),
  `TokenCard.test.ts`, `ContactRow.test.ts:33` (Enter), `FpcRow.test.ts` (stubs `Icon` forwarding
  click; `fpc-edit-btn`, `fpc-delete-btn` move onto `RowAction`), `components/ui/Settings/
  Settings.test.ts:61-114` (the element per mode), `RecentActivityView.test.ts` (mocks
  `router.push`).
- Incoming: `useIncomingTransfers.test.ts:96` "onAdded prepends a new record" inverts (Added
  refreshes; the raw record is never inserted).

e2e:

- `waitForToast` (`helpers.ts:1366-1377`) callers: `accounts.test.ts:105`, `:184`;
  `imported-account-lifecycle.test.ts:100`, `:142`; `network/fee-methods.test.ts:135`, `:196`,
  `:262`, `:313`, `:410`, `:491`; `network/senders-advanced.test.ts:111`, `:165`;
  `network/token-management.test.ts:30`; `profile-rename.test.ts:13`; `security.test.ts:57`, `:96`;
  `helpers/account-io.ts:230`; internal `helpers.ts:946` ("Token added"), `:1171` ("Transaction
  submitted"). All keep their strings: the title keeps today's label, so a substring still
  matches.
- `helpers.ts:1895-1898` is a comment in the purge-failure diagnostics: it says the "Couldn't
  delete profile" toast auto-dismisses, so the tombstone and row state are the signal. The
  diagnostics stay; the comment's first sentence becomes false (an error now stays) and goes.
- `contacts.test.ts:116` is `test.skip` because a success closed before the helper polled; at 6 s
  it can run, and it is re-enabled under the flake bar.
- Smoke pins `retry: 2` (`apps/extension/vitest.e2e.config.ts:41`), so a retry-0 smoke run needs a
  scratch config spreading it with `retry: 0` (batch 1's flake-bar method); `NULO_E2E_RETRY=0`
  affects only the network runner.
- Row clicks: `clickByTestId` calls `target.click()` on the testid element
  (`fixtures/extension.ts:1429-1450`), which proves no hit-testing. No spec clicks the root of
  `tx-card`, `tx-incoming-card`, `tx-terminal-card` or `contact-row` (they are waited for or
  counted; contact specs click `contact-edit` and `contact-delete` inside the row). The root
  clicks that exist (`select-token-row` at `helpers.ts:1044`, `account-item` through
  `clickSelector` at `:742-751`, `import-option-seed`) hit click-mode `SettingItem`s, which keep a
  root listener. A spec that presses a nested icon (`account-hide`, `account-edit-btn`,
  `account-export-btn`, `sender-delete`, `session-disconnect`, `fpc-*`, `endpoint-*`) keeps the
  testid on the new `RowAction`.
- Arrival: `network/incoming-transfers.test.ts:43` and `incoming-public-transfers.test.ts:29`, `:77`
  wait for `tx-incoming-card`; the card keeps it. `fixtures/incoming-poll-gate.ts` is used only by
  `network/account-switch-isolation.test.ts`, which is `@requires-proverless` (`:31`): the gate
  exists only in proverless builds (`src/e2e/chrome-storage-incoming-poll-gate.ts:31-36`), so a
  spec using it runs proverless on Chrome too.
- A persistent error can overlay a footer button on a surface without the nav. Specs that press a
  real pointer after an error (none found in the callers above; re-checked in P2) would need to
  close it first.

## Corrections of the raw reports

- **The spec's counts are stale.** "57 `openToast` call sites (6 pass `color: "red"`)" (spec § Item
  10) is 130 sites in 56 files, 7 red (counting the multi-line `useNetworkActivation.ts:32-33`),
  plus 20 direct callers of the `utils/clipboard.ts` helpers.
- **A sender field exists.** The sweep's "no sender field anywhere" is false:
  `IncomingPublicEventRecord.from` (fact 11), and `buildIncomingCardProps` reads it to pick the
  receiver label (fact 14). The elsewhere-snackbar must not go through that helper, and a test
  feeds a sentinel `from` to prove the snack's output cannot change with it.
- **The live feed is unfiltered for dust.** The sweep said the service's two filters run before
  Added; only the trust gate does (fact 12). `useIncomingTransfers` inserts the raw record
  (`:92-97`), so today a dust receipt can flash into the list until the next refresh. The arrival
  is therefore driven by the refreshed, filtered list, which still fails open (fact 12).
- **Counts in `recon-test-impact.md`.** `toast.test.ts` has 10 tests, not 14; `waitForToast` is at
  `helpers.ts:1366-1377`, not `:1334`; a SettingItem test exists
  (`components/ui/Settings/Settings.test.ts`).
- **The house focus style.** The sweep called it tint-only; that is the code. The mock draws tint
  plus a 2px `--nulo-accent` outline at offset −2px (`nulo.css:243-244`), which this batch builds.
- **The nav clearance token is not the drawn offset.** `--nav-clearance` is 96px (`base.css:68-70`);
  the snack wrap is drawn at `bottom:76px` (`mocks/src/r2/i10.html:20-21`,
  `mocks/src/parts/10-toasts.html:39`).
- **The drawn Home hero is a token hero.** `12-incoming` counts up "2,514.10" under "USDC ·
  $2,514.10"; the real Home shows the aggregate USD (fact 13). The count-up target is an owner ask.
- **Corrected by the plan audit, round 2.** The contact page is
  `popup/pages/settings/contacts/index.vue`, and its preselection is a Pinia ref a new tab does not
  share; `Popup.vue:102-105` holds an invisible tabbable dummy button; vue-router refuses a
  `navigate` whose event is already prevented (`dist/vue-router.cjs:2111-2121`); the storage
  facade's `storageLocalSet` waits for a migration before writing (`utils/storage.ts:78-83`), so
  a UI Web Lock could not exclude a background purge.
- **Corrected by the plan audit (codex and fable, round 1).** The toast view's line numbers, the
  "first child" anchor, the 42 clipboard callers, "each test asserts arguments", "every
  SettingItem is a Tab stop", the `TransactionCard.test.ts` row click, the `helpers.ts:1895`
  "workaround", the `BalanceView` cleanup lines and the base commit were wrong or imprecise; the
  entries above carry the checked values.
