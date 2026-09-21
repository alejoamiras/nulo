# Phase 11 — absorbing dev into an open Firefox stack

## How the stack took dev

A cascade **rebase** (`git rebase --update-refs`) was refused by the session's permission layer as a destructive history rewrite. The stack took dev by **merge** instead: `origin/dev` into the bottom branch, then each branch into the one above it. Nothing was force-pushed, every reviewed commit keeps its SHA, and the PRs squash on merge anyway. `implementations-plan/index.md` conflicts at every arc that rewrites the plan's row (three times here); the resolution is mechanical — incoming lines minus the incoming copy of this plan's row, then this branch's own.

## The guards earned their keep

Three of the five integration faults were caught by static tests this stack had added, before any browser ran, each on the arc that owns the rule:

- `browser-seam.test.ts` — dev's new spec closed browsers directly, wrote `chrome-extension://` by hand and called `browser.waitForTarget`.
- `behavior-gating.test.ts` (twin-filter pin) — dev widened the Chrome e2e filters by two packages; the Firefox lanes had not followed.
- `pages-options.test.ts` (dev's) — told this stack its own `extensions: ["vue"]` would now be wrong: dev's test pins that the scan drops *exactly* the test modules, no more.

What they could not see is what only a Firefox run shows, and the guard now has one more rule because of it: a direct `page.reload()`.

## What a Firefox run found

| Symptom | Cause | Fix |
|---|---|---|
| Nine Terms-gate specs: `Navigation timeout of 30000 ms` | `page.reload()` on an extension page — the documented BiDi process-swap strand | `reloadExtensionPage`; shrink-only `RELOAD_DEBT` in the seam guard |
| S1–S3: `no such frame`, 3 s in, no test frame in the stack | `openOnboarding` evaluated in the setup popup after flipping `onboarding:completed`. `redirectToOnboardingTabIfNeeded` runs on mount, reads the flag, and on a wallet-less profile opens the tab and `window.close()`s. Firefox honours that close; Chrome ignores it on a tab no script opened — the same difference `openScratchPage` exists for | seed the Terms state **before** the flip; the flip is the last thing evaluated in that page |
| S10: the licences tab never found | The product works (a probe showed the tab in `tabs.query` and in the classic window list, status `complete`). Puppeteer's BiDi target map keeps a `tabs.create` tab onto `text/plain` at `about:blank` for good | driver method `waitForOpenedUrl` |
| `send-fee-privacy`: `UnsupportedOperation` at `createCDPSession` | the RPC refusal is CDP `Fetch` | `interceptRpc` on the driver; Firefox = one parent-process `http-on-modify-request` observer |

The first hypothesis for S1–S3 — that the popup *reacts* to the flag flipping — was wrong: the redirect runs once, on mount. The mount-time read racing the fixture's flip is what the code shows. Worth the five minutes to read `onboarding-tab.ts` before writing the comment.

## The Firefox request observer

`http-on-modify-request` in the parent process sees every HTTP channel before it connects, whichever context opened it — the event-page background, the PXE window, a popup. So unlike CDP there is no target to arm, no `waitForDebuggerOnStart`, no first request to race; the whole Chrome helper's complexity is absent. `channel.cancel(Cr.NS_ERROR_CONNECTION_REFUSED)` is what the page sees as a refused connection. The observer and its tally live on the browser window `chromeScript` always switches to (the first handle), which outlives every window a test opens; privileged scripts run in fresh sandboxes, but the observer service holds the observer strongly. `hits()` became async because Firefox reads it over the wire — and the spec asserts `hits > 0`, so the pass is not vacuous.

## Evidence

- Merged top, before this arc: `lint`, `typecheck:all`, `lint:actions` 0; `test:all` and `test:ci-gating` red on exactly the two guard failures above, green after the arc 4 and arc 6 fixes. Both builds 0 with `chunkCycleGuard` + `parseLimitGuard` active; WAR identical to arc 7; largest parsed file 4,138,965 bytes; `web-ext lint` 0 errors / 14 warnings; notices assertion 0 on both targets. Chrome smoke **137 passed / 7 skipped**. Firefox smoke 114 passed, **14 failed** — all in dev's two new files.
- This arc: `legal-acceptance.test.ts` 13/13 and `send-fee-privacy.test.ts` 1/1 on Firefox at `--retry=0`, first run.
