# Phase 3 · e2e and parity

## Rebase onto batch 1

- Batch 2's eleven commits (`fee6b4a2..0ea81879`, cut from a pre-rebase batch 1) were
  cherry-picked onto batch 1's tip `16667877` on `wip/ux-2-p3`.
- Conflicts: none. Batch 2 touches no shared doc (the program plan, the index lines), and its
  patch is byte-identical before and after the move once the `index` lines are ignored.

Gate after the move:

- `bun run lint` → exit 0 (29 warnings, 3 infos, none in changed files; complexity baseline OK).
- `bun run typecheck:all` → exit 0 (15 workspaces).
- `bun run test:all` → exit 0; extension 566 files passed, 3 skipped / 7168 passed, 4 skipped,
  7 todo; every other workspace green.

## Step 1 · probes

Throwaway scripts outside the repo, not committed. They drove the suite's own browser drivers
(`fixtures/browser`) headless against a plain `build:chrome` / `build:firefox`, and ran
`chrome.windows.*` from an extension page. Chrome 152.0.7977.42 (the suite's launch flags, screen
800×600); Firefox 153.0.4 (screen 1366×768).

**A positioned `windows.create`**

- Chrome: `left` and `top` are honoured exactly; **`width` and `height` are ignored**. Every
  popup comes out 400×600 and every normal window 500×600, whatever was asked (300, 500 and 580
  tall all give 600; 300 wide gives 400). The cause is the suite's `--window-size=400,600`: the
  same launch without that flag honours a 400×500 popup. A taller-than-screen request is 600 in
  both. `windows.update` does honour sizes (a normal window to 600×500, a popup to 400×350).
- Chrome refuses a position that leaves the window less than half on screen: "Invalid value for
  bounds. Bounds must be at least 50% within visible screen space." (right edge past the screen,
  and `left: -350`). The size-only retry is reachable there.
- Firefox honours position and size on create, popups and normal windows alike. It clamps instead
  of refusing: `left` 1266 → 966, `left` −350 → 0. A taller-than-screen request was kept at its
  height (968) and moved to `top` −200. The retry is not reachable on Firefox headless; the unit
  tests are its only proof there.
- Both: `windows.update(id, { state: "normal" })` then bounds un-maximizes and places a normal
  window exactly (100, 40, 600×500 read back on every poll).

**`windows.update({ focused: true })` → `getLastFocused` and `onFocusChanged`**

- Chrome: **not honoured.** Neither `windows.update({ focused: true })` nor `page.bringToFront()`
  fires `onFocusChanged` or moves `getLastFocused`; only creating a window does (`[id, -1]` per
  create). Every window reports `focused: true`. `getLastFocused({ windowTypes: ["normal"] })` is
  the last normal window created, and the filter holds: a popup is never returned.
  `browser.newPage()` opens a tab in that same last-created normal window.
