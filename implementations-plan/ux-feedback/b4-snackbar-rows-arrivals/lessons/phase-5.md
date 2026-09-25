# Phase 5 · Parity and arc gate (in progress)

P5.1's captures were taken before this round: 14 surfaces on Chrome and on Firefox, outside the
repo with their manifest. None of the fixes below changes what a capture shows. The icon's
pointer pass-through, the leaving card's controls and the senders glyph look the same at rest,
and none of the other fixes touches a captured state.

## Arc fix loop

### Round 1 · codex · changes-requested (high)

GPT-6 Astra, session `01a0d7e5-f11d-7982-968c-b68e49a09382`, on `a3b5619f..12b24a1c`. The
coordinator accepted all nine findings. Each fix is its own commit, and each test was written
first and shown red on the pre-fix code, except where a row says otherwise.

| # | Severity | Finding | Fix (commit) |
|---|---|---|---|
| 1 | major | A token add resumed after `readTip()` restored `trusted` and wrote a pending floor on a token, network or profile deleted meanwhile (`incoming-transfer/service.ts`) | The section rechecks `isCurrent()` and the token's registration before either write (`f2939320`) |
| 2 | major | During a same-kind replacement, View or × on the still-interactive leaving card ran the new snack's action or closed it (`ToastManagerBase.vue`) | Each control is bound at render to its card's snack id and does nothing once that snack is not the one shown (`ca4bb12b`) |
| 3 | minor | The activity icon box, positioned for its badge, painted above the stretched link, so a press on it opened nothing (`TransactionCardLayout.vue`) | `pointer-events: none` on the icon box and badge; a real-pointer press at the icon's centre in `rows.test.ts`; the icon gains the `activity-icon` testid (`f5b0c621`) |
| 4 | minor | Home, then another route, then Home again within 2.6 s replayed an already-claimed arrival (`useArrivals.ts`) | Leaving a route retires the windows judged on it (`5e71e012`) |
| 5 | minor | An older token lookup could install its chip over a newer one, including after a Home, elsewhere, Home round trip (`useArrivals.ts`) | A chip installs only in presentation order and only on the route visit that presented it (`f9e5cd2c`) |
| 6 | minor | The contact Ctrl-click case swallowed the destination wait and only logged where the tab went (`rows.test.ts`) | The swallowed wait and the log are gone. The title and assertions claim only what the row builds: a modified click on the row's deep link, left to the browser, a new tab, and the origin still on Contacts. Send is not asserted, since the cold-tab landing is held for the owner (`b8aaf53f`) |
| 7 | minor | A zero-value receipt got the green row, the chip and a "Received 0 …" snack (`useArrivals.ts`) | `isArrivalEligible` requires an amount above zero, and an unparsable amount counts as none, so the service's claim refuses it too. UI impact row 14, sign-off pending (`fe3661d5`) |
| 8 | minor | Copying a sender swapped the focused `RowAction` for a span for 2 s, dropping keyboard focus (`senders/index.vue`) | The button stays and switches its glyph. Inline styles keep the check's look (no pointer, green through the hover and focus fill). A press while the check shows copies nothing, as the span did (`f16810b7`) |
| 9 | minor | `arrival-state.ts`'s header promised that a receipt sent after a floor lands above it; `snackbar.test.ts` still called the copy target an svg | Both corrected (`a9501851`) |

What each failing-first test showed:

1. **The service scenario.** "A token deleted while its add reads the tip gets neither trust nor a
   floor back" found `{ state: "trusted", arrivalFloorPending: true }` on the deleted contract.
   After the fix, two existing floor tests failed. They added tokenB, which their token stub never
   listed, while the real `addToken` persists the token before it emits. They now register it.
2. **`ToastManagerBase.test.ts`**, with 0.15 s transitions and stepped rAF. View on the leaving
   card A recorded `["B"]`, B's action. × on it left `toast` empty, because it closed B.
3. **`rows.test.ts` on Chrome**, retry 0, on a build without the CSS. `elementFromPoint` at the
   icon's centre was `activity-icon`, not the row (`tx-card`).
4. **Two `useArrivals` cases.** The returning row carried `data-arriving="true"` again: Home →
   Settings → Home, and History → Home → History.
5. **Two `useArrivals` cases.** The older presentation's chip (`note:p|n|7`) replaced the newer one
   (`…|8`), and a lookup held across the round trip installed its chip on the return.
6. **Test-only, so there is no product code to go red.**
   - A probe on the pre-edit spec logged what the new tab reports. On Chrome it was the deep link,
     then `#/popup/auth`, then `#/popup/general` (the held cold-boot bounce). On Firefox it was only
     `about:blank`.
   - The new tab's URL can therefore be witnessed on Chrome only, and on Firefox only through a
     new `BrowserDriver` capability. That was not added: it is scope. The spec's comment says why
     the click remains the witness.
7. **`isArrivalEligible`** returned true for `"0"`. The `useArrivals` case opened one snack for
   the zero receipt.
8. **The new `senders/index.test.ts`**, on the pre-fix page: the copy button was gone after the
   press (`expect(copy().element).toBe(button)` on an empty wrapper).
   - The first draft failed at mount on both pages: `RowAction` and `Flex` do not resolve in a page
     test and rendered as unknown elements.
   - Rerunning on the fixed page caught that. The test registers them, and the red was re-shown on
     the pre-fix page copied in from `git show`.
9. **Comments only**; no test.

Rejected: none. Row 6 adapts the coordinator's example: the deep-link URL is asserted nowhere,
for the reason above.

Gate after the round:

| Command | Exit | Duration |
|---|---|---|
| `bun run lint` (29 warnings, 3 infos, none in changed files) | 0 | 1 s |
| `bun run typecheck:all` | 0 | 39 s |
| `bun run test:all` (extension 7,408 passed, 4 skipped, 7 todo; design 393; every workspace green) | 0 | 111 s |
| `bun run test:ci-gating` (138 pass, 2 skip) | 0 | 23 s |
| `network/incoming-arrival.test.ts`, Chrome, proverless, `NULO_E2E_RETRY=0` (7 tests) | 0 | 432 s |
| the same on Firefox (7 tests) | 0 | 394 s |
| Chrome smoke build with the gate's flags | 0 | 10 s |
| `snackbar`, `rows`, `contacts` specs on Chrome, retry 0 through a scratch config spreading `vitest.e2e.config.ts` (14 tests) | 0 | 61 s |
| Firefox smoke build with the gate's flags | 0 | 9 s |
| the same three specs on Firefox, retry 0 (14 tests) | 0 | 80 s |

Probes during the round, all with the scratch retry-0 config:
- `rows.test.ts` on Chrome: red before fix 3, green after it.
- The contact case on Chrome and Firefox, for row 6's URL question.
- `rows.test.ts` on Firefox after fix 6: green.

The smoke builds and specs ran after the network runs, since `e2e:agent` rebuilds `dist/`.
