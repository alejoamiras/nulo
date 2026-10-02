# Recon · wallet-safety-fixes

Read against `dev` at `624117cd` (2026-09-28). Every line below was read in the file it cites;
nothing here was run except `rg`/`git` reads. Revised after the round-1 audits and the final fresh
pass (plan § Plan audit ledger): the A1 confirm guard, the A3 execution fence and token-add owner,
the fake's limits and the A4 late-write rows changed. The trust setters' registration read already
refuses a locked, reserved or inactive profile (`network/service.ts:427-433`), which bounds what
the A3 fence has to catch.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| A1 · Show/hide lifecycle for a popup (install on show, run `onShow`, remove on hide, scope cleanup) | `usePopupEntity` (`apps/extension/src/composables/usePopupEntity.ts:68-103`) | **adapt**: `submit` becomes optional (no listener without it) and the `submitKey` override goes; the two authwit popups keep the composable for `onShow`/`onHide` only |
| A1 · A safe "Enter in a form field submits" predicate | `isPopupSubmitKey` (`usePopupEntity.ts:9-13`) | **adapt**: refuses a repeat or composing Enter through a new shared `isRepeatOrComposing` (`repeat`, `isComposing`, `keyCode` 229), which the two confirm guards also use; still input/textarea-only |
| A1 · Keyboard confirm for a transaction | the native `<button>` activation of `revoke-authwits-submit` / `registry-toggle-submit` (`RevokeAuthwitsPopup.vue:261-271`, `ChangeAuthwitsRegistryPopup.vue:129-139`), already Tab-reachable (`tests/e2e/network/popup-escape-layered.test.ts:57-65`); native `disabled` follows the `disabled` prop only and `aria-busy` follows `loading` (`packages/design/src/ui/Button.vue:103-104`); listeners reach the native element (`packages/design/src/ui/Button.vue:98-106`, `components/ui/Button.vue:15`, `:36`, `:56`) | **adapt**: a `@keydown.enter` guard on each confirm cancels a repeat or composing Enter, so one that first lands on the idle button activates nothing; a held Enter still sends once |
| A1 · Menu Enter activation | `DropdownRoot`'s document Enter clicks `document.activeElement` (`components/ui/Dropdown/DropdownRoot.vue:230-232`), unchecked against the menu; the focus trap's backstop can leave focus outside (`:167-179`) | **adapt**: click only when the active element is inside the open menu |
| A1 · Handler-owned re-entrancy latch and fee check | `handleRevokeAuthwits` (`RevokeAuthwitsPopup.vue:71-79`), `handleChangeRegistry` (`ChangeAuthwitsRegistryPopup.vue:50-58`) | **reuse-as-is** |
| A1 · A test helper that presses a key on a focused button as a browser does | `pressOn` (`RevokeAuthwitsPopup.test.ts:113-125`); `mountAndOpen(…, attached)` mounts unattached by default (`:95`) | **adapt**: its keydown takes an init (`repeat`, `isComposing`, `keyCode`; jsdom 29.1.1 converts all three, `apps/extension/vitest.config.ts:29`), and it is copied into the registry test (two copies, under the three-copies rule); attached wherever bubbling matters |
| A1 · Browser proof in a popup that hosts the fee menu, with no transaction sent | `network/popup-escape-layered.test.ts` (opens the registry popup, waits for a live submit, drives the fee menu; skips without network configuration, `:18-19`, `:37`), `pointerClick`, `pressEscape` | **adapt**: one more test in the same file; its signal is `aria-busy` on the submit, recorded by a `MutationObserver` armed before each key, since the popup closes only after the transaction is proven (`ChangeAuthwitsRegistryPopup.vue:63-78`) |
| A2 · Fixed-text refusal + sentinel test pattern | `projectKnownCapability` → `ValidationError("Malformed ${type} capability", …)` (`packages/wallet-bridge/src/dispatcher.ts:414-423`); "no request value reaches the refusal" (`dispatcher.test.ts:2073-2091`) | **reuse-as-is** (the pattern; the three messages stay plain `Error`s, see plan) |
| A2 · A harness that drives `handleWalletMessage` with a spied logger and `sendResponse` | `background.legal.test.ts:17-39` | **adapt**: the same shape in one new sink test file (second copy), with an explicit `Error` normalizer (`JSON.stringify` drops `message` and `stack`) |
| A2 · The dApp-facing envelope for an unclassified error | `toWalletResponseError` → `UNCLASSIFIED_ERROR_MESSAGE` (`wallet-sdk/error-envelope.ts:176-199`) | **reuse-as-is** (unchanged) |
| A3 · Lock fence on a trust write | `isCurrent` from `withServiceLock` (`incoming-transfer/service.ts:259-263`), threaded into `_setTrustStateLocked` → `repo.setTrust(…, fence)` (`service.ts:600-608`, `repository.ts:124-138`), as `onTokenAdded` does (`service.ts:1121-1130`); the registration read's active-profile check (`service.ts:660-671` → `network/service.ts:427-433`) | **reuse-as-is**, but not sufficient alone: `setTrustAllow` and `onTokenAdded` read the tip before the lock (`:612-615`, `:1120-1122`), a lock or a switch can land after the registration read, and the watchdog can hand the lock on |
| A3 · A fence that binds a write to the session and incarnation that authorized it | `captureExecutionFence` / `isFenceLive` (`profile/service.ts:521-555`: session serial, active profile, deletion epoch), for the trust write; the deletion epoch alone (`ProfileDeletionState.isCurrent`, `profile/profile-deletion-state.ts:52-77`, via `getDeletionState()`, `profile/service.ts:1340-1342`), for the floor and the un-hide | **reuse-as-is**: combined with `isCurrent` |
| A3 · An event that names the profile its row belonged to | `TokenDeleted = TokenInfo & { profileId }` (`token/spec.ts:263-269`, emitted at `token/service.ts:215`, `:614`) | **reuse-as-is** (the pattern): `TokenAdded` beside it, emitted at `token/service.ts:431` |
| A3 · What re-asks a choice the fence refused before the trust write | `replayPendingPrompts` (`incoming-transfer/service.ts:1478-1515`), replayed by `PopupManager` on connect and on a triple change, never twice in a row for one triple (`PopupManager.vue:173-188`) | **reuse-as-is** |
| A3 · A test that parks a read, lets the 5-minute watchdog hand the lock to a successor, and asserts the displaced section writes nothing | "a claim the watchdog displaced writes nothing after it resumes" (`service.scenarios.test.ts:5072-5096`), `deferred`, `bootArrivals`, `trustKey` | **reuse-as-is** (pattern and helpers). The fake repository's `setTrust` awaits no read (`:93-101`), so park on `getTokensRaw`, `getRecord` or the tip reader; the real repository's read-then-fence is pinned by `repository.test.ts:91`. The fake network's `getNetwork` ignores the active profile (`:212`). The profile stub (`:163-173`) needs `captureExecutionFence`, `isFenceLive` and `getDeletionState` over a session serial |
| A4 · One place every profile deletion path runs through | `ProfileDeletionCoordinator.purge` (`profile-deletion/coordinator.ts:116-131`), reached by live delete (`profile/service.ts:1512`), the torn-import reap (`deleteProfile(id, tornGuard)`, `:1462`) and the resume (`:1590`) | **adapt**: one more step |
| A4 · Precedent for a SW service removing its own per-profile `chrome.storage.local` key | `NetworkService.purgeForProfile` → `browserApi.storage.local.remove(activeKey(profileId))` (`network/service.ts:50-51`, `:918`) | **reuse-as-is** (the idiom) |
| A4 · The pinned-tokens key builder | `pinnedTokensKey` (`popup/constants/storage-keys.ts:9`), used by `usePinnedTokens.ts:58`, `:178` | **adapt**: moves to a module the wallet may import (`@/utils/…`; wallet imports `@/utils/*` today, never `@/popup/*`) |
| A4 · An inventory of profile-keyed keys | none. Searched: `rg '@\$\{' apps/extension/src packages/*/src`, `rg 'profile-bearing'`, `rg 'nulo:ui:'` | **build new**: a registry of profile-keyed UI key prefixes, because the purge needs one source and a scan needs one place to allow |
| A4 · A late write re-checked after the storage barrier | `storageLocalSet(items, { unless })` (`utils/storage.ts:73-83`); `usePinnedTokens`' `writeMap` passes none (`usePinnedTokens.ts:177-180`); reads await the same barrier (`utils/storage.ts:68-71`), so a test parks the pin at the awaited `knownContracts` seam (`usePinnedTokens.ts:118`, `:155`, `:208`) | **reuse-as-is** (pin and unpin pass the scope check) |
| A4 · Routing of every deletion path into the purge | `profile/service.integration.test.ts:1786-2060` (live, resumed, torn reap all reach `runFor`) | **reuse-as-is** (the coordinator tests drive `runFor`) |
| A4 · A source-scan test idiom | `log-payload-ban.test.ts`, `storage-facade-ban.test.ts`, `DottedTerm.scan.test.ts` (`apps/extension/src/…`) | **reuse-as-is** (the idiom) |
| A5 · The id width | `nextRandomId(storage, length = 8)` → `getRandomHex(length)` draws `ceil(length / 2)` bytes and returns `length` hex characters (`wallet/services/id-allocators.ts:48-54`, `packages/wallet-core/src/utils/random.ts:9-15`) | **reuse-as-is** (comment only) |

