# Phase 6 · The owner's parity answers ✓

The owner answered the parity page's thirteen calls on 2026-09-25. Code paths are relative to
`apps/extension/src/` unless they start with `packages/` or `tests/`.

## P6.1 · Above the footer (1c)

Built:

- `composables/snackInset.ts`: two directives and the host's inset. `v-snack-footer` marks a
  bottom action row and `v-snack-sheet` an open sheet; both register their element in a
  module-level registry. `useSnackInset(base)` returns the snack's distance from the viewport's
  bottom edge: `base` (76 with the nav, 12 without), raised to 12px above the highest registered
  footer whose top edge is on screen. It measures on the next frame after a footer or sheet arrives
  or leaves, a footer resizes (`ResizeObserver`, which catches a wrapping error line), the page's
  content changes (`MutationObserver`, which catches a hint or an error block added above a row
  that keeps its size), the window resizes, anything scrolls, or a transition or animation ends.
  It also measures at once when a snack opens, so a card never rises at a stale height. The pure
  step is `snackInset(base, viewportHeight, boxes)`, each box carrying how far its row rises once
  what scrolls it is at its end.
- `components/ui/ToastManager.vue`, the host: `useSnackInset(() => showBottomNav ? 64 + 12 : 12)`
  replaces the route-only inset. `ToastManagerBase` is unchanged: the package still takes a
  number and reads no store, route or page.
- New testids for the e2e: `send-footer` on Send's footer, `dapp-approval-footer` on the shared
  approval footer. No existing testid moved.
