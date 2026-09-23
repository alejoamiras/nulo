# Phase 2 — Stop masking the throttling

## What shipped

- The three `dom.*timeout*` prefs are gone from `tests/e2e/fixtures/browser/firefox.ts`; the remaining
  launch prefs are the exported `FIREFOX_LAUNCH_PREFS`, and `scripts/e2e/firefox-driver.test.ts` holds the
  list to no key matching `timeout` or `throttl`. The suite runs under the throttling users have.
- `BrowserDriver.pxeHostState(page)` → `{ count, visibility[] }`. Chrome counts through
  `runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })` and reads `document.visibilityState`
  inside the offscreen target over CDP; Firefox evaluates a frame script in the background page and reads
  each frame's own `contentDocument.visibilityState`.
- The privileged frame-script evaluator that `firefox-action-popup.ts` carried is now
  `firefox-frame-script.ts` (`evaluateViaFrameScript` + a `locate` snippet per target). The action popup
  locates the panel's `<browser>`; the background page is located through the add-on's `extension.views`
  (`viewType === "background"`, its `xulBrowser`).
- `tests/e2e/network/pxe-host-state.test.ts` (both browsers): after one `sendTx` asserted `ok`, exactly
  one host and it is `visible`; the BUILT manifest's `web_accessible_resources` patterns (wildcards
  expanded) match nothing at `src/offscreen/index.html`.
- `tests/e2e/network/firefox-background-restart.test.ts` (Firefox only, skips by browser inside the file):
  new background identity, zero hosts right after, unlock → fresh dApp page → reconnect → `requestCapabilities`
  and `sendTx` both `assertPgOk` → exactly one host with a new generation, `visible`.
- `tests/e2e/fixtures/send.ts` — `sendDefaultTx`, the fill → click → approve → `assertPgOk` round trip the two
  new specs share.
- Comments that named the minimized window corrected: `firefox.ts` (`newPage`, `prepareClick`),
  `browser-seam.test.ts`, `firefox-rpc-intercept.ts`.

## Deviation from the plan — how the restart spec ends the background page

The plan (Ask A3) named Firefox's own `terminateBackground()` through the privileged `chromeScript`
channel — the spike's mechanism, in `spike/spike.patch`. This session could not author that helper: a
safety stop withheld the draft that carried it, and the stop is not to be worked around. The spec ends the
background with the public `runtime.reload()` from an extension page instead.

What that changes: a reload ends every extension context, not the background alone, so the spec no
longer shows "the frame dies while other extension pages live". That is a property of the DOM (a frame is
a child of the background document) rather than something a test proves. Everything the plan asked the
spec to pin is unchanged: the background's identity changes, zero hosts right after, the wallet comes back
locked, and the recovery path lands `ok` on exactly one new visible host with a new generation.

**Open for the owner:** keep `runtime.reload()`, or swap in the spike's privileged termination as the
mechanism in a follow-up (the driver method and the spec's assertions stay; only the two lines that end
the page change). Follow-up 1 (porting the Chrome background-kill files) needs the privileged call either
way, since those specs kill the background under a live popup.

## Gate

| Command | Result |
|---|---|
| `bun run lint` | exit 0 (one formatting diagnostic, fixed with `biome format --write`) |
| `bun run --cwd apps/extension test -- scripts/e2e/firefox-driver.test.ts scripts/e2e/browser-seam.test.ts` | 55 passed (2 files) |
| Firefox, the two new specs (proverless, `--retry=0`) | exit 0 — 2 passed first run: restart 28.6 s, host-state 21.0 s |
| Chrome, the two new specs (proverless, `--retry=0`) | exit 0 — host-state passed, restart spec skipped by browser |
| Firefox smoke (`build:firefox` with the fixture flags, then `test:e2e -- --retry=0`) | exit 0 — 128 passed / 16 skipped (32 files / 4 skipped), the reference exactly, 11.6 min |
| Firefox network, full, proverless, `--retry=0` | exit 0 — 119 passed / 13 skipped (88 files / 8 skipped): the spike's 117 / 15 plus the two new specs, 46 min, no retries |
| Firefox, one real proof (`tx-sendTx-default`) | exit 0 — 1 passed, 85.4 s with in-browser proving under Firefox's own throttling (the spike's masked reference was 65.7 s framed, 88.3 s in the window) |

Every e2e step ran alone on the host, in this order, at retry 0. The whole battery took 63 min.

## Worth knowing

- The e2e tree is not typechecked by any repo script: `apps/extension/tsconfig.json` includes only `src/**`.
  A one-off `vue-tsc -p` over `tests/e2e/**` reports 341 pre-existing errors (vitest fixture typing, Aztec
  type drift); the four in the new files were two implicit `any`s (fixed) and the fixture-name artifact every
  spec shares. Lint and the run are the only gates a new fixture gets.
- `extension.views` on the add-on's `Extension` (from `WebExtensionPolicy.getByID`) lists every page
  context with a `viewType`; the background's is `"background"` and its `xulBrowser.messageManager`
  takes a frame script exactly like the action popup's. That is how a test reads the background page's
  DOM without touching production code.
- `runtime.reload()` from a popup page: the evaluation never returns (the page dies), the temporary
  add-on keeps its per-profile UUID, the new background is up within a few seconds with no frames, and
  the wallet is locked — the same recovery recipe as the Chrome canary's stage 5 lands a send in ~29 s
  end to end.
