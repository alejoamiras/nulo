---
plan: ux-feedback/b2-window-placement
tier: light
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
eli5_mode: artifact
eli5: https://claude.ai/artifact/Bw5Fq5mD7HDBaQNsGpMfLY
program: implementations-plan/ux-feedback/plan.md (batch 2, arc 2 of 6)
arc_branch: feat/ux-2-window-placement
design: implementations-plan/ux-feedback/design/spec.md (item 4, option A)
artifact: https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF
---

# Batch 2 · Window placement

Item 4, option A, of the UX program: every dApp window opens at the top-right of the browser
window, no taller than it, and a refused position never stops the window from opening. Arc 2 of
the program's six-PR stack, on top of batch 1 (first run and wording); later arcs build tooltips
and the glossary (3), the snackbar, rows and arrivals (4) and the permission window (5a, 5b).

**The design is the artifact**, <https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF>, quoted by
[`../design/spec.md`](../design/spec.md) § Item 4; shot `04-window-placement`. Recon:
[`recon.md`](recon.md).

## Phase 0 (pre-answered by the program)

Recorded from `implementations-plan/ux-feedback/plan.md` § "Phase 0, answered for every batch";
no clarifying questions were asked.

- **Success**: item 4 A built exactly as the spec says for all four dApp windows (connect,
  permissions, execute with its signing approvals, the emoji check); parity evidence published;
  every gate below green on Chrome and Firefox.
- **Who and what excellent looks like**: the program's Outcome & Quality Bar, plus this batch's
  line (below).
- **Scope**: item 4 A only. Out: option B (one connect window, a follow-up), the passkey window,
  the JSON viewer, the logger, legal links, the onboarding windows, anything inside a window,
  `apps/tools/**`, `packages/bridge-core/**`, the `@aztec/*` line.
- **Constraints**: pre-production, no storage migrations; Bun 1.4.2; the account freeze
  untouched; complexity budgets hold with no new acceptance; no new permission (no
  `system.display`).
- **Quality bar**: production.
- **Validation layers**: typecheck and lint, unit, smoke e2e on Chrome and Firefox, the whole
  network e2e suite on Chrome and Firefox (every dApp window in it opens at new native bounds).
- **Surface vs delegate**: UI decisions come from the spec (owner); technical decisions go to
  `/codex high` and are logged in `lessons/`.
- **`/code-review`**: off. **`/harden`**: not scheduled.

## Outcome & Quality Bar

For whom: anyone who clicks Connect or Send in a dApp and looks for the wallet's answer.

Excellent means:

1. **Nulo answers in one place.** The connect window, the emoji check, the permissions window and
   every transaction window open at the browser window's top-right, where the toolbar icon is, so
   the app's own verification grid stays in view beside the wallet's.
2. **It fits.** No window is taller than the browser window it belongs to; on a short screen it is
   the browser's height and its content still reaches its buttons.
3. **It always opens.** A position the browser refuses is retried once with the size only; the
   emoji check never ends a dApp's session over where it would have opened.

Good enough: nothing inside a window changes; windows the spec does not list keep their placement.

## Round-5 picks

None needed: the program lists no undrawn state for batch 2, and the spec draws the one surface.

## UI impact

| # | Surface | Before → after | Shot | Sign-off |
|---|---|---|---|---|
| 1 | The four dApp windows: discover (connect), capabilities (permissions), execute (transactions and their signing approvals), verify (emoji check) | discover, capabilities, execute: centered on the last-focused browser window, 800 tall; verify: wherever the browser puts it, 800 tall → all four: right edge and top of the last-focused browser window, `min(800, browser window height)` tall; retried with the size only when the position is refused. Nothing inside changes | `04-window-placement` | i4 "A + B", with "B (one connect window) is a follow-up arc, not this one" (owner, 2026-09-23): A now |

The passkey window is not a dApp window and keeps `centerOn` at 500×800.

## Architecture & Implementation

### Placement (`wallet/services/window-manager/window-manager.ts`)