## Inventory: document-level Enter handlers (A1)

Every `keydown` listener on `document`/`window` under `apps/extension/src` (non-test), and what
its Enter does:

| Where | Guard | Sends a transaction or signs? |
|---|---|---|
| `usePopupEntity` default (13 form popups: New/Edit Account, Contact, Endpoint, Fpc, Network, Profile, Sender, Token) | input/textarea target | no |
| `RevokeAuthwitsPopup.vue:151` | bare `e.key === "Enter"` | **yes** (`revokeAuthwits`, `:107`) |
| `ChangeAuthwitsRegistryPopup.vue:92` | bare `e.key === "Enter"` | **yes** (`setRegistryEnabled`, `:63`) |
| `onboarding/pages/create.vue:90-96` | bare Enter, `isCreating` latch | no (creates a profile) |
| `popup/pages/profile/new.vue:84-89` | input/textarea (`new-profile-helpers.ts:53-57`, a copy of `isPopupSubmitKey`) | no |
| `popup/pages/import.vue:146-161` | bare Enter, action resolver | no (backup restore) |
| `settings/security/change-password.vue:82-88` | bare Enter | no |
| `settings/security/export/seed.vue:74-83` | bare Enter | no (reveals after a password) |
| `settings/security/export/full.vue:392-414` | bare Enter, agreement | no |
| `settings/security/export/account.vue:201-207` | `defaultPrevented` | no |
| `settings/accounts/import.vue:157-162` | `defaultPrevented` | no |
| `modules/send/RecipientField.vue:72-81` | only while suggestions show | no (picks a contact) |
| `components/ui/Dropdown/DropdownRoot.vue:223-232` | while its menu is open | activates the focused element, not checked to be in the menu; hosted through `FeeSettingsCard` by the two popups and the execute window (`popup/windows/execute/OperationCard.vue:301`); indirect route to a confirm only if the trap's backstop left focus there |
| `components/passkey/PasskeyCeremonyDialog.vue:58` | Escape only | no |
| `popup/windows/**` | none installed | the dApp windows confirm only through their buttons |