- Firefox: honoured. Each focus fires `onFocusChanged` (`-1`, then the id) and moves
  `getLastFocused`. With a popup focused, `getLastFocused({ windowTypes: ["normal"] })` answers
  that popup (`type: "popup"`): the filter is ignored, as the plan's fact 3 says.
  `browser.newPage()` (the driver's `type: "window"`) opens a maximized normal window that takes
  focus.

**`runtime.getBrowserInfo`**

- Chrome: `undefined` on `chrome.runtime`; no `browser` namespace.
- Firefox: a function on `chrome.runtime` and on `browser.runtime`.

**A second request while an execute window is pending** (read from the code; not run, it needs
the sandbox)

- Same session: none opens a window. Every message of a session waits on the one before it
  (`onWalletMessage` → `chainSendTxWithVouching` runs after `prev`), and a `sendTx` releases that
  baton only once approved (`onExecutionEnqueued`). `concurrent-sendtx.test.ts` pins that the
  second execute window stays unopened.
- `pg-btn-connect` is disabled while the page is connected
  (`apps/playground/src/sections/connect.ts`).
- What can open one: Connect on a second, unconnected playground page. Discovery is not a session
  message, and `DappInteractionService`'s lock covers only minting the id and opening the window.

**Viewport emulation (a correction to fact 6)**

- An approval window wrapped the way `waitForPopup` wraps it (`target.asPage()`) is not emulated:
  `page.viewport()` is `null` before any `setViewport`, and `innerWidth`×`innerHeight` equal the
  outer 400×600. Puppeteer 25.8's `CdpTarget.asPage()` creates the page with a `null` viewport;
  only `browser.newPage()` pages get the 800×600 default. The approval windows have always
  rendered at native size in the Chrome suite; `setViewport(null)` is a no-op on them.

## Stopped here

The e2e contract's height rule cannot be observed on headless Chrome under the suite's launch.
It asks for an anchor shorter than 800 "so the height rule bites" and asserts
`height = min(800, anchor height)`. The screen is 600 tall, so an anchor is at most 600, and
`--window-size=400,600` makes every created window 600 tall whatever height the wallet asks for.
Only a 600-tall anchor passes, and that anchor cannot tell the cap from the default. Separately,
focus on Chrome moves only by creating a window, so step 1's "focus the dApp's browser window"
and step 5's "focus W1 again" are no-ops there. Step 5 still separates the corners on Chrome,
because B is created focused and the filter skips W1.

Firefox matches the plan's assumptions: sizes and positions honoured, focus tracked, the filter
ignored. It clamps off-screen positions instead of refusing them.

## Decision (codex high)

Asked `/codex high` (GPT-6 Astra) how the spec should prove the height rule and the popup-anchor
fallback given the probes above. Adopted as-is; the plan's e2e contract, P3, P4 and Ask 7 carry
it.

DECISION:
a. Option 5; spec-local Chrome size-flag opt-out, full height assertions on both browsers.
b. Connect from unconnected page B; shared B-selection check plus a separate Firefox-only W1-focus regression.
c. Remove the viewport reset; assert native viewport and retain reachability checks.
d. Gate shared checks on both browsers and the focus regression on Firefox explicitly. — confidence: high

## Rebase onto batch 1's final tip

- The implementing worktree was cut from `dev` (`ae4260f3`), not from batch 1. Its branch held no
  commit of its own and a clean tree, so it was moved to batch 1's final tip `ad470e6c` before
  anything else.
- Batch 2's twelve commits (`16667877..2caf3788` on `wip/ux-2-p3`) were cherry-picked onto
  `ad470e6c` in order: all twelve applied, no conflicts, every commit signed. The only non-plan
  differences from `2caf3788` are batch 1's own later commits.
- `bun install` → exit 0.

## Comment fixes codex flagged

All three lines predate batch 2, so none was changed here (`git diff ad470e6c..HEAD` touches none
of them; `git blame` gives earlier commits):

- `tests/e2e/fixtures/popups.ts:28-30` cites `implementations-plan/network-followups/plan.md`
  (`6b2075ee`, May). Worth a one-sentence rewrite about mount latency under CPU pressure, outside
  this batch.
- `window-manager.ts:140-143`, the four-line "Identity, not membership" comment (`94237eb7`).
  Codex's sentence: "Handle IDs can be reused; identity prevents adopting a stale create and
  leaves its window to be closed."
- `chrome-browser-api.ts:204-205` says "the dApp's window" (`57c4158a`); the query returns the
  last-focused normal window, which can differ.

## Step 2 · the spec

- The launch opt-out is `fixedWindowSize: false` on `launchExtension` → `LaunchOptions` → the
  Chrome launch, which then omits `--window-size=400,600`; every other launch keeps its flags in
  the same order. No gating test pins the launch args.
- The spec creates A (and later B) with `chrome.windows.create` from the control page, the wallet
  popup `openPopup` leaves open, so each id is known without reading tab URLs: the manifest has no
  `tabs` permission and Chrome hides a `localhost` tab's URL without one.
- `FIREFOX_ONLY` sits beside `CHROME_ONLY` in `fixtures/browser/index.ts`, used as
  `describe.skipIf(!isFirefox)(FIREFOX_ONLY.windowRefocus, …)`; `FIREFOX.md` and the
  `e2e-testing` skill name the form. Three fixture helpers became exports so the spec reuses them:
  `isTargetDetachError`, `waitForMainFrame`, `PLAYGROUND_TEST_PAGE`.
- `browser-seam.test.ts` + `unresolved-names.test.ts` → exit 0, 45 passed.

## Step 5 · runs (retry 0, one browser at a time, `NODE_OPTIONS=--dns-result-order=ipv4first`)

- Chrome #1 → exit 1 (145 s): `TimeoutError: Timed out after waiting 60000ms` in a
  `waitForPopup`, with no step named. `openedBy` now reports the targets, the window census and the
  dApp's status on a timeout.
- Chrome #2 → exit 1: every walk window matched A's corner. Connect on B opened **no discover
  window**: the census showed a verify window, `isReconnect=true`, at 100,80 400×440, which is B's
  corner. Cause, read in `wallet-sdk/background.ts:752-755`: a discovery from an origin with a
  session on the chain is auto-approved, and the session then opens the emoji check. Product
  behaviour, not a bug; the spec now expects the emoji check there, the placement assertion
  unchanged. A deviation from the contract, recorded in its step 5.
- Chrome #3 → exit 0: 1 passed, 1 skipped; test 21.8 s, run 86 s.
- Firefox #1 → exit 0: 2 passed, 30.5 s each; run 125 s. Nothing narrowed.
- Mutation check, Firefox, the focus tracker disabled in `chrome-browser-api.ts` (copied aside,
  restored with `cp`, tree clean after): the Firefox-only test → exit 1 as it must, the emoji
  check from B at A's corner (right 700, top 40, 500 tall) instead of B's (500, 80, 440). The test
  guards the tracker.
- After a mechanical tidy (one census helper, one comment), the committed spec re-ran beside the
  parity spec with `--reporter=verbose`: Chrome → exit 0, passed in 17.5 s, the Firefox-only case
  listed as skipped under its reason; Firefox → exit 0, 25.9 s and 24.4 s.

Gates from the worktree root, after the spec commit: `bun run lint` → exit 0 (29 warnings, 3
infos, none in changed files; complexity baseline OK); `bun run typecheck:all` → exit 0 (15
workspaces); `bun run test:all` → exit 0 (extension 566 files passed, 3 skipped / 7169 tests
passed, 4 skipped, 7 todo; every other workspace green); `bun run test:ci-gating` → exit 0 (138
pass, 2 skip, 0 fail).

## Step 6 · parity capture

A throwaway spec, deleted after its runs and never committed, repeated the walk with a
screenshot of each window before its resolving click and a JSON record per case; the files were
handed to the parent outside the repo. Measured, both browsers: anchor A 100,40 600×500; connect,
emoji check, permissions and execute all at 300,40 400×500; the emoji check from B at 100,80
400×440 against B at 0,80 500×440; corners A 700/40, B 500/80, W1 420/60, three distinct. Every
window's viewport is `null`.

| | Chrome 152.0.7977.42 | Firefox 153.0.4 |
|---|---|---|
| Screen | 800×600 | 1366×768 |
| Inner vs outer | equal (400×500) | one pixel shorter (400×499) |
| Anchor case | shared: B last created, opens at B | shared: opens at B; Firefox-only: W1 (a popup) last focused, opens at B |
| Limits | focus moves only by creating a window, so the Firefox-only case is skipped | clamps an off-screen position instead of refusing it, so the size-only retry is unreachable headless; one emoji glyph renders as an empty box (a font the headless profile lacks) |

Seen on both, outside this batch's scope: at 500 tall the execute window's footer is below the
fold and the emoji check's Confirm sits at the bottom edge. Both are reached by scrolling, which
`pointerClick` does and proves uncovered. The reconnect emoji check's header reads "chain 0"
where the execute window reads "Local Network".

`bun run e2e:reap` → exit 0, nothing to reap.