- `topRightOf(anchor, width, height): { left?: number; top?: number; height: number }`, beside
  `centerOn`: the anchor's right edge and top, `height` capped by the anchor's height. Its comment
  keeps the two constraints the arithmetic doesn't show: signed coordinates, never clamped (a
  display left of or above the primary is negative), and no position with the requested height
  when the anchor is missing or partial, so the browser picks the spot as it does today.
- `createPlaced(windows, options, stillWanted, logger, source)`: `create(options)`; when that
  rejects, `options` carried a position and `stillWanted()` is still true, one more `create` with
  `left` and `top` removed, everything else identical. A size-only create is never retried; a
  retry that is no longer wanted, or a second rejection, propagates. The recovered refusal is
  logged at `debug` as a constant message: no error, options or URL (the logger keeps error
  messages, and `scrubUrls` does not recognise `chrome-extension://` or `moz-extension://`, whose
  URLs carry the verification hash and request ids).
- `OpenAndAwaitOpts` gains a required `placement: "center" | "top-right"`. `"top-right"` resolves
  `topRightOf` inside the existing `.then(anchor => …)` continuation and creates through
  `createPlaced` with `stillWanted = () => this.handles.get(handleId) === handle`, so a handle
  settled during the first attempt gets no second create. `"center"` keeps today's `centerOn` and
  plain `create`: the passkey window's behaviour does not change.
- The continuation's own fences, which the retry now leans on: the final `.catch` settles only
  when `this.handles.get(handleId) === handle` (it settles by id today, so a late rejection could
  reach a re-minted handle), and the two stray-window `remove` calls catch their rejection. Its
  failure is logged as a constant message and settles with "Failed to open window.", the reason
  the missing-id case already uses, instead of the browser's raw message.
- Callers: `dapp-interaction/service.ts` passes `placement: "top-right"` (execute, capabilities,
  discover share the one call site); `passkey/service.ts` passes `"center"`.

### Anchor (`core/adapters/chrome-browser-api.ts`)

