# Phase 6 · The owner's parity answers

The owner answered the parity page's thirteen calls on 2026-09-25. Code paths are relative to
`apps/extension/src/` unless they start with `packages/` or `tests/`.

## P6.1 · Above the footer (1c)

Built:

- `composables/snackInset.ts`: two directives and the host's inset. `v-snack-footer` marks a
  bottom action row and `v-snack-sheet` an open sheet; both register their element in a
  module-level registry. `useSnackInset(base)` returns the snack's distance from the viewport's
  bottom edge: `base` (76 with the nav, 12 without), raised to 12px above the highest registered
  footer whose top edge is on screen. It measures on the next frame after a footer or sheet arrives
  or leaves, a footer resizes (`ResizeObserver`, which catches a wrapping error line), the window
  resizes, anything scrolls, or a transition or animation ends. It also measures at once when a
  snack opens, so a card never rises at a stale height. The pure step is `snackInset(base,
  viewportHeight, boxes)`.
- `components/ui/ToastManager.vue`, the host: `useSnackInset(() => showBottomNav ? 64 + 12 : 12)`
  replaces the route-only inset. `ToastManagerBase` is unchanged: the package still takes a
  number and reads no store, route or page.
- New testids for the e2e: `send-footer` on Send's footer, `dapp-approval-footer` on the shared
  approval footer. No existing testid moved.

The surfaces (every page or window without the nav that has a bottom action row):

| Where | The row | Registered on |
|---|---|---|
| Send | the publish strip and Confirm Transaction (or Review send, Get Fee Juice) | `popup/pages/send.vue` `.bottom` |
| Import a profile, create a profile, import an account, change password, delete profile, the three export pages | the page's bottom bar (continue, agree, download, delete) | `components/composite/CollapsingHeroLayout.vue` `.bottom`, 8 pages |
| The lock screen | the Delete profile link | `popup/pages/auth.vue` `.footer` |
| Register | the Terms of Use and Privacy Policy line | `popup/pages/register.vue` `.terms` |
| Terms declined | Review the new Terms, Export a backup | `popup/pages/legal/declined.vue` `.actions` |
| The execute, discover and permission windows | the error line and Reject/Confirm (Approve, Allow) | `components/composite/DappApprovalFooter.vue` |
| The verify window | Always trust and OK | `popup/windows/verify/index.vue` `.footer` |
| Onboarding: learn, fees | Continue and Skip intro | `onboarding/components/OnboardingExplainer.vue` `.actions` |
| Onboarding: welcome | Create profile, Import profile | `onboarding/pages/welcome.vue` `.actions` |
| Onboarding: create | the cream submit button | `onboarding/pages/create.vue` |
| Onboarding: import | the method's buttons and Back to methods | `onboarding/pages/import.vue` `.ctas` |
| Onboarding: terms | Continue and its hint | `components/composite/LegalConsent.vue` `.actions` |
| Onboarding: Presto | Continue, or the skip link | `onboarding/pages/presto.vue` `.ctaSlot` |
| Onboarding: done | Open wallet | `onboarding/pages/done.vue` |

Not registered, because they have no bottom action row: the Settings pages' in-list buttons
("Add account", "Add endpoint", "Delete chain", the other "Add" buttons), the detail pages (a
transaction, a receipt, a journal entry, a connected app), About, Appearance, Glossary, Proving,
the security and export index pages, and the json, logger and passkey windows.

Decisions:

1. **The registry is DOM-side.** A directive on the row itself is the one place that knows the row
   exists, is mounted, and where it is. The alternative, a route-meta flag per page, cannot follow
   a footer that grows, a sheet's own row, or the onboarding CTAs that move with their content.
2. **The snack sits above the highest point the row's top edge reaches on screen: where it is now,
   or where it stops once the page is scrolled to its end.** Where the page cannot scroll further
   (a pinned row, or a long page already at its end) that is where the row is, as first built. In a
   window shorter than the page it is where the row stops, so the snack is clear of the row before
   a scroll brings it up: `scrollIntoView` and a click can land in one task, before the next
   measure. For a row at the page's end the result does not move with the scroll. The scroll
   listener stays for rows that do move with it (inside an inner scroll area, or above the page's
   end). A row off screen at both places moves nothing.
3. **Never below the base.** On a nav page a footer low enough to sit under the nav's inset changes
   nothing. No nav page registers one today.
4. **The inset moves at once**, as it did on a route change. There is no transition on `bottom`.

Sign-off pending (built as the closest existing pattern):

- The onboarding CTAs sit in the page flow, not at the bottom of the tab. The snack rides 12px
  above the row wherever the row is on screen, so on a short page it sits mid-tab, just above the
  button.
