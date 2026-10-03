# Arc 4, visual-shells-b: lessons log

## Build

- **Phase 1, the token sweep (c519b8d9).**
  - 12 hairline literals now read `--hairline-soft` or `--hairline-strong`.
  - Five overlays read their scrim token.
  - The capabilities table drops its dark override, which restated the shared value. Its light override stays.
- **Phase 2, the detail-page shell (4d4d40b8).**
  - The tx, received and journal pages compose nine new shared rules from `popup/pages/detail-page.module.css`, plus its existing `details_box`, and share one timestamp format.
  - Received's static from card now outranks the shared card rule on specificity. Source order cannot decide it, because a composed module loads with whichever detail chunk arrives first.
  - Journal drops three `origin_*` rules that no element used.
- **Local gates, green on each phase:** lint, `typecheck:all`, `test:all`. On the head, `audit:vue` and `test:ci-gating` are green too.

## Harness

The harness is shared with arc 3, and every edit to it was additive.

- **`installPortStub(page, spec)`** generalizes arc 3's `note` stub. It answers only the listed methods on the listed ports, counts what it served, and passes every other port through to the real background.
- **`busy`** is a per-surface list of selectors that the settle step ignores. A listed element must be visible before the wait and still there after it, and no animation may be running once the freeze is applied.
  - The passkey dialog uses it.
- After the harness edits, arc 3's notes, contacts and token-detail surfaces were rerun against their own base and head: 24 of 24 identical.
- **Surfaces: 32 per theme**, each captured on Chrome and Firefox in dark and light.
  - Covered: the activity feed and cards, the bottom nav, glossary, the receive popup, migration-blocked, the legal sheet, the capabilities window (top, rows, details, cancelled) and the passkey dialog.
  - Detail pages run in two visit orders:
    - received-first (A): received, tx, mint, journal, journal with Developer Mode, then received and tx again;
    - tx-first (B): tx, received, tx.
  - The fee card on Send closes the list.
  - 17 surfaces carry a computed-style probe that walks rest, hover, active and focus.
- **The tx hash link's colour is asserted on every tx visit**, against probe spans of the two text tokens:
  - secondary on a first visit, whether received or tx came first;
  - primary once received has loaded, in both orders.

  That chunk-order flip is today's behaviour, and the base pins it. Phase 2 reproduces it exactly.

## GlobalLoader spike (failed, deferred)

- **Chrome:** an `evaluateOnNewDocument` preload made the profile port's open throw synchronously, so the client never retried and the loader stayed up. Base against base was 4 of 4 identical.
- **Firefox:** the preload never ran in the moz-extension document. It failed both when the driver navigated over WebDriver classic and when the page navigated itself (`window.__hdPreload` stayed missing).
- **Result:** with two attempts inside the timebox, the spike counts as failed. `GlobalLoader.vue` keeps its literal scrim, and the plan's Deferred list names it.

## Surprises

- **The capabilities route is `#/windows/capabilities`, not `#/popup/windows/...`.** The plan had it wrong; it is corrected.
- **The hover surfaces failed their own after-shot colour check.** The pointer was still on the link, so the check read the hover colour. The leave step now moves the pointer off first.
- **A refused Testnet RPC could not hold the fee card degraded.**
  - In some captures it never degraded inside 5 minutes; in others it degraded inside 2.
  - The background's gas reader keeps a 5-minute cache, the popup store keeps a ready slice, and the store's own retry flights outlive a page reload.
  - The surface now takes the live testnet state, as Home already does. That state is sponsored, with the method and priority rows and no notice. It is pinned as an exact fingerprint that must still hold after the shot, and every `detail_row` in the card is probed. A failed live read fails the capture; it never produces a false identical.
- **The suite's `setDeveloperMode` leaves Settings as soon as the toggle flips.**
  - Once, that dropped the config client mid-write, and a sticky "Failed to update setting" snack then blocked the next surface's settle.
  - The batch toggles through its own helper instead. It stays on the page until the write lands and fails on a snack.
- **Two counts were read once instead of polled.** The token feed rendered after the read on Firefox, so both counts now poll.
- **Arc 3's evidence was overwritten.** One rerun of arc 3's surfaces rewrote `shots/visual-shells-a/` while arc 3 was in review. After that, `visual-shells-a` runs were left to the coordinator.

## Screenshots

- **Phase 0 stability, 0abf63a3 against itself:** 196 of 196 identical. That is 64 shots plus 34 style probes per browser, on Chrome 152 and Firefox 153.
- **Forced diff, base against a throwaway dist:** the throwaway was the combined tree with three changes: the nav hairline at 0.4, the popup scrim at 0.6, and `card_static` dropped. 52 differed and 144 matched.
  - The nav line differed by 1,440 px on every surface that shows the bottom nav.
  - The receive popup differed by 77,760 px on Chrome and 78,480 on Firefox.
  - The from-card hover differed by about 32,500 to 33,000 px.
  - The received probes differed by 44 leaves on Chrome and 46 on Firefox, and the home probe by 2.
  - Every other surface matched.
- **Phase 1, 0abf63a3 against c519b8d9:** 196 of 196 identical on both browsers. The two builds' CSS hashes differ, so the run compared changed CSS.
- **Phase 2, c519b8d9 against 4d4d40b8:** 196 of 196 identical, with every hash-link colour assertion in both orders holding on both browsers.
- **Final stability, 4d4d40b8 against itself:** 196 of 196 identical on both browsers.

## Deferred

- **`GlobalLoader`'s scrim literal:** see the spike above.
- **Q-22 (f) and Q-22 (i):** deferred, as the plan records.
