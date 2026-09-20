# Phase 10 — the toolbar popup in a Firefox panel

## The first hypothesis was wrong, and only a measurement said so

Reading the stylesheet, the footer looked safe: `position: absolute; bottom: 0` in a shell whose height chains off `100%` with `min-height: 600px`. So the guess was the *panel* — Firefox re-measuring it per route, or handing it a viewport shorter than 600. The planned fix was a surface-detected fixed height.

Measured in the real panel instead: panel, `html` and `body` are a steady 360 × 600 on every tab. `#app` is 520 / 320 / 456 / 600 px on Home / Holdings / History / Settings — its content height. Firefox lays a panel's document out to find its preferred height, so the percentage chain is indefinite there; `body` reaches 600 through `min-height` alone, and a `100%` child of a box sized only by `min-height` resolves as `auto`. The guessed fix would have shipped surface detection that the problem did not need. The real one is one declaration: `#app { height: 100vh }`.

## Reaching a panel

No WebDriver or BiDi command reaches a panel's document, and Puppeteer lists no page for it. What works, headless: geckodriver's `--allow-system-access` (already on), the session's `moz:context` switched to `chrome`, `browserActionFor(extension).openPopup(window, true)`, and a frame script loaded into `.webextension-popup-browser`'s message manager, where `content` is the popup's window.

One trap: `moz:context` is a property of the whole session, and `watchForSilentCloses` reads the window-handle list every 150 ms. Inside the switch that list is Firefox's *own* windows, so two ticks later the watcher would report every page closed. `chromeScript` and the watcher's read now go through the same exclusive queue.

## The scrollbars, and what the CSS pass found

`*::-webkit-scrollbar { display: none }` was the popup's whole scrollbar policy, and Firefox does not implement the pseudo-element. The standard `scrollbar-width: none` now sits beside it in the shared `base.css`. Headless Firefox here only has overlay (zero-width) scrollbars — an `overflow: scroll` probe measured 0 px even with `ui.useOverlayScrollbars = 0` — so the layout-taking kind the owner saw on macOS could not be reproduced on this machine; the owner's headed check is the evidence for that one.

`base.css` is hash-pinned by `packages/design/src/base.css.test.ts`, and the root `bun run test` runs the extension workspace only — it stayed green with the pin broken. `bun run test:all` is the command that sees it. Worth remembering for any change under `packages/`.

The static inventory is small (14 prefixed constructs, 26 sites) because the design system is mostly standard CSS; the screenshot diff is what gives confidence, and it is cheap: one scratch test that walks 16 routes and `page.screenshot()`s each, run once per browser, plus a canvas diff. Window mode only — panel-only behaviour is the percentage-height class above, which the panel test now covers.

## Evidence

- `action-popup-layout.test.ts` on a Firefox build with the old stylesheet: **fails** (`expected … to match object { shellHeight: 600, navBottom: 600 }`). With the fix: **passes**, 5 s.
- Candidate fixes were tried by injecting CSS into the live panel before any rebuild: `#app{min-height:100vh}` and `#app{height:100vh;min-height:var(--base-height)}` both put the nav at 600 on every tab; the second keeps `#app` a definite height, as it is on Chrome.
- Before/after screenshots of the real panel (`drawSnapshot` of the panel's browsing context) are on the arc's PR.