- The lock screen's Delete profile link and the register page's Terms line are links, not
  buttons; both count as the page's bottom row.
- The Settings pages' in-list buttons are not footers, so a snack there keeps 12px from the bottom
  and can cover a button in the list's last rows.
- In a window shorter than the page, the snack sits above where the footer stops at the end of
  the scroll, so before scrolling it sits 85px up, over the page's content (the execute window at
  400×500, a 600px page and a 73px footer).

Observed, not changed: the popup's Terms sheet (`components/LegalAcceptanceSheet.vue`) sits at
z-index 9000, above the snack's 2000, so a snack raised while it is open is hidden behind it. Its
consent row is registered (through `LegalConsent`), so the snack still rises above that row, but
the sheet hides it either way.

The regression this answers: `tests/e2e/network/window-placement.test.ts` fails from `6fbfdeb5` on
(1 test on Chrome, 2 on Firefox). Its 400×500 execute window raises the persistent "Couldn't
estimate fee" error, and the snack, 12px from the bottom, covered Reject's centre once
`pointerClick` scrolled it into view. The gate list left the spec out; arc 5a's full-suite run
caught it and bisected it to `6fbfdeb5`. 1c fixes it, but only with the end-of-scroll rule
(decision 2): as first built (`f38e1e77`) a row counted only while its top edge was on screen, the
footer's sat at 527 in the 500px viewport, and the spec still failed at `b3a51e73`. The footer is
73px (1px border, 16px padding, 40px buttons, 16px padding) and stops at 427, so the inset is
500 − 427 + 12 = 85px, before the scroll and after it. An early estimate of 68px measured from
Reject's top edge, not the footer's.

Checked for decision 2's one cost (a row with content below it on a page that scrolls would lift
the snack above where it stops): every registered row is the last in-flow content of its page,
window, sheet card or onboarding page. What follows is only an overlay (the passkey dialog, Send's
review sheet, the hero layout's overlay slot), and the sheets are bottom sheets (a stretching close
area above the card). So no row needed unregistering or measuring by its buttons.

Tests:

- `composables/snackInset.test.ts`, 19 cases: the pure step (the base, the highest footer, never
  below the base, a zero-height or off-screen row, a row below the fold counted where it stops, a
  pinned row and a long page at its end keeping their inset, a row peeking on screen while the
  page can still scroll); the host after a frame, a footer's removal, a sheet over the nav, two
  stacked sheets, a footer growing, a scroll, a transition end, an animation end and a resize, a
  window shorter than the page (placed before the scroll, unmoved after it), a snack opening
  before any frame, the base following its source, and disposal.
- `components/ui/ToastManager.test.ts`: a footer on a no-nav route lifts the card to
  `bottom: 92px` (600 − 520 + 12).
- `tests/e2e/network/snack-placement.test.ts`, new: on Send, a public→private send to an off-curve
  address fails the estimate and its error sits 12px (±0.5) above `send-footer`; in the execute
  window, a public transfer the account cannot fund does the same above `dapp-approval-footer`.
  Both then grow the footer by a 40px line and check the snack follows it. The execute case then
  cuts the viewport to 400×500 over the 600px page: the footer starts below the fold, the snack
  sits 12px above where it stops, and Reject and Confirm, each scrolled into view and hit-tested in
  one task as `pointerClick` does, are clear; at the end of the scroll the snack has not moved. An
  18px stand-in for the error line (the real one is a 14px icon beside 12px text) then grows the
  footer by 28px, so its top peeks onto the screen at 499, and the same holds.
- `tests/e2e/network/window-placement.test.ts`, unchanged, joins the gate: three runs per browser
  at retry 0, as the one spec that drives the approval footer under a persistent error.

## P6.2 · A first open runs its 6 s (2b)

Built in `packages/design/src/ui/ToastManagerBase.vue`:

- The hold no longer starts on `mouseenter`, and a card no longer re-reads `:hover` once it has
  risen. A card that appears under a still cursor gets the browser's hover events, so both held a
  snack the person never reached.
- The region follows the pointer with one passive capture `pointermove` listener on the document.
  When a card opens it notes where the pointer rests; with no position known yet, the first move
  after the open, anywhere, gives that spot. A `pointermove` on the card holds it only when it is at
  least a pixel from that spot on either axis. No hover event holds, and neither does a move the
  browser synthesises at the rest spot.
- Unchanged: focus entering the card holds it, `mouseleave` or focus leaving releases it, the
  remaining time resumes, and an error has no timer.

Decisions:

1. **Position, not event type, tells a person from the browser.** A synthesised move carries the
   cursor's last position; a person reaching the card moves it. Under a pixel apart counts as the
   same spot, since the two can round differently.
2. **The first move anywhere gives the rest spot, not the first move on the card.** Puppeteer's
   five-step move from off the card lands only its last step on it, and so can a quick flick. Had
   the card's own first move only noted the spot, that one move would hold nothing, and the
   existing hold e2e would fail.
3. **A replacement starts over.** `show()` clears the hold and notes the spot again, so a card that
   replaces a held one under a still pointer runs its own 6 s.

Tests:

- `packages/design/src/ui/ToastManagerBase.test.ts`: the hold cases reach the card with two real
  moves. New: a card that opens under a still pointer (mouseover, mouseenter, pointerover, a move
  at the spot and one 0.6px off) is gone at 6 s; a replacement under a still pointer runs its own
  6 s after a held card; with no position known at the open, a first move at the card's spot holds
  nothing, and a first move elsewhere then one move onto the card holds it. The old case "a
  replacement while the card matches :hover is held" is gone: it pinned the behaviour 2b removes.
  Mutations checked: without the pixel tolerance, or without the first-move rest spot, these fail.
- `tests/e2e/snackbar.test.ts`, one new smoke case: in the Receive sheet the mouse moves to the
  address line's lower edge and presses and releases there; the success opens over that point
  (`elementFromPoint` lands inside the card) and lives 5.5 to 6.5 s with the mouse still. The
  existing case where the pointer moves onto the card still holds it for 8 s.

Observed on Chrome, with the card opening under the still pointer: the card matched `:hover` and
got 2 `pointerover`, 3 `pointerenter`, 2 `mouseover` and 3 `mouseenter` events, but no
`pointermove` or `mousemove`. So the old `mouseenter` hold and the `:hover` re-read each held a
snack nobody reached; now it lived 6159 ms.

## P6.4 · The column in dApp windows (11a)

Built:

- `packages/design/src/ui/ToastManagerBase.vue`: an `inColumn` prop. With it the card's max width
  is `calc(var(--base-width) - 32px)`, 328px, instead of 368px. The card was already centred in
  the viewport, which is where the column sits (`body { width: var(--base-width); margin: 0 auto }`
  in `popup/index.scss`).
- `components/ui/ToastManager.vue` passes `inColumn` on every `windows-*` route except
  `windows-json` and `windows-logger`, the route-name test `utils/legal-sheet.ts` and
  `composables/useArrivals.ts` already use for the windows.

| Window | Route | 328px |
|---|---|---|
| Execute (a send or call to approve) | `windows-execute` | yes |
| Connect | `windows-discover` | yes |
| Permissions | `windows-capabilities` | yes |
| Emoji check | `windows-verify` | yes |
| Passkey ceremony | `windows-passkey` | yes; no snack opens there today |
| JSON viewer | `windows-json` | no: its body is the full window (`body { width: 100% }`) |
| Log viewer | `windows-logger` | no: the same |

Decision: the package reads the column from the `--base-width` token its own `base.css` defines,
so the host passes a flag rather than a width.

Sign-off pending (S-2): the Chrome side panel (the `sidePanel` setting) renders the popup's routes
in a panel that can be wider than 360px, so a card there can still reach 368px, wider than the
column. 11a names the dApp windows, so the panel keeps the popup's rule: `calc(100% - 32px)`
capped at 368px, centred. The alternative is 11a's 328px.

Tests:

- `packages/design/src/ui/ToastManagerBase.test.ts`: `inColumn` sets the column class, and it is off
  by default.
- `components/ui/ToastManager.test.ts`: the flag is on for each of the five windows and off on json,
  logger, a popup route and an onboarding route.
- `tests/e2e/network/snack-placement.test.ts`: in the execute window the card is 328px (±0.5) and
  centred on the body's column (±0.5).

## P6.5 · Over a sheet (12a)

How the host knows a sheet covers the nav: every popup-app sheet renders through
`components/Popup/Popup.vue`, whose wrapper is `position: absolute; inset: 0` over the whole app
at z-index `(displaceIdx + 1) × 500`, above the nav's. So an open `Popup` always covers the nav,
and its wrapper carries `v-snack-sheet`. While one is registered the host drops the base to 12 and
counts only the footers inside the top sheet (the last registered, which is the last opened);
page footers under it are ignored. The directive's `unmounted` hook runs when the close starts,
not when the slide-out ends, so the snack goes back to 76px as the sheet leaves.

The sheets' own rows (`v-snack-footer`):