- `popup/app.vue`: the frame that clips the popup (`.wrapper`) is `overflow: clip` with zero
  minimum sizes, where it was `overflow: hidden`. It clips the same and draws nothing new, but it
  is no scroll container, so focus and `scrollIntoView` can no longer shift the whole popup by
  content a fraction of a pixel past its edge. Found by the gate: rerun alone at retry 0, the
  lengthened Receive case saw the snack move 1.2px in about one full-file run in four.

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
| Onboarding: Presto | Continue, or the skip link; no row while the probe runs | `onboarding/pages/presto.vue` `.ctaSlot`, counted while one of them renders |
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
   or where it stops once every container that scrolls it (a sheet's card, the page) is at its
   end.** The row's rise is what each of those containers still has to scroll. Where nothing can
   scroll it further (a pinned row, or a long page already at its end) that is where the row is,
   as first built. In a window shorter than the page, or a sheet taller than the popup, it is where
   the row stops, so the snack is clear of the row before a scroll brings it up: `scrollIntoView`
   and a click can land in one task, before the next measure. For a row at its container's end the
   result does not move with the scroll. The scroll listener stays for rows that do move with it
   (above a container's end). A row off screen at both places moves nothing. A sticky row keeps
   its place while the container it sticks to scrolls (Send's footer), so that container adds
   nothing; nor does `overflow: hidden`, which no user can scroll directly, or the app's frame,
   which clips and cannot scroll at all (a stacked card's 15px shift overflows it). As first built
   only the page's scroll counted, so a row at the end of a sheet's scrolling card was missed
   (codex round 1).
3. **Never below the base.** On a nav page a footer low enough to sit under the nav's inset changes
   nothing. No nav page registers one today.
4. **The inset moves at once**, as it did on a route change. There is no transition on `bottom`.
5. **A row can say it holds no action.** `v-snack-footer` takes an optional value; a row given one
   counts only while it is true, and the directive's `updated` hook registers and unregisters it as
   the value changes. Presto's 48px slot keeps its place while the probe runs, so the page never
   jumps, and passes whether Continue or the skip link renders; every other row passes none. The
   slot, not the button or the link, stays the row: 1c measures from the action row's top edge,
   and the skip link's own box sits centred in the slot, lower (codex round 1, as the coordinator
   narrowed it).

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

- `composables/snackInset.test.ts`, 26 cases: the pure step (the base, the highest footer, never
  below the base, a zero-height or off-screen row, a row below the fold counted where it stops, a
  pinned row and a long page at its end keeping their inset, a row peeking on screen while
  something can still scroll it); the host after a frame, a footer's removal, a row given a value
  counting only while it is true, a sheet over the nav, two stacked sheets and the sheet order
  (P6.5), a footer growing, a hint added and removed above a row that keeps its size, a scroll, a
  transition end, an animation end and a resize, a window shorter than the page (placed before the
  scroll, unmoved after it), a row inside a scrolling card rising by what the card and the page
  have left and not by a hidden overflow, a sticky row keeping its place while its own container
  scrolls and still rising with the page, a snack opening before any frame, the base following its
  source, and disposal. The stubbed layout has one rule, a sibling's `data-flow` pushing what
  follows it down, so the hint moves the row without touching the row's DOM. Mutations checked:
  the page-only rise, no sticky rule, a sticky flag that never resets, a counted `hidden`, no page
  rise, no observer, attributes only, no disconnect, a value ignored at mount, no `updated` hook
  and an `updated` that never unregisters each fail a case.
- `onboarding/pages/presto.test.ts`, new: the slot's value is false while the probe runs, true with
  the skip link (offline) and with Continue (available), and false again on a new probe. "Only
  Continue counts" and the bare slot mark each fail it.
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
- `tests/e2e/snackbar.test.ts`, one new smoke case: a 400px block at the top of the Receive
  sheet's card pushes Close to 950 in the 600px popup; the copy's error already sits 12px above
  where Close stops at the card's end, Close scrolled into view and hit-tested in one task is
  clear, and after the next measure the snack has not moved. With the page-only rise put back it
  fails (Chrome, checked).
- `tests/e2e/network/window-placement.test.ts`, unchanged, joins the gate: three runs per browser
  at retry 0, as the one spec that drives the approval footer under a persistent error.

## P6.2 · A first open runs its 6 s (2b)

Built in `packages/design/src/ui/ToastManagerBase.vue`:

- The hold no longer starts on `mouseenter`, and a card no longer re-reads `:hover` once it has
  risen. A card that appears under a still cursor gets the browser's hover events, so both held a
  snack the person never reached.
- The region follows the pointer with one passive capture `pointermove` listener on the document,
  which records each move before the card sees it. A `pointermove` on the card holds it only when
  it is at least a pixel, on either axis, from the pointer's previous position. No hover event
  holds, and neither does a move the browser synthesises at the cursor's last spot. As first built,
  every move was compared with where the pointer rested when the card opened, so a pointer that
  left the card and came back to that spot never held it (codex round 1).
- Unchanged: focus entering the card holds it, `mouseleave` or focus leaving releases it, the
  remaining time resumes, and an error has no timer.

Decisions:

1. **Position, not event type, tells a person from the browser.** A synthesised move carries the
   cursor's last position; a person reaching the card moves it. Under a pixel apart counts as the
   same spot, since the two can round differently.
2. **Each move is judged against the one before it, wherever that was.** Puppeteer's five-step
   move from off the card lands only its last step on it, and so can a quick flick; that one move
   still comes from somewhere else, so it holds. With no earlier position known, a first move holds
   nothing.
3. **A replacement starts over.** `show()` clears the hold; under a still pointer the next move, if
   any, is at the same spot, so a card that replaces a held one runs its own 6 s.

Tests:

- `packages/design/src/ui/ToastManagerBase.test.ts`: the hold cases reach the card with two real
  moves. New: a card that opens under a still pointer (mouseover, mouseenter, pointerover, a move
  at the spot and one 0.6px off) is gone at 6 s; a replacement under a still pointer runs its own
  6 s after a held card; with no position known, a first move at the card's spot holds nothing,
  and a first move elsewhere then one move onto the card holds it; a pointer that leaves the card
  and comes back to the spot where it opened under it holds it. The old case "a replacement while
  the card matches :hover is held" is gone: it pinned the behaviour 2b removes. Mutations checked:
  without the pixel tolerance, comparing a move with itself, or comparing with the first position
  ever, these fail; the first build's rule fails the return case.
- `tests/e2e/snackbar.test.ts`, one new smoke case: in the Receive sheet the mouse moves to the
  address line's lower edge and presses and releases there; the success opens over that point
  (`elementFromPoint` lands inside the card) and lives 5.5 to 6.5 s with the mouse still. The
  existing case where the pointer moves onto the card still holds it for 8 s.

Observed on Chrome, with the card opening under the still pointer: the card matched `:hover` and
got 2 `pointerover`, 3 `pointerenter`, 2 `mouseover` and 3 `mouseenter` events, but no
`pointermove` or `mousemove`. So the old `mouseenter` hold and the `:hover` re-read each held a
snack nobody reached; now it lived 6159 ms.

## P6.3 · Details on a failed send (10b)

The fork, which id Details opens, went to codex: **(b), the wallet names the record beside the
error, confidence high** (codex high, session 01a0d965-8a4b-7e40-a40d-86fcb1c87fb1). It rejected
(a), matching records by their fields, because even one match can belong to another send (a
transfer takes no execution slot), and (c), a popup-minted token, because a buggy or compromised
popup could reuse another operation's. Facts it verified that shaped the build: `markJournal`
swallows a failed write, so a rejection does not prove a failed record exists; the Terms are
checked again before broadcast, so a Terms refusal can have a record; only a `WalletError`
serializes, and reconstruction drops `details` for the Terms, session-ended and not-recorded
errors, so `details.journalId` could not carry it.

Built:

- `packages/extension-messaging/src/errors.ts`: `JournaledRejection` and `journalIdOf`;
  `remoteErrorFromResponseContent` keeps a string `journalId` in a module-private `WeakMap` keyed
  by the rebuilt error. `core/error-response.ts` unwraps the rejection and adds `journalId`;
  `ResponseContent` and `ResponseContentLike` gain the optional field.
- `wallet/services/execution/transfer-executor.ts`: `markJournal` reports whether the write
  landed, and the catch throws `new JournaledRejection(error, journalId)` only when the `failed`
  transition did. `execution-coordinator.ts`: `markJournal` in `ProveAndSendContext` is typed
  `Promise<unknown>`; nothing else there changed.
- `popup/pages/send-submit.ts`: `detailsAction` and `isFailedTransferOf`; the snack is opened once,
  after the read. `popup/pages/send.vue`: `readJournal` opens its own journal client and
  disconnects it, since the page has left by then; `viewJournal` routes to the journal page.

Decisions:

1. **A plain wrapper, not an `Error` subclass.** Nothing between the executor and the response
   boundary inspects the thrown value (the RPC method passes it through), and the one log line
   there, the base service's `Request failed` at debug, projects the wrapped error by its fields.
2. **A wrapper per throw, not a map keyed by the error.** A map keyed by the thrown object would
   pair a shared or cached error instance with whichever send recorded it last, and would name a
   record on any later response that rethrows the same object.
3. **The snack waits for the read.** Opening it first and adding Details afterwards would replay
   the card. The read is one local round trip on a port the page opens for it.
4. **The id is checked as 16 lowercase hex characters** before it reaches a route, mirroring View's
   hash check; the journal writes nothing else, and a restored row keeps its own id but is never a
   send's failure.

Sign-off pending: none new. Details is drawn like View (i10 A′), after the text and before ×.

Tests:

- `packages/extension-messaging/src/background/client.test.ts`: a plain `Error`, a `WalletError`
  with details, the Terms refusal, the not-recorded refusal, a cancel and a thrown string each
  reject with the same class, message and own fields with or without a `JournaledRejection`, and
  only the journaled one names the record; an id inside `details`, on the error or as a number
  names nothing. `background/service.test.ts`: a service method throwing one replies with the
  error's fields and `journalId`. `core/core.test.ts`: the projection, and no id from the thrown
  value's own fields.
- `packages/design/src/ui/ToastManagerBase.test.ts`: an error's action comes before × in the DOM,
  and selecting it closes the snack before its callback.
- `wallet/services/execution/transfer-executor.test.ts`: a failure the record holds names it; one
  the record could not take is thrown alone; two identical sends failing in reverse order each
  name their own record, and a refusal before its record names none. Four session-end asserts now
  expect the named record.
- `wallet/services/execution/service.composition.test.ts`: the late Terms refusal names its own
  failed record; the Terms at entry and a transfer confirmed while locked throw the error alone
  with no record; seven session-end asserts now expect the named record.
- `popup/pages/send-submit.test.ts`: Details opens the named record's page; a late Terms refusal
  keeps its copy and debug level and gets Details; the three copies and log levels, and a
  cancel's silence, are the same with or without an id; no read for no id, a short, path-shaped or
  uppercase id, or an id on the error itself; no Details for a missing record, a failed read (and
  no second snack or error line), an in-flight, cancelled or untimed record, a dApp record, and
  another account's or network's; nothing opens after A → B → A or a lock and unlock during the
  read; a scope change closes the Details snack; two identical sends failing in reverse order
  each offer their own record. Five mutations of the guards (the recheck, the scope, the format,
  the stage, the terminal time) each fail a test.
- `tests/e2e/network/snack-placement.test.ts`, one new case, sharing the Send setup of the
  placement case: 1 token, public to private, to an off-curve address, whose estimate fails and
  whose send then fails in the build, after the executor has written the record. The public origin
  needs no review, so the footer sends at once. "Send failed" offers Details, which closes the snack
  and opens `/popup/journal/<id>`; that id is the one failed transfer the journal holds, and the
  page's state reads "Failed".

Follow-up: the journal's id comment in `wallet/services/operation-journal/service.ts` says "16
bytes / 128 bits", but `nextRandomId(storage, 16)` draws 16 hex characters, 64 bits, and the
comment cites a review round. This change does not touch that file.

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
and its wrapper carries `v-snack-sheet` with the popup's `displaceIdx`, the order behind that
z-index. While one is registered the host drops the base to 12 and counts only the footers inside
the top sheet, the highest order; between equals the later mount, which the DOM draws on top,
and a sheet with no order sits beneath every ordered one. Page footers under it are ignored. As
first built the top sheet was the last to mount, but Token Metadata renders its `Popup` only once
its token loads, so a sheet opened over it meanwhile lost placement to it (codex round 1). The
directive's `updated` hook follows an order that changes, as opening an open popup again raises
it. The directive's `unmounted` hook runs when the close starts, not when the slide-out ends, so
the snack goes back to 76px as the sheet leaves.

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
  restores 76. `composables/snackInset.test.ts` covers the top sheet's own row and a stacked pair,
  and the order: a lower sheet that mounts after a higher one leaves placement with the higher
  one; a sheet with no order sits beneath an ordered one, and between equals the later one places;
  a sheet raised above the others takes placement. `components/Popup/Popup.snackbar.test.ts`: with
  two real `Popup`s, the one at `displaceIdx` 2 places the snack though the one at 1 mounted after
  it. Mutations checked: mount order, no `updated` hook, ties to the first mount, no order counted
  as 0, and `Popup` passing no order each fail a case.
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
- The Logs handler joins a press made while its window is still being created. It learned the
  window's id only once `windows.create` resolved, so a second press in that gap (a double-click,
  or Enter then Space) opened a second log window. Found by the flake bar: 4 of 17 Firefox runs of
  the row's e2e at retry 0 opened two windows. The race is older than the arc (the old div row had
  it on a double-click) and is fixed because the arc's row and its e2e depend on it.

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

- `popup/components/popups/RevokeAuthwitsPopup.test.ts`: the content control is a named button.
  Enter and Space are each a cancelable event on the focused button, and the click follows only
  when no handler cancelled it (Enter on keydown, Space on keyup), as a browser activates it. For
  both, with a revoke ready, the events go uncancelled, the data viewer opens once with the chunk's
  content, and nothing revokes. Adding `.prevent`, dropping the stop, preventing Space and opening
  again on keydown each fail it. As first built the test dispatched Enter and then clicked on its
  own, so a cancelled Enter would have passed (codex round 1).
- `tests/e2e/rows.test.ts`, smoke: with developer mode set on, Tab reaches `settings-logs-open`,
  the next Tab leaves the row and Shift+Tab comes back; the row draws `solid 2px -2px`; Enter opens
  the log window, which shows its page; Space, with it open and the popup focused again, runs the
  same handler (a second click on the row) and opens no second window.
- `popup/pages/settings/advanced/index.test.ts`, new: two presses while `windows.create` is
  pending create one window, and a press after it resolves focuses that window. The handler without
  the join fails it.

## Codex round 1 · changes-requested (high)

GPT-6 Astra at high effort, session `01a0d9b5-f60d-75f1-b5f2-8a7d772ddc44`, on
`30730df3..7981f80f`, the first seven P6 commits. 10b (`1668ef24`) landed after that range and goes
to round 2 with these fixes. The coordinator accepted all seven findings and added an eighth. Each
fix is its own commit, and each fix's test fails on the rule it replaces: the pre-fix code put
back by a mutation run, the pre-fix component for row 4, and for row 6 the `.prevent` the finding
names.

> VERDICT: changes-requested — confidence: high

| # | Severity | Finding | Decision | Commit |
|---|---|---|---|---|
| 1 | major | The rise counted only the document's remaining scroll, so a row inside a scrolling sheet card (`PopupCard`, `overflow: auto`) was missed until a scroll exposed it, and a scroll and a click in one task could land on the snack (`composables/snackInset.ts`) | Accepted. A row rises by what every container that scrolls it still has to scroll: `overflow: hidden` adds nothing, and a sticky row adds nothing for the container it sticks to. Unit cases for a scrolling card and a sticky row; a smoke case scrolls the lengthened Receive sheet's Close into view and hit-tests it in one task | `55811d4e` |
| 2 | major | A row moved by content above it, without resizing, kept a stale inset (`composables/snackInset.ts`) | Accepted. A `MutationObserver` on the body (child list, attributes, text, subtree) schedules the same frame-coalesced measure and is disconnected on dispose. Unit case: a hint added and removed above a row that keeps its size | `a120bebb` |
| 3 | major | The top sheet was the last to mount, not the one drawn on top; Token Metadata renders its `Popup` only after an await (`composables/snackInset.ts`) | Accepted. `Popup` passes its `displaceIdx` to `v-snack-sheet`, and the highest order places the snack; between equals the later mount, and a sheet with no order sits beneath. The "In open order" comment is replaced. Unit cases for a lower sheet mounting last, a sheet raised by reopening, and ties; `Popup.snackbar.test.ts` with two real `Popup`s | `45b519f9` |
| 4 | minor | The hold compared every move with where the pointer rested at the open, so a pointer that left and came back to that spot never held the snack (`packages/design/src/ui/ToastManagerBase.vue`) | Accepted. A move on the card is compared with the pointer's previous position, keeping the under-a-pixel tolerance. The return case is new | `332d41b7` |
| 5 | minor | Presto registered its 48px placeholder while neither Continue nor the skip link renders, a state 1c's "no row, 12px" does not have (`onboarding/pages/presto.vue`) | Accepted, as the coordinator narrowed it. The first fix put the mark on the button and the link, which measured the 12px from the link's centred box; the second keeps the slot as the row, and `v-snack-footer` takes an optional value that registers it only while one of the two renders. A directive case and `presto.test.ts` | `c38df250`, then `288c0c4b` |
| 6 | minor | The Revoke test dispatched Enter and then clicked on its own, so `.prevent` would have passed, and Space was untested (`RevokeAuthwitsPopup.test.ts`) | Accepted. Enter and Space are cancelable events on the focused button, and the click follows only when none was cancelled; one content opening and no revocation for each. No real-browser check, the coordinator's call | `6899451d` |
| 7 | minor | The plan's hold bullet still said `mouseenter` and `:hover`, its wrapper bullet the route-only inset, and two test helpers carried comments that restated their names | Accepted. Both bullets describe P6, and both comments are gone | `9ed97ac8` |
| 8 | the coordinator's | R-3's "36px to 52px" did not say that the code's 60px includes the row's 8px side padding | Accepted. R-3 says it | `9ed97ac8` |

## Codex round 2 · changes-requested (moderate)

GPT-6 Astra at high effort, the same session resumed, on `7981f80f..2d8ab638`: round 1's fixes and
10b. It closed round 1's findings 1 to 7 and R-3's clarification, found no production-path defect
in 10b's provenance, scope checks or failure handling, and raised two minors. The coordinator
accepted both. Each fix is its own commit, made after the gate's own fixes.

> VERDICT: changes-requested — confidence: moderate

| # | Severity | Finding | Decision | Commit |
|---|---|---|---|---|
| 1 | minor | The Details e2e asserted the snack gone once the journal page was ready, but that page can load inside the snack's 150ms leave (`tests/e2e/network/snack-placement.test.ts`) | Accepted. The case waits for `snackbar` to detach, then asserts it is gone | `0354327a` |
| 2 | minor | Three comments: `SCROLLABLE`'s said `hidden` clips without scrolling, though script can scroll it (`composables/snackInset.ts`); `shape`'s said it copies every own field, though its spread leaves out the non-enumerable `stack` (`packages/extension-messaging/src/background/client.test.ts`); `recorded`'s restated its one-line constructor call (`wallet/services/execution/service.composition.test.ts`) | Accepted. The first says no user can scroll `hidden` directly, the second that `stack` is left out on purpose, and the third is gone | `c1dc6147` |

The coordinator added one more: the docblock on `openLogs` narrated where the logs window used to
open from. It is gone (`d62e34fa`).

## Codex round 3 · approve (moderate)

GPT-6 Astra at high effort, the same session resumed, on `2d8ab638..d62e34fa` (the gate's fixes
and round 2's) and on the whole owner-answer range `30730df3..d62e34fa`. It ran read-only probes
of the joined open, recovery after a failed create, recovery from a closed window's lookup and the
bounded focus retries; it did not rerun the browser e2e.

> Both round-2 findings are closed. **No new material findings** in round 3 or the full
> `30730df3..d62e34fa` range.
>
> The visible changes correct frame shifting, unwanted widening, and duplicate Logs windows; I found
> no unapproved UI state.

> VERDICT: approve — confidence: moderate

## Gate

The first run, on `2d8ab638`, was green but for both smokes, which ran at the config's two
retries; the network files ran at retry 0.

| Step | `2d8ab638` |
|---|---|
| `bun run lint`, `typecheck:all`, `test:all`, `test:ci-gating`, `build` | exit 0 each |
| `snack-placement` and `window-placement`, Chrome prover on | 4 passed, 1 skipped |
| `window-placement` twice more, Chrome | 1 passed, 1 skipped, each time |
| `snack-placement` and `window-placement`, Firefox proverless | 5 passed |
| `window-placement` twice more, Firefox | 2 passed, each time |
| smoke, Chrome | 156 passed, 7 skipped; snackbar's still pointer failed on all three attempts |
| smoke, Firefox | 152 passed, 11 skipped; rows' Logs row failed on all three attempts |

Each red case was rerun alone at retry 0 until its cause was known, and each fix was proven alone
before the next.

1. **Snackbar's still pointer (Chrome).** The rest check waited for no animation under the sheet's
   layer, which also holds in the frames before the slide begins: the Receive sheet keeps its 40px
   start offset for two or three frames after it mounts, and on the third its slide exists but has
   not started. The case read the address there and pressed 28 to 40px below where it comes to
   rest, on a wrapper, so no copy ran and no snack opened. The check now needs the target's own
   box unchanged on three animation frames in a row with nothing finite animating, and the case
   waits on the address it presses (`b29ecfd6`). Before, 2 of 5 runs failed; after, the file
   passed 10 of 10 on Chrome and 3 of 3 on Firefox, the success living 6152 to 6165ms.
2. **A 1.2px snack move**, found in those reruns: the lengthened Receive case failed about one
   full-file run in four. The popup's frame was `overflow: hidden`, a scroll container that focus
   and `scrollIntoView` move, and content a fraction of a pixel past its bottom edge gave it 1px to
   scroll. Scrolling Close into view raised the whole frame by that pixel; the inset leaves such a
   scroll out, as no user can make it, so the next measure moved the snack. The inset changed for
   real (the test was not measuring mid-scroll), so the product changed and the 0.5px bound
   stayed: the frame is `overflow: clip` (`23ed6c55`), which clips the same and cannot scroll. The
   case now hangs a 2px strip below the popup first; with `hidden` the snack moves 2px on both
   browsers, with `clip` it stays. A clip box is no scroll container, so as a flex item its minimum
   size follows its content: with the frame's width set to auto, a 1604-char line widened it to
   10800px on Chrome and 14298px on Firefox. Zero minimum sizes keep it at the window's width
   (`cb26b925`). On both browsers the document's scrollWidth then equals its clientWidth on Receive
   (its address, and an 802-char line beside it), on Send (an 802-char destination), in the logger
   window (an 802-char line) and in a json window (a 1602-char line). No sticky box had the frame
   as its nearest scroller; each sticks inside its page's own. No drawn state changes.
3. **Rows' Logs row (Firefox)**: three causes, and a fourth that had not failed yet.
   - A retry could not pass: the case clicked the developer-mode toggle without reading it, and
     `registeredExtension` lives for the whole file, so each attempt flipped developer mode and the
     second found no row. The case now sets it on.
   - Space fired no click on the gate's first and third attempts, and in 3 of 17 runs at retry 0
     after it. The case pressed it as soon as the log window's target appeared, and a key sent to
     a page whose window lost focus reaches its focused element with no default action. Firefox
     raises a window it opens once more as it starts loading its page (its delayed startup calls
     `window.focus()` right after starting the load), which undid a `bringToFront` made between the
     two raises. The case now waits for the target to show the log page, and the driver's new
     `prepareKeys` brings the popup forward until it reports focus, again if it loses it; Chrome's
     is empty (`a98dbdf9`). In 8 instrumented runs no blur came between that focus and the key.
   - Space landed while `windows.create` was still pending and opened a second window in 4 of 17
     runs: the product race in P6.6, fixed in `f75064b1`.
   - The Tab after Space raced the handler's own `windows.update` raise, which took focus from the
     popup 3 to 7ms after the click in all 8 instrumented runs. The one-Tab-stop check moved before Enter, and Shift+Tab
     brings focus back.

   After both fixes the file passed 8 of 8 runs on Firefox and 4 of 4 on Chrome at retry 0.

The rerun on the fix tip ran every e2e file at retry 0, each run followed by `bun run e2e:reap`.
`037b6c6c` adds only this log's round 2 and 3 records to `d62e34fa`, and `a98dbdf9` differs from
`d62e34fa` only in comments and a network file:

| Step | Commit | Result |
|---|---|---|
| `bun run lint` | `d62e34fa` | exit 0, the first run's 29 warnings and 3 infos |
| `bun run typecheck:all` | `d62e34fa` | exit 0 |
| `bun run test:all` | `d62e34fa` | exit 0; the extension's 7499 passed, 4 skipped and 7 todo, one more than the first run (the Logs handler's) |
| `bun run test:ci-gating` | `d62e34fa` | 138 passed |
| `bun run build` | `037b6c6c` | exit 0 |
| `snack-placement` and `window-placement`, Chrome prover on | `037b6c6c` | 4 passed, 1 skipped |
| `window-placement` twice more, Chrome | `037b6c6c` | 1 passed, 1 skipped, each time |
| `snack-placement` and `window-placement`, Firefox proverless | `037b6c6c` | 5 passed |
| `window-placement` twice more, Firefox | `037b6c6c` | 2 passed, each time |
| smoke, Chrome | `a98dbdf9` | 157 passed, 7 skipped |
| smoke, Firefox | `d62e34fa` | 153 passed, 11 skipped |

The parity captures of the new states were then taken from `037b6c6c` on both browsers, outside
the repo.