- Firefox ignores `windowTypes` in `windows.getLastFocused` and can return an approval popup
  (codex read the installed Firefox 153.0.4 implementation; MDN documents it). Remembering only
  the adapter's own answers is not enough: after an approval from window A, the user can focus
  normal window B, return to the approval popup, and a new request then needs B. So the adapter
  tracks normal-window focus itself:
  - `lastNormal: { id, seq }`, written by the tracker and by every normal answer of
    `getLastFocused`. Each observation takes a sequence number when it starts (a focus event, or
    the lookup's call), and a result only overwrites an older one, so a slow `windows.get` cannot
    replace a newer observation.
  - `onFocusChanged` → ignore `WINDOW_ID_NONE` → `windows.get(id)` → record it if `type` is
    `"normal"`. Rejections are swallowed; a window that closed is simply not recorded.
  - Each focus lookup's promise sits in a `pending` set until it settles.
  - `getLastFocused()`: a `"normal"` answer is the browser's own and returns its bounds, as
    today. Any other answer first awaits a snapshot of `pending`, the focus events already
    received, but not later ones. It then re-reads `lastNormal` with `windows.get` and returns
    its bounds when that window still exists and is normal, else `undefined`. It still never
    throws. Without the wait, focusing B and returning to the popup before B's lookup lands would
    anchor on A.
  - **Firefox only, registered on first use.** The listener is added by the first
    `getLastFocused()` call, and only when `chrome.runtime.getBrowserInfo` exists (a Firefox-only
    API). Both conditions keep the background from waking on every window switch. Chrome records
    every listener a service worker adds as a wake-up and keeps it when the worker stops, whenever
    it was added. Firefox persists only listeners added while the background is starting. Chrome
    honours the filter, so it needs no tracker.
  - The first lookup after the background starts sees only the browser's answer. When that answer
    is a popup, the window opens with the size only, as the emoji check does today.
  - The comment on the tracker says why it exists (Firefox ignores `windowTypes`) and why it is
    registered late and only there (the wake-up rules above), in two sentences. No new
    permission.

### Emoji check (`wallet-sdk/session-established.ts`)

- `SessionEstablishedDeps.windows` widens to `Pick<WindowPort, "create" | "remove" |
  "getLastFocused">`; production already passes the full port.
- `openVerifyWindow` reads the anchor **before** `markInFlight()`, then claims and creates with no
  await between them: a session that ends during the lookup leaves an unstarted slot that
  `releaseIfUnstarted` and expiry can still reclaim, and no window opens. The failed-claim throw
  stays outside the `creationFailed()` try, as today. The create goes through `createPlaced` with
  `topRightOf(anchor, 400, 800)` and `stillWanted = () => deps.isSessionLive(session.sessionId)`.
  One claim covers both attempts: `creationFailed()` only after the terminal failure,
  `adopt(windowId)` on the window that opened, and the missing-id and abort paths as today.
- A terminal failure rethrows a constant error ("verify window could not be opened"), so the
  fail-closed catch never logs a browser message that could carry the window's URL.
- The one comment added there: hold the reservation across both attempts; release only after the
  terminal failure or the window's removal.

### e2e contract

- New network spec `tests/e2e/network/window-placement.test.ts`:
  1. Focus the dApp's browser window and capture its window id explicitly (Firefox gives each
     extension control page a normal window of its own, `fixtures/browser/firefox.ts:332`, so
     "the" normal window is never assumed). Normalise it with `chrome.windows.update` to
     `state: "normal"`, on-screen bounds wider than 400 (so right alignment differs from left) and
     shorter than 800 (so the height rule bites); await it, read the bounds back, assert both,
     and derive every expectation from what the browser reports.
  2. Walk connect → emoji check → permissions → one `sendTx`, arming each `waitForPopup` before
     the action that opens it (it ignores targets that already exist, `fixtures/popups.ts:36`).
  3. On each window: drop Puppeteer's viewport emulation (`page.setViewport(null)`; the Chrome
     launch sets no `defaultViewport`, so every wrapped page is emulated at 800×600 whatever its
     native size), poll `chrome.windows.getCurrent()` from the window's own page until its bounds
     settle, then assert `left + width` is the anchor's right edge, `top` its top, `height`
     `min(800, anchor height)`. The content check does not equate inner and outer sizes, since
     outer bounds include the frame: `page.viewport()` is `null`, and `innerWidth`/`innerHeight`
     are positive and no larger than the measured outer width and height, with no assumed
     decoration offset.
  4. The final approve or reject in each window goes through `pointerClick`
     (`helpers/legal-drivers.ts:69`) after the existing readiness waits. It scrolls the control
     into view, proves with `elementFromPoint` that nothing covers it, and clicks with the real
     pointer. `clickByTestId` checks only that the element has a size, so a clipped button would
     pass it. Other suites keep their helpers.
  5. The anchor case, three distinct candidate corners:
     - A `sendTx` from the dApp window A opens execute window W1 at A's corner.
     - Open a second normal window B with its own distinct bounds, focused. Move W1 to a third
       spot and focus it again.
     - While W1 stays focused, fire a second request from A's page with a page-context click
       (`page.evaluate` on its `data-testid`). `clickByTestId` and `prepareClick` focus their page
       on Firefox (`extension.ts:1430`, `browser/firefox.ts:354`) and would hide the bug.
     - The new window opens at B's corner, not A's or W1's.
     - Every `chrome.windows` call runs by `page.evaluate` in a page that is already open, so no
       control window takes focus during the sequence.
     - Which second request the playground can issue while W1 is pending is settled in P3.
  Selectors by `data-testid` only; the existing dApp fixtures drive the walk.
- Firefox: the same spec. Firefox 153 supports positioning popups and may clamp coordinates; a
  headless limitation is separated from an implementation error with evidence before any Firefox
  assertion is narrowed, and a narrowing is recorded in this plan, `FIREFOX.md` and
  `lessons/phase-3.md`.
- The recon's addendum overstated the suite-wide effect: content in Chrome e2e is emulated at
  800×600 regardless of native size, so existing clicks do not start exercising a shorter layout.
  The whole network suite stays the arc gate (native bounds change for every dApp window), and the
  new spec is what exercises the native layout.
- No existing test changes expectation; a spec that breaks because its window moved or shrank is a
  bug to fix, never an assertion to loosen (program § Tests).