| Sheet | Row |
|---|---|
| The 11 forms on `FormPopup` (new and edit account, contact, endpoint, fee contract, network; new token) | the submit block: the error note above, the submit button, the reset button or note below |
| Confirm | Cancel and Confirm |
| Edit profile | Update and Reset changes |
| A new sender's first receipt (incoming trust) | Block and Allow |
| Import contacts | Cancel and Import selected |
| Data viewer | Close |
| The authorization registry | Send and its error line |
| Revoke authorizations | Revoke and its error line |
| New sender | its error line and Add sender |
| Receive | Close (new testid `receive-close`) |
| Select a fee contract | New FPC |
| Select a profile | New profile, Import profile |
| Token details | Close |
| Send's review | Send now |

No row: the accounts sheet, forgot password, select networks and select token.

Sign-off pending: a sheet over a no-nav page ignores that page's footer, since the sheet covers
it. Send's review over Send puts the snack above Send now, not above Confirm Transaction.

Tests:

- `components/Popup/Popup.test.ts`: an open popup drops the inset from 76 to 12, and closing it
  restores 76. `composables/snackInset.test.ts` already covers the top sheet's own row and a
  stacked pair.
- `tests/e2e/snackbar.test.ts`, two new smoke cases: over the accounts sheet an error sits 12px
  from the bottom, and back at 76px once Escape closes the sheet; in the Receive sheet a copy's
  success sits 12px above Close.

## P6.6 · Two more rows (5b)

Built:

- `popup/pages/settings/advanced/index.vue`: the Logs row was a `div role="button" tabindex="0"`
  that Enter alone opened, with `outline: none`. It is now the row pattern: a positioned root
  (`settings-logs-row`, new) holding the handler, and a stretched `RowTarget` button
  (`settings-logs-open`, new) named by the row's "Logs" title. Enter and Space press the button
  natively and the click reaches the root's handler. The ring is the rows' `2px solid
  var(--nulo-accent)` at `-2px`, on `:has(> [data-row-target]:focus-visible)`.
- `popup/components/popups/RevokeAuthwitsPopup.vue`: the expand glyph, a bare `<Icon @click>` no
  keyboard could reach, is a `RowAction` (24×24, named "View authwits content",
  `revoke-authwits-view-content`, new) inside the same tooltip; its old hover fill is RowAction's.

Decisions:

1. **The Logs row keeps its list's hover:** the 0.8 fade that Account State beside it also uses,
   since the Advanced page has no background tint. Focus draws the ring at full opacity; the fade
   would dim the ring.
2. **The row's box reaches past the text** by 8px sideways and 6px up and down (`margin: -6px
   -8px; padding: 6px 8px`, the activity rows' bleed), so the ring clears the text and nothing on
   the page moves.
3. **Enter stops at the new button.** The Revoke sheet submits on any Enter that reaches the
   document (`usePopupEntity` with `submitKey` Enter). Without the stop, Enter on the button would
   open the content and revoke. Its own press still runs.
4. **"A sibling of its row's target"**: the button's chunk card is not an openable row, so it has
   no target to sit beside; the button is the card header's one control.

Sign-off pending: the Logs row's fade, its ring box and the ring without the fade; the chunk
header grows by the button's 24px box, where the glyph was 16px (R-3's shift).

Found, not fixed (the coordinator's call: older than the program and outside 5b; it goes to the
program's follow-ups and to the owner). Two sheets install `usePopupEntity` with
`submitKey: (e) => e.key === "Enter"`, a keydown listener on the document that fires the
sheet's submit on any Enter, whatever has focus:
`apps/extension/src/popup/components/popups/RevokeAuthwitsPopup.vue` (the revocation) and
`apps/extension/src/popup/components/popups/ChangeAuthwitsRegistryPopup.vue` (the registry
change). Once the fees are set, Enter on the header's × or on a fee method sends that
transaction. Found while building the content button: its unit test dispatched Enter with the
fees set, and without the stop the revoke fired; reading the composable's listener and the
registry sheet, which passes the same `submitKey`, showed any focused control does the same.

Tests:

- `popup/components/popups/RevokeAuthwitsPopup.test.ts`: the content control is a named button;
  Enter on it, bubbling to the document with a revoke ready, never revokes, and its press opens the
  data viewer with the chunk's content. Without the stop the revoke fires (mutation-checked).
- `tests/e2e/rows.test.ts`, smoke: with developer mode on, Tab reaches `settings-logs-open` and the
  next Tab leaves the row; the row draws `solid 2px -2px`; Enter opens the log window; Space, with
  it open, runs the same handler (a second click on the row) and opens no second window.
