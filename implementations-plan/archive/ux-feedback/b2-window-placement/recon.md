# Batch 2 recon · window placement

One reuse sweep (Explore, sonnet, read-only), 2026-09-24, against the arc's base: the tip of
`feat/ux-1-first-run-wording` (`46a0ed32`). The driver's own addendum is the last section.

## Reuse map

| Capability | Existing | Verdict |
|---|---|---|
| Anchor lookup | `ChromeWindowsAdapter.getLastFocused` (`core/adapters/chrome-browser-api.ts:188-199`), `WindowPort.getLastFocused`, the fake's `lastFocused` | adapt: Firefox ignores `windowTypes` and can answer with a popup, so the adapter checks the answer's `type` and, on Firefox only, tracks the last focused normal window (see Anchor) |
| Top-right placement | `centerOn` (`wallet/services/window-manager/window-manager.ts:23-31`) | adapt: a sibling function with the same contract (signed, never clamped, no position without a full anchor); `centerOn` stays for the passkey window |
| Height `min(800, anchor height)` | none (searched `Math.min`, `clamp`, `availHeight` under `wallet/services/`, `core/adapters/`) | build new, inside the sibling |
| Wiring execute, capabilities, discover | `WindowManager.openAndAwait` (`window-manager.ts:88-99`), which also serves passkey | adapt: the caller names its placement |
| Wiring the verify window | `openVerifyWindow` (`wallet-sdk/session-established.ts:178-215`), `SessionEstablishedDeps.windows: Pick<WindowPort, "create" \| "remove">` (`:43`) | adapt: widen the `Pick` with `getLastFocused`; production (`wallet-sdk/background.ts`) already passes the full port |
| Size-only retry | none at any layer (searched `retry`, `catch` around `windows.create`) | build new, one helper both paths call |
| Logging | `ILogger` (`session-established.ts:160-165`) | reuse `ILogger` with constant messages: the logger keeps error messages (`logger/utils.ts:169`) and `scrubUrls` misses `chrome-extension://` and `moz-extension://` URLs (`utils/scrub-urls.ts:24`), which carry the verification hash and request ids, so no raw browser error is logged or settled |
| Unit-test rig | `FakeBrowserApi` / `MockClock` (`@nulo/wallet-core/testing`), `FakeWindowsAdapter` (`creates`, `updates`, `lastFocused`, `closeByUser`), `window-manager.test.ts` "positioning on the last-focused window" (`:361-407`), `describe("centerOn")` (`:436-449`); `session-established.test.ts` `makeDeps()` (`:49-70`); `wallet-sdk/test-ports.ts` `fakeSdkPorts()` already returns `getLastFocused: async () => undefined` | reuse; `makeDeps()` gains `getLastFocused` |
| e2e bounds assertion | none: no e2e reads a window's position or size (searched `left`, `top`, `screenX`, `outerWidth`, `windowBounds`, `chrome.windows.get`) | build new |

## Call sites

| Site | Flow | Size | Position today |
|---|---|---|---|
| `dapp-interaction/service.ts:440-446` `interaction()`, reached from `execute()`, `requestCapabilities()`, `discover()` | execute (sign and authwit approvals render inside it), capabilities, discover: one call site, `kind` is the route | 400×800 | `centerOn` |
| `wallet-sdk/session-established.ts:190-197` `openVerifyWindow` | the emoji check | 400×800 | none |
| `passkey/service.ts:119-125` `openWindowAndWait` | WebAuthn ceremony, not dApp-facing | 500×800 | `centerOn` |
| `JsonViewer.vue:90`, `popup/windows/execute/index.vue:592`, `settings/advanced/index.vue:51`, `utils/legal-links.ts:10`, `onboarding/pages/done.vue:58-65`, `onboarding/app.vue:42-47` | JSON viewer, logger, legal permalinks, onboarding | various | none or hardcoded |

There is no `/windows/sign` route (the window routes are capabilities, discover, execute, json,
logger, passkey, verify), so the spec's "sign" window is the execute window.

## Errors around create

- `ChromeWindowsAdapter.create` has no try/catch; a rejection propagates.
- `openAndAwait` catches the `getLastFocused → create` chain (`:135-139`) and settles the handle
  with the message; `created.id === undefined` settles "Failed to open window.". No retry.
- `openVerifyWindow` catches around `create` (`:189-202`): `reservation.creationFailed()`, then
  rethrows; `handleSessionEstablished`'s catch (`:157-167`) is fail-closed and terminates the
  session. A refused position there would end the dApp's session, so the retry sits inside that
  try, before `windowId` is read, and is invisible to the reservation (`markInFlight` once,
  `creationFailed` only when every attempt failed).
- The identity fence in `openAndAwait` (`:103-110`, tests `:323-359`, `:383-406`): a window that
  arrives for a settled handle is closed. The retry stays inside the same continuation.

## Anchor

`getLastFocused({ windowTypes: ["normal"] })`, `undefined` when a bound is not a number, never
throws. Chrome honours the filter; Firefox ignores it and can answer with an approval popup (MDN;
Firefox 153.0.4's implementation), which would stack the next window on it. Signed
coordinates pass through (`window-manager.test.ts:366-373`, an anchor at `left: -1920`). A
minimized anchor is not handled: `WindowBounds` (`packages/wallet-core/src/ports/window-port.ts`)
carries no `state`.

## Screen bounds

No `system.display`, `screen.*` or clamp anywhere in the window code, and no `system.display`
permission in either manifest. `min(800, anchor height)` needs only the anchor.

## Collision watch-list (out of scope)

The JSON viewer, the execute window's `showJson`, the logger window, legal links, the onboarding
windows and `useDappApprovalWindow`'s self-close keep their placement.

## Driver addendum

- **The e2e geometry changes.** Chrome e2e launches with `--window-size=400,600`
  (`tests/e2e/fixtures/browser/chrome.ts:39`), so the anchor is 400×600 and every dApp window in
  the suite is requested 800 tall today, centered on it. After this batch each is requested at the
  anchor's top-right, 600 tall. Fifty-four e2e files drive a dApp window (`waitForPopup(`), so the
  arc gate is the whole network suite on both browsers, not a subset.
- The plan audit's correction here was wrong, as the P3 probe showed: only `browser.newPage()`
  pages are emulated at 800×600. Approval windows (`target.asPage()`) render at their native size,
  which the size flag holds at 400×600 whatever the wallet asks, so on Chrome only the positions
  move. The plan's e2e contract records the spec that sees a shorter window.
- Firefox launches with no window size (`fixtures/browser/firefox.ts:245-253`) and gives each
  extension control page a normal window of its own (`:332`); whether headless Firefox honours
  `left`/`top` on `windows.create` is checked in P3. Firefox ignores `windowTypes` in
  `windows.getLastFocused` (plan audit), so the anchor lookup can return a popup there. Remembering
  the adapter's own answers keeps a stale identity (focus B, return to the popup, request), so
  the plan adds a focus tracker. It runs on Firefox only and is added after startup, because
  Chrome keeps any service-worker listener as a wake-up while Firefox persists only listeners
  added at startup.
