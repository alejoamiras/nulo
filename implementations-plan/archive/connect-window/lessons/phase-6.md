# Phase 6 · One window, proven in both browsers

## Build

- Playground: `verificationHash` in its state, cleared when a connect starts and set from
  `pending.verificationHash` before `confirm()`, rendered on a hidden `pg-verification-hash`
  (listed in `apps/playground/README.md`'s testid contract).
- `approveConnect(ctx, discoverPage, allow?)` in `fixtures/popups.ts`: reads the page's own window
  id and the popup-window count inside the page (BiDi has no window handles), runs `allow`
  (`approveDiscover` unless the caller drives the real pointer), waits in the same page for
  `#/windows/verify` and `verify-emoji-grid`, then fails if the window id or the popup count moved.
  A timeout names whether the connect window closed and how many verify windows are open.
- Moved to it: `connectPlayground` (its armed-before-Allow verify wait and the comment explaining
  that race are gone with the second window) and the eight new-connection waits of Fact 20.
  `window-placement` keeps its pointer click through `allow` and now asserts the check keeps the
  connect window's id and its top-right bounds. The reconnect waits stay on `waitForPopup`.
- `network/connect-one-window.test.ts`: a control page records `windows.onCreated` from before
  Connect; the discover page records each Enter keydown's `repeat` in `sessionStorage` and carries
  a `window` marker; Enter is held at the focused Allow (a `keyboard.down` every 100 ms) until the
  check shows, and three repeats more. Then: at least one `repeat: true` recorded; the page shows
  the check in the connect window, which is the last-focused window, with no `error-text` and no
  page error; the grid equals `hashToEmoji` of the playground's hash; Enter and Escape leave the
  check open with "Always trust" off; OK closes it; one popup created so far (the connect window);
  `requestCapabilities` opens the permission window as the second, and its reject reaches the dApp.

## Navigation per browser (Inference 2)

The `window` marker set on the connect page before Allow was still there when the check showed,
on both engines: `tabs.update` to a URL that differs only in its fragment stays in the document,
and vue-router's hash history follows it. The spec logs
`[connect-one-window] chrome: the check loaded in the same document` and the same line for
`firefox`.

## Red first (the P1 to P5 production files as on `85c4d20f`, the P6 tests in place)

Thirteen production files swapped for their `85c4d20f` versions from a scratch copy (the two new,
unimported files and the test helpers left), restored the same way after the run.

`NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/connect-one-window.test.ts`:
exit 1, 1 file failed, 1 test failed:

```
Error: the connect window closed after Allow; windows created: [{"id":390760286,"type":"popup"},{"id":390760293,"type":"popup"}]
Caused by: Error: Attempted to use detached Frame '…'.
```

The first Enter at Allow closed the connect window, and a second popup, the verify window, opened.

## Gate

- `bun run build`: exit 0; no diff under `src/types/`.
- Chrome, `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent`
  over the six files: exit 0, 6 files passed, 8 tests: 7 ran and passed, 1 skipped. The skip is
  `window-placement`'s `FIREFOX_ONLY.windowRefocus` case, the declared inventory.
- Firefox, the same six with `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0`:
  exit 0, 6 files passed, 8 tests ran and passed, none skipped (none of the six is `CHROME_ONLY`,
  and the `FIREFOX_ONLY` case ran).
- `bun run e2e:reap` after each run: nothing left to reap.
- Static checks on the edited e2e tree: `bun --bun vitest run scripts/e2e/unresolved-names.test.ts
  scripts/e2e/browser-seam.test.ts` exit 0, 2 files, 45 passed; `biome check` over every edited
  file clean; the playground's `tsc --noEmit` exit 0.