So the class "a document-level Enter that can send a transaction or sign" has exactly the two
authwit popups in it, plus `DropdownRoot`'s indirect route, which the plan hardens. The page-level
bare-Enter handlers above are outside this package: none broadcasts or signs.

A native confirm button's own activation also accepts a repeat or composing Enter that first lands
on it idle. The two authwit confirms get a guard (plan § A1); the dApp windows' confirms keep plain
activation, and no window focuses its confirm by itself (the one `.focus()` under
`popup/windows/` is an input, `capabilities/AccountSelectRow.vue:45`): plan follow-up F-6.

## Conventions to match

- Red before green: each fix lands after a test that fails on `624117cd`, in the same commit or
  the one before.
- Component tests colocated, `mount` with `global.stubs`; e2e by `data-testid` only; existing
  testids unchanged (`revoke-authwits-submit`, `registry-toggle-submit`, `popup-close-btn`,
  `send-fee-method-*`, `send-fee-priority-*`).
- Refusals keep the `Scope violation:` prefix: `scope-enforcement.test.ts:449-554` matches
  `/Scope violation/` and `/structured call intent/`.
- Service-lock writes read `isCurrent()` after their last await (`service.ts:1123-1125`, the
  comment on `onTokenAdded`); a write that acts on a person's decision also reads the execution
  fence captured at entry (`profile/service.ts:521-555`), as execution does through
  `assertFence`/`isFenceLive`.
- A known residual is pinned as a `(BUG PIN)` test (CLAUDE.md § Vue component test conventions).
- Comments: one sentence of why; no plan, review or phase references.

## Collision and dedup risks

- **`grant-check-address-case`** edits `matchesPattern` (`method-scope-checkers.ts:38-40`). This
  package edits only the three `throw` expressions in `checkCreateAuthWit` (`:287`, `:302-304`,
  `:317-319`). No line is shared; a rebase conflicts only if either package reflows the file.
- **`ux-owner-picks`** edits `utils/journal-state.ts`, the fee payer default and `send.vue`'s
  `onTokenAdded` body (`send.vue:89-91`). This package changes only the event's payload type and
  edits no `send.vue` line.
- `new-profile-helpers.ts:53-57` duplicates `isPopupSubmitKey`. Deduplicating it is outside this
  package (a page, no transaction); noted, not done.
- The sink test copies `background.legal.test.ts`'s harness (second copy). A third copy should
  extract it.
- Moving `pinnedTokensKey` touches `usePinnedTokens.ts` and `usePinnedTokens.test.ts` imports, plus
  the `unless` on pin and unpin writes.
- The address-keyed fee maps (`nulo:ui:feePaymentMethods`, `nulo:ui:sendFeePaymentMethods`,
  `FeeSettingsCard.vue:293-296`) are not profile-keyed; they stay out of the registry (plan
  follow-up F-1).
- `useSyncedRef` (`composables/syncedRef.js:5-8`) builds `nulo:ui:` keys at runtime; the scan
  covers its call sites.
- `src/types/auto-imports.d.ts` is generated from every export under `src/composables/` and
  `src/utils/` (`apps/extension/vite.config.ts:125-126`) and tracked, so `isRepeatOrComposing` and
  the new `profile-ui-keys.ts` exports change it; regenerate it in the same commit.
- `TokenAdded` widens an internal event's payload: `token-balance`, `send.vue`, `activity.vue`,
  `RecentActivityView.vue` and `settings/tokens/index.vue` keep `TokenInfo`-typed handlers, and no
  dApp path subscribes to token events (`wallet-sdk/background.ts`).