## Security & Adversarial Considerations

- **Geometry is not a trust signal.** Position and height come from browser APIs; a page can
  still influence them indirectly (it can take focus, and resize windows it opened within the
  browser's limits), and the size-only fallback lets the browser choose the spot. Nothing here
  authenticates the window: the emoji check does, and placement only keeps both grids in view
  (shot: "Both grids in view"). No geometry is returned to the dApp, and the dApp supplies no
  value to `windows.create`.
- **Anchoring on the wallet's own windows.** Firefox can answer the anchor query with an approval
  popup. The adapter falls back to the last normal window focused, as its own listener saw it, so
  a moved popup cannot drag the next window with it. The listener records only a window id, and
  only on Firefox. It never wakes the background: it is added after startup, and Chrome, which
  would keep it as a wake-up, never gets one.
- **Fail-closed stays fail-closed.** The emoji check still terminates the session when no window
  can be opened. The retry runs once, only while the session is live, under the one reservation
  claimed for the attempt, so it cannot bypass admission or back two windows with one slot. A
  session that ends during the anchor lookup never claims its slot.
- **Stale handles.** A handle settled during the first attempt gets no retry; a window that
  arrives for a settled handle is closed; a late rejection settles nothing but its own handle.
- **Logs.** The recovered refusal and the terminal failure are constant messages; no URL,
  verification hash, request id, bounds or raw browser error reaches a log line or the dApp.
- **Multi-display.** Negative coordinates pass through unclamped, as `centerOn` does.
- No storage shape change, no new permission, no new dependency.

## Assumptions

### Facts (verified in recon or by reading the file)

1. `openAndAwait` has two callers: the dApp interaction service (execute, capabilities, discover,
   400×800) and the passkey service (500×800); both center today (`window-manager.ts:88-99`).
2. `openVerifyWindow` creates 400×800 with no position, inside a try that marks the reservation
   failed and rethrows into a fail-closed catch that terminates the session
   (`session-established.ts:178-215`, `:157-167`).
3. `getLastFocused` asks for normal windows, returns `undefined` rather than partial bounds and
   never throws (`chrome-browser-api.ts:188-199`). Firefox ignores the `windowTypes` filter there
   (codex, installed Firefox 153.0.4 and MDN), so on Firefox it can return a popup. The adapter
   has one owner in production (`wallet/index.ts:63`).
4. Chrome refuses `windows.create` bounds that leave a window less than half on screen (the spec's
   limit line; the rejection's wording is not relied on).
5. There is no `/windows/sign` route; signing approvals render in the execute window.
6. Chrome e2e runs with `--window-size=400,600` and no `defaultViewport`
   (`fixtures/browser/chrome.ts:31-39`), so Puppeteer emulates every page it wraps at 800×600.
7. A verify reservation is reclaimable (`releaseIfUnstarted`, expiry) only while unstarted;
   `markInFlight` ends that (`verify-admission.ts:70-124`).
8. The logger keeps error messages, and `scrubUrls` handles `http(s)`/`ws(s)` only
   (`logger/utils.ts:169`, `utils/scrub-urls.ts:24`).
9. Chrome records a wake-up listener for every `addListener` in a service worker, whenever it is
   called. A worker's stop does not remove it. Chromium's
   `extensions/renderer/bindings/api_event_listeners.cc` passes `supports_lazy_listeners_` on add
   and `update_lazy_listeners = false` on invalidation.
10. Firefox persists an event-page listener only while the background is still starting:
    `ExtensionCommon.sys.mjs`, `recordStartupData = !!this.context.listenerPromises`, which is
    nulled once the background has started.
11. The Firefox build is an event page (`persistent: false`,
    `manifest/manifest.firefox.config.ts:41-45`). One bundle serves both browsers, with no
    build-time browser flag (`vite.shared.ts:28-33`), so runtime code tells them apart by API
    presence, as `hasOffscreenApi()` does.

### Inferences

- A minimized anchor's bounds are refused by the browser and the retry opens the window with the
  size only; a rule for it is not drawn, so none is built (Ask 4).

### Asks → codex (decided in the plan audit)

1. A required `placement: "center" | "top-right"`: **approved**.
2. One shared `createPlaced`: **amended**, with a synchronous retry guard (the handle's identity,
   or the session's liveness).
3. Retry any positioned rejection, once: **approved**; matching the browser's error text is
   brittle.
4. A minimized-anchor rule: **rejected for this arc**, with the passkey change it implied; the
   spec does not draw one.
5. The e2e design: **amended** (the anchor id, normalisation, arming, viewport emulation,
   polling, the popup-anchor case).
6. Log level `debug`: **amended**, a constant message instead of the error.

UI asks: none. The spec draws the placement and the height; nothing inside a window changes.

### Plan audit ledger (`/codex high`, GPT-6 Astra)

Round 1: **conditional approve, confidence high**, conditions 1–8. All accepted, none rejected.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | major | `createPlaced` had no liveness input, so a handle settled during the first create could get a second window. The final `.catch` settles by id, and two stray-window `remove` calls go unhandled (`window-manager.ts:92`, `:108`, `:129`, `:135`) | `stillWanted` predicate; identity-checked `.catch`; caught removals; constant "Failed to open window." |
| 2 | major | Claiming the verify slot before the anchor lookup made it unreclaimable during the lookup (`verify-admission.ts:70`, `:109`, `:124`) | Anchor read before `markInFlight()`; no await between claim and create; failed claim outside the `creationFailed()` try |
| 3 | major | "`getLastFocused` excludes popups" is false on Firefox (`chrome-browser-api.ts:192`) | The adapter selects a normal window itself; the popup-anchor e2e case |
| 4 | major | Chrome e2e emulates every wrapped page at 800×600, so the suite cannot see the native layout (`fixtures/browser/chrome.ts:31`, `fixtures/popups.ts:54`) | `page.setViewport(null)` on measured windows; the recon corrected |
| 5 | minor | The e2e needed an explicit anchor id, normalised bounds, pre-armed `waitForPopup`, polling | Written into the e2e contract |
| 6 | major | A raw error can carry an extension URL, the verification hash and request ids past `scrubUrls` (`logger/utils.ts:169`, `scrub-urls.ts:24`) | Constant messages on every path; the sentinel test |
| 7 | minor | Routing passkey through `createPlaced` gave it a retry the scope excludes | `"center"` keeps plain `create` |
| 8 | minor | The security section overstated placement as protection | Rewritten: geometry is not a trust signal; comment list narrowed |

Round 2: **conditional approve, confidence high**, conditions 1–4. All accepted.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | major | Remembering the adapter's own answers keeps stale identity: A → focus B → back to the popup → a request anchors on A | The Firefox-only focus tracker, ordered by sequence; the three-corner e2e case with a page-context trigger |
| 2 | major | `clickByTestId` does not prove a control is reachable in the native-size window (`extension.ts:1432`) | `pointerClick` for the final approve/reject; content fits the outer bounds, no decoration offset |
| 3 | minor | P2 tested neither the sentinel on the verify path nor cancellation before the first rejection; the harness hardcodes `isSessionLive` (`session-established.test.ts:63`) | Both P2 cases added; a liveness flag the tests flip with `onSessionGone` |
| 4 | minor | The recon kept superseded entries, and the ledger linked a transcript that is not committed | Recon corrected in place; this ledger is inline |

Round 3: **conditional approve, confidence high**, condition 1. Accepted. Codex confirmed the
Firefox-only, first-use registration from both browsers' sources and saw no smaller
browser-agnostic way. Conditions 2–4 of round 2 are resolved.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | major | The fallback read `lastNormal` without waiting for focus lookups in flight. Focus B, refocus the popup, a request arrives before `get(B)` lands, and A's corner is used | The fallback awaits a snapshot of pending lookups (already received, not future ones); a deferred unit test |

Round 4 (confirmation): **approve, confidence high**, no findings. The snapshot wait fixes the
race without waiting for future focus events. Caught rejections settle it, and focus churn
cannot extend it. WindowManager's identity fence and the verify path's anchor-before-claim order
keep cancellation safe through the wait.

## Approval

**Approved under the program's standing approval** (`../plan.md` § Standing approval),
2026-09-24:

1. Phase 0 is the program's pre-answers.
2. Codex's final verdict is `approve`, confidence high (round 4, confirming the conditions of
   rounds 1–3).
3. Not applicable (tier `light`).
4. No Ask is open: the six technical Asks are decided above, and there are no UI Asks.
5. UI impact lists one spec surface (item 4 A).
6. Nothing outside item 4 A.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/ux-feedback/b2-window-placement/lessons/phase-N.md`.

### P1 · Placement maths and the window manager ☐

1. `topRightOf` (+ tests: the corner on a positive and on a negative-coordinate anchor, the height
   capped by a short anchor and left alone by a tall one, no position without a full anchor).
2. `createPlaced` (+ tests: a refused positioned create is retried once without `left`/`top`, the
   rest identical; a size-only create is never retried; no retry once `stillWanted()` is false; a
   second refusal propagates; the recovered refusal logs one constant `debug` line).
3. `placement` on `openAndAwait`; both callers; the continuation's fences (+ tests: top-right
   opens at the corner with the capped height; center is unchanged for passkey, no retry; a
   refused position still opens the window and the handle resolves; a handle cancelled during the
   first attempt gets no second create; a window arriving after cancellation is closed and a
   rejected close is swallowed; a stale rejection leaves a re-minted handle with the same id
   untouched; a sentinel error carrying an extension URL, a verification hash and a request id
   reaches neither a log argument nor the settle reason). The consumer suites
   (`passkey/service.test.ts`, `dapp-interaction/service.test.ts`) assert the placement each
   passes.
4. The adapter's normal-window selection and the Firefox focus tracker. Tests in
   `chrome-browser-api.test.ts`; its `stubWindows` gains `get` and `onFocusChanged`, and a
   `runtime.getBrowserInfo` toggle stands for Firefox:
   - Without `getBrowserInfo` (Chrome), no listener is ever added, and a normal answer returns its
     bounds as today. The existing fixtures gain `type: "normal"` with the same expectations.
   - With it, the first lookup adds exactly one listener, and later lookups add none.
   - Codex's sequence: answer normal A, focus B (normal), focus a popup, answer the popup. The
     result is B's re-read bounds.
   - Out-of-order `windows.get` results: an older focus result cannot replace a newer one, and a
     focus that started after a lookup wins over that lookup's answer.
   - B's lookup still pending when the popup answer arrives: placement waits for it and returns
     B, not the cached A.
   - `WINDOW_ID_NONE` is ignored.
   - `undefined`, never a throw, when the remembered window is gone (`get` rejects), is no longer
     normal, or was never recorded.

Gate: `bun run lint`, `bun run typecheck:all`, `bun run test:all` exit 0.

### P2 · The emoji check ☐

1. `SessionEstablishedDeps.windows` widened; `openVerifyWindow` reads the anchor before claiming,
   places through `topRightOf` and `createPlaced`.

   Tests go in `session-established.test.ts`, extending the reservation test at `:156` rather than
   copying its budget setup. `makeDeps()` gains `getLastFocused` and a `live` flag behind
   `isSessionLive` (it returns `true` unconditionally today, `:63`). Tests that end a session flip
   that flag together with `gate.onSessionGone()`, so the retry predicate is exercised, not just
   the reservation. Every existing test keeps its expectation. Cases:
   - Opens at the corner.
   - A refused position retries and the session stays live.
   - Both refusals, with sentinel errors: each rejection's message carries a
     `moz-extension://…/verify` URL, a verification hash and a request id. The session is
     terminated, `creationFailed` runs once, the thrown error is the constant, and a capturing
     logger's arguments, error messages included, contain none of the sentinels.
   - A session ended while the anchor is being read opens no window and leaves the slot
     reclaimable.
   - A session ended before the first rejection gets no second create. Establishment resolves
     `false`, and the slot is released once that rejection lands.
   - A termination during the retried create closes the window and holds the slot until its
     removal.
   - The missing-id path still fails closed.

Gate: lint, `typecheck:all`, `test:all` exit 0.

### P3 · e2e and parity ☐

1. Probe headless Chrome and headless Firefox (throwaway, never committed) and record what each
   honours in `lessons/phase-3.md`:
   - a positioned `windows.create`;
   - `windows.update({ focused: true })` feeding `getLastFocused` and, on Firefox,
     `onFocusChanged`;
   - `chrome.runtime.getBrowserInfo` present on Firefox's `chrome` namespace and absent on Chrome;
   - the second request the playground can issue while an execute window is pending.
2. `window-placement.test.ts` per the e2e contract.
3. Parity: capture each of the four windows at its native size (emulation dropped), and draw each
   window's measured bounds over its anchor's (an SVG drawn from the measured numbers, beside
   `04-window-placement`); publish one private Artifact; list every difference.

Gate: the new spec passes on Chrome and on Firefox; the parity Artifact URL printed.

### P4 · Arc gate ☐

1. Every row of the program's [Local gates](../plan.md#local-gates): lint, `typecheck:all`,
   `test:all`, `test:ci-gating`, `build`; full smoke on Chrome and on Firefox.
2. The whole network suite (`bun run e2e:agent`, no file filter) on Chrome and on Firefox,
   `NULO_E2E_RETRY=0`: every dApp window in it now opens shorter.
3. Flake bar: `window-placement.test.ts` three consecutive retry-0 runs on each browser.
4. `bun run e2e:reap`.

Gate: all of the above exit 0.

## Arc boundary

1. The codex fix loop (below) until a round has nothing material, three rounds at most.
2. Parity evidence re-captured if the loop changed a surface.
3. `gh stack push`, then `gh stack add feat/ux-3-tooltips-glossary`.

## Post-implementation (read by the implementing session)

The review loop is `/codex high` (GPT-6 Astra) on the arc diff (`feat/ux-1-first-run-wording`
...HEAD), resumed until a round reports nothing material, three rounds at most; `/code-review` is
off. Every codex prompt, initial and resumed, carries:

- *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
  extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
  problem. If code works and is clear, leave it alone."*
- *"Audit the comments for value per character. Flag any comment that narrates what the code
  visibly does, restates its line, references implementation plans / phases / reviews, or spends
  a paragraph where a sentence works — and flag places where a non-obvious invariant or
  constraint deserves a comment it doesn't have. Comments are permanent context every future
  reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
- The arc map: "this is arc 2 of 6; arc 1 (first run and wording) is below it, and later arcs
  build tooltips and the glossary, the snackbar, rows and arrivals, and the permission window on
  top of it", so seams reserved for later arcs are not flagged as dead code.
- The adversarial ask and the parity rule: "flag any UI that differs from the spec or invents a
  state it does not draw".

Each finding is fixed in its own commit or rejected with a reason in `lessons/phase-4.md`. Codex
is advisory: it cannot override the spec, the owner's picks, CLAUDE.md or this scope.

## Delivery

- Arc 2 of 6 on `feat/ux-2-window-placement`, stacked on `feat/ux-1-first-run-wording`.
- Commits: conventional, lower-case, signed; one per phase at least, fixes separate.
- `gh stack push` as checkpoints; no PR until the program's final pass (program Delivery).
- PR body (at submit): summary, the UI impact row, the owner's quote (i4, A now), the parity
  Artifact link, test evidence, the Firefox result from P3.

## Seeds

The program's `/goal` drives this batch. To resume this batch alone:

```
/goal Deliver implementations-plan/ux-feedback/b2-window-placement/plan.md. Done when the transcript shows every phase ✓ with its gate reported passing and LESSONS_FILE printed per phase, a quoted codex re-review with no new material findings, the parity Artifact URL, and gh stack view with feat/ux-3-tooltips-glossary on top. Never merge; UI questions the spec does not answer go to the owner.
```

```
/loop 15m Drive implementations-plan/ux-feedback/b2-window-placement/plan.md forward: read it and its lessons, git status, gh stack view; take the next unchecked step; run its gate; commit; on a decision use the spec, else /codex high for technical asks; hard limits stay hard.
```
