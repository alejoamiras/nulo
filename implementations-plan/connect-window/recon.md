# connect-window · recon

Read at `48a97f4a` (the head of #718; same tree as `f32b1e0a`), revised after round 1's audits and the final fresh codex pass. The base is `85c4d20f` (dev after #719), whose edits to `tests/e2e/fixtures/extension.ts` and `fixtures/browser/index.ts` sit away from every line cited here (re-read there). Every path is repo-relative; `src/` means
`apps/extension/src/`.

## The connect path today

1. `handleDiscovery` (`src/wallet/services/wallet-sdk/background.ts:720`) finds no session row and
   runs `runDiscoveryPopup` (`:949`), which awaits `dappInteractionService.discover(...)` (`:973`).
2. `DappInteractionService.interaction` opens the discover window through
   `WindowManager.openAndAwait` (`src/wallet/services/dapp-interaction/service.ts:429-474`).
3. Allow: the page calls `resolveInteraction(requestId, { approved: true })` and then
   `closeWindow(true)` (`src/popup/windows/discover/index.vue:112-113`). The service detaches and
   settles (`service.ts:203-219`), and `WindowManager._settle` removes the window as well
   (`src/wallet/services/window-manager/window-manager.ts:263-267`).
4. Back in `runDiscoveryPopup`: freshness, then `admitAsync(..., needsWindow: true)` reserves a
   verify-window slot (`background.ts:983-998`), then `persistAndApprove` writes the row with no
   accounts (`:1034-1037`) and `approveOrRollbackDiscoverySession` sets the request-keyed
   pending-verification marker and approves (`discovery-approval.ts:61-62`).
5. The SDK runs key exchange; `onSessionEstablished` → `handleSessionEstablished`
   (`session-established.ts:67`), which needs verification for a new connection (`:150`) and opens a
   SECOND window, the verify window, against the reserved slot (`:155`, `:179-225`), its URL
   carrying this session's own hash (`:198-200`, B-06).
6. The dApp asks for capabilities whenever it likes, which can be while the verify window is
   still open (the channel is live once establishment returns, `session-established.ts:150-157`;
   the playground confirms at once, `apps/playground/src/lib/wallet.ts:93-94`): a third window.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Keep the connect window open after Allow, owned by the connection flow | `WindowManager.detach` stops watching (`window-manager.ts:213-217`); `_settle` always removes the window (`:263-267`) | **adapt**: one method, `handOver(handleId, value)`, that settles, stops watching and returns the window id instead of removing it |
| Tell the SW the connect window's id, from the SW side only | `DiscoveryResult = { approved: boolean }`, page-supplied (`src/wallet/services/dapp-interaction/spec.ts:101-103`, `:115`) | **adapt**: `discover()` returns `DiscoveryOutcome = { approved; windowId? }`, built in `resolveInteraction` from the handle, never from the page's object |
| A waiting state on the connect page | `isLoading` drives Allow's spinner and disables Deny (`discover/index.vue:109-125`, `:167-179`); the strip goes orange on `isLoading` (`src/composables/useDappApprovalWindow.ts:89-93`) | **adapt**: hold `isLoading` (reset it only in `catch`, not `finally`, `discover/index.vue:123-125`) and add it to Allow's `:confirm-disabled`; `Button`'s `loading` alone does not disable, and disabled-and-loading keeps the loading look (`packages/design/src/ui/Button.vue:102-105`, `:158-161`, `:368-370`). No second flag: the guard at `:109`, Deny and the strip all read `isLoading` |
| Drop the `beforeunload` reject without closing | `closeWindow(true)` removes the listener and closes (`useDappApprovalWindow.ts:95-100`) | **adapt**: split out the listener removal (`completeInteraction()`), `closeWindow(true)` calls it |
| Close the waiting window on lock or profile switch | The shell's guard rejects on any other or no profile (`useDappApprovalWindow.ts:102-104`); discover's `reject` closes (`discover/index.vue:128-132`); lock emits `undefined` (`src/wallet/services/profile/service.ts:934`) | **reuse-as-is** |
| Count the kept window against the origin's window budget | `WindowReservation` (`verify-admission.ts:51-132`): slot held from admission until the window is removed (2 per origin, 8 in all, `:22-23`); before admission the window counts in the connect-popup caps (4 per origin, 32 in all, `background.ts:695-696`), whose entry is held until `runDiscoveryPopup`'s `finally` (`:1001`) | **adapt**: a `standby` state (window attached, not yet showing the check) |
| Close a window from the gate | none: the gate has no window port (`verify-admission.ts:159`) | **adapt**: the gate takes `hooks: { closeWindow, released }`; `WindowPort.remove` does the closing |
| Retire an abandoned attempt's marker | markers are deleted only by establishment's `finally` (`session-established.ts:170`), the approval rollback (`discovery-approval.ts:63`) and tab teardown (`background.ts:157`, `tab-lifecycle.ts:52-55`); `onSessionTerminated` (`background.ts:441-447`) and expiry (`verify-admission.ts:271`) delete none. The SDK keeps an approved discovery until its tab tears down and restores it on every termination (`@aztec/wallet-sdk` 5.2.0 `dest/extension/handlers/background_connection_handler.js:132-149`, `:236-271`), so the same id can establish later, and a marker-less establishment of a trusted row skips the check (`session-established.ts:150`) | **adapt**: the gate's `released(id)` hook tombstones the id's marker (`cancelled: true`, `cancelPendingVerification` beside `deletePendingVerificationForTab` in `pending-verification.ts`); the stale check at `session-established.ts:96` becomes `isPendingVerificationDead` (cancelled or stale); `finally` keeps a tombstone; `onTabTeardown` calls `admission.onSessionGone(id)` for each of the tab's markers, then deletes them, tombstones included (keys are request ids = reservation ids) |
| Refuse an approval whose window closed during its writes | the writes can wait (`discovery-approval.ts:10-19`); freshness is rechecked before the marker (`:38`) | **adapt**: an `attemptOpen()` argument rechecked beside `isDiscoveryExpired`, false once `reservation.abandoned`; same rollback, own log reason |
| Close a still-queued waiting window when its tab closes | `onTabTeardown` fires only from `tabs.onRemoved` (`tab-lifecycle.ts:52-55`) and iterates markers, which a queued attempt does not have yet; `onUpdated` sees only established sessions and no URL for ordinary origins (`:26-38`, `:61-65`) | **build new**, small: `state.handedOver` (request id → `{ tabId, windowId }`) from the hand-over to `runDiscoveryPopup`'s `finally`; `onTabTeardown` closes the tab's entries. A navigation falls back to the slot's expiry |
| Refocus the navigated window | `WindowPort.update(id, { focused: true })` (`packages/wallet-core/src/ports/window-port.ts:50`), used by `WindowManager.focus` (`window-manager.ts:194-203`) | **reuse-as-is**, best effort |
| Choose the hand-over by interaction kind | `resolveInteraction` serves discover, capability and execute windows (`service.ts:203-219`); `isExecutionPayload` discriminates by shape (`service.ts:64-66`) | **adapt**: a `DiscoveryPayload` guard beside it; the stored payload, never the page's result, picks `handOver` |
| Show the emoji check in an existing window | none: `WindowPort` has no navigation (`packages/wallet-core/src/ports/window-port.ts:39-55`); the SW already calls `chrome.tabs.update` without a `tabs` permission (`src/wallet/utils/onboarding-tab.ts:34`) | **build new**: `WindowPort.navigate(windowId, url)`; nothing in the tree moves an existing window to a URL |
| The verify URL | built inline in `openVerifyWindow` (`session-established.ts:198-200`) | **adapt**: extract `verifyWindowUrl(...)`, shared by the create and navigate paths so they cannot drift |
| The emoji check page | `src/popup/windows/verify/index.vue` | **reuse-as-is** for the check; **adapt** its header labels |
| The session's network name, chain 0 safe | `resolveDappChain` (`src/popup/windows/capabilities/chain-mismatch.ts:15-24`, chain 0 pinned at `chain-mismatch.test.ts:42`); `appStore.networks` (`src/stores/app.store.ts:55`) | **reuse-as-is** (imported from the capabilities window's directory; pure, no service) |
| The account label the other windows show | `DappStatusStrip`: active account, `'No account'` fallback (`src/components/composite/DappStatusStrip.vue:20`), fed `appStore.account?.name` (`discover/index.vue:144-148`, `capabilities/index.vue:376-379`) | **reuse-as-is** (the same source for the check's label before an account is shared) |
| Background test harness | `boot()` with a fake handler, fake popup and window ports (`background.admission.test.ts:66-110`); `fakeSdkPorts` (`test-ports.ts:4-13`); `fakeSdkServices` (`test-services.ts`) | **adapt**: the popup fake returns a `windowId`; the port fake records `navigate`; `addDappSession`'s fake stores every row under one fixed origin (`test-services.ts:35`), so it keys by the metadata's `url`; the harness mocks `wireTabLifecycle` to a no-op (`background.admission.test.ts:48`), so the new file leaves it real and stubs `chrome.tabs.onRemoved` / `onUpdated` to capture their listeners, as `tab-lifecycle.test.ts:27` does |
| Establishment test harness | `makeDeps` / `reserved()` (`session-established.test.ts:36-83`) | **adapt**: `navigate` on the windows fake, a standby reservation |
| In-memory window port | `FakeWindowsAdapter` (`packages/wallet-core/src/testing/fake-browser-api.ts:204`) | **adapt**: `navigate` records calls, rejects for an unknown id |
| e2e connect helper | `connectPlayground` waits for a NEW verify target after Allow (`apps/extension/tests/e2e/fixtures/extension.ts:343-372`); `waitForPopup` ignores a target whose URL it saw before (`fixtures/popups.ts:23-60`); `approveVerify` waits for close (`:138-172`); `countVerifyWindows` (`:500-502`) | **adapt**: `approveConnect(ctx, discoverPage)` waits in the same page for the check and compares the page's own window id and popup count before and after, read with `chrome.windows.*` in the page: over BiDi a window is born `about:blank` and no event reports its URL (`tests/e2e/fixtures/browser/index.ts:93-96`), so target URLs are blind on Firefox. The new spec records `chrome.windows.onCreated` from a control page (`window-placement.test.ts:49`) |
| The dApp's side of the check, for an end-to-end grid match | none: the playground calls `confirm()` at once and keeps no hash (`apps/playground/src/lib/wallet.ts:93-94`); the SDK exposes `PendingConnection.verificationHash` (`@aztec/wallet-sdk` 5.2.0, `dest/manager/types.d.ts:13-24`) | **build new**, tiny: the playground records `pending.verificationHash` on a testid'd element; generic wallet-sdk surface, no Nulo RPC |

## e2e call sites

`rg '"verify"' apps/extension/tests/e2e/network`: ten spec files, plus the fixture that
`connect-dapp` rides. New-connection waits after Allow (move to `approveConnect`):
`connect-locked-queue:45`, `cold-wake-discovery:82`, `session-reconnect-flood:34`,
`session-tabClose:33`, `session-reconnect:43`, `session-profileSwitch:50`,
`session-tabNavigate:35`, `window-placement:220`, and `fixtures/extension.ts` `connectPlayground`.
Reconnect waits (stay): `session-tabClose:47`, `session-reconnect:66`, `session-tabNavigate:58`,
`window-placement:245`, `frozen-account-canary:227`, `passkey-execution-canary:207` and
`fixtures/send.ts:14` (`reconnectPlayground`). Declared skips: `window-placement.test.ts:269`
(Firefox-only case) and `CHROME_ONLY` files (`fixtures/browser/index.ts:182-185`).

## Conventions to match

- Security pins are named in the test title: `(B-06 PIN)`, `(B-13 PIN)`
  (`session-established.test.ts:98`, `:108`, `:124`). New pins follow suit.
- A browser window error is never logged or surfaced: it can carry the URL, which holds ids
  (`window-manager.ts:52-55`, `:173`). `navigate`'s rejection is dropped the same way.
- Session and request ids reach a log only through `describeExternalId`
  (`session-established.ts:98`). `handleSessionEstablished`'s catch logs `err` at Warn
  (`:161-166`), so a helper replaces a browser error with a fixed one first (`:209-211`).
- The reservation's invariant: a slot is released only when its window is gone
  (`verify-admission.ts:12-15`, `:98-100`). Every new state keeps it.
- Complexity: `handleSessionEstablished` is long already; the standby-or-create choice goes in
  one dispatch helper beside `openVerifyWindow`, so the handler gains no branch. Cognitive ≤ 15, ≤ 80 non-blank lines, no new suppression.
- e2e selects by `data-testid` only, and existing testids stay verbatim: `discover-allow-btn`,
  `discover-deny-btn`, `verify-emoji-grid`, `verify-always-trust-toggle`, `verify-confirm-btn`,
  `identity-network`.
- Component tests: colocated `index.test.ts`; unit vitest auto-imports only `vue` and
  `vue-router` (`implementations-plan/lessons.md`, CI & gates).

## Collision and dedup risks

- **Two URL builders.** The create and navigate paths must share one `verifyWindowUrl`, or a later
  edit to one leaves the other showing a row hash (B-06).
- **Two owners of one window.** Between Allow and admission the window belongs to nobody; a close
  there fires `onRemoved` with no reservation. `VerifyAdmissionGate.windowRemoved` already buffers
  such removals (`verify-admission.ts:190-200`); the new `attach` must consume that buffer as
  `adopt` does (`:92-96`), or a closed window's slot is held for the worker's life.
- **Two closers.** The page's own guard (lock, switch) and the SW may both close the waiting
  window; `windows.remove` of a gone window rejects and is swallowed today
  (`window-manager.ts:264-266`). Keep every close best effort.
- **`keyboard-guards` (wave 2 stage B)** adds an Enter-repeat guard to the dApp windows' confirm
  buttons, `discover-allow-btn` and `verify-confirm-btn` among them. This plan adds no key
  handling; it adds `isLoading` to Allow's `disabled` (one line of `discover/index.vue`) and proves
  the check neither focuses OK nor listens at the document.
- **Comments in touched code** carry reviewer history and plan links
  (`discover/index.vue:33-39`, `:88-92`, `:100-105`; `useDappApprovalWindow.ts:13-15`): trim to the
  invariant when the function is edited.
- **The window manager already closes an orphan.** A handle settled before its `create` resolved
  closes the arriving window (`window-manager.ts:143-146`), so `handOver` racing `create` leaves no
  stray window.
- **`dapp-grants`** edits `packages/wallet-bridge/src/method-scope-checkers.ts` and the capability
  answer; no file here overlaps.
- **#719 (`test/e2e-reliability-fixes`)** merged into the base: its one line of
  `tests/e2e/fixtures/extension.ts` (`:117`, the scratch page) sits away from `connectPlayground`.
- **The discover tests' `Button` stubs** disable on `loading` (`discover/index.test.ts:162`,
  `index.lifecycle.test.ts:205`) where the real `Button` does not
  (`packages/design/src/ui/Button.vue:103`): a test of Allow's `disabled` must use a faithful stub.
- **The flood spec cannot hold S1**: it remembers its origin first
  (`session-reconnect-flood.test.ts:29-35`), and a remembered `(origin, chain)` skips the connect
  window (`background.ts:752-755`).
- **The brief's premise, corrected.** The emoji check's header is `IdentityStrip`, fed by
  `verify/index.vue`'s own `signerDisplay` / `signerNetwork` (`verify/index.vue:38-54`, `:184-188`);
  `DappStatusStrip` is the discover and permission windows' header.
