---
plan: ux-feedback/b4-snackbar-rows-arrivals
tier: mid
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: fable Plan subagent (model fable, fallback opus)
eli5_mode: artifact
program: implementations-plan/ux-feedback/plan.md (batch 4, arc 4 of 6)
arc_branch: feat/ux-4-snackbar-rows-arrivals
design: implementations-plan/ux-feedback/design/spec.md (items 10, 11 and 12)
artifact: https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF
eli5: https://claude.ai/artifact/JzvsTKxyeeRw1xdof9SAEx
parity: https://claude.ai/artifact/2NDQYMuPhFWyE5yMjht1LN
---

# Batch 4 · Snackbar, rows, arrivals

Arc 4 of the UX program's six-PR stack, on top of batch 3 (tooltips and glossary). It covers:

- Item 10, A′: the snackbar in `@nulo/design`, the extension wrapper, and every `openToast` call
  site (130 in 56 files, plus the clipboard helpers' 20 direct callers).
- Item 11, A: one interactive row, across every list in the wallet.
- Item 12, B: the arrival that plays once per receipt with a per-account seen state, and the
  elsewhere-snackbar.

Out: `@nulo/design`'s `Toast.vue` item (the tools app's toast, which left this repo with the tools
app and the bridge packages in #691; nothing in the extension renders it), menus
(`DropdownItem`), `CapabilityCard` and `AccountSelectRow` (batch 5b's permission window), a toolbar
count (item 12 says none), `base.css` (hash-pinned), the `@aztec/*` line, and the incoming row's
own amount formatting (a pre-existing truncation, listed as a follow-up; only its throw on invalid
decimals is fixed, A-15).

**The design is the artifact**, <https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF>, quoted by
[`../design/spec.md`](../design/spec.md) § Item 10, § Item 11, § Item 12. Shots: `10-snackbar`,
`10-round1`, `11-rows`, `12-arrival`, `12-incoming` (`design/targets.mjs:39-43`). Mock citations
(`nulo.css`, `page.js`, `r2/i10.html`, `parts/*.html`) are relative to `../design/mocks/src/`.
Code paths are relative to `apps/extension/src/` unless they start with `packages/` or `tests/`.
Recon: [`recon.md`](recon.md).

## Phase 0 (pre-answered by the program)

Recorded from `implementations-plan/ux-feedback/plan.md` § "Phase 0, answered for every batch";
no clarifying questions were asked.

- **Success**: items 10, 11 and 12 built as the spec says; every call site classified and listed in
  the PR body; parity evidence published; every gate below green on Chrome and Firefox.
- **Who and what excellent looks like**: the program's Outcome & Quality Bar, plus this batch's
  line (below).
- **Scope**: the batch's items only (out-list above).
- **Constraints**:
  - pre-production, so the new arrival table and the trust row's new field need no migration;
  - Bun 1.4.2; the account freeze untouched; no new dependency;
  - complexity budgets hold with no new acceptance;
  - `base.css` untouched; the logging policy (nothing new is logged).
- **Quality bar**: production.
- **Validation layers**:
  - typecheck and lint, unit, component, the Storybook build (the toast stories change);
  - smoke e2e on Chrome and Firefox (`waitForToast` changes, and every row changes);
  - network e2e on Chrome and Firefox: the specs that read "Transaction submitted", the incoming
    specs, the new arrival spec, and the execute window's errors (P5).
- **Surface vs delegate**: UI decisions come from the spec and the owner's picks; technical
  decisions go to `/codex high` and are logged.
- **`/code-review`**: off. **`/harden`**: not scheduled.

## Outcome & Quality Bar

For whom: someone using the popup with a mouse, a keyboard or a screen reader, who needs to know
what just happened and what they can press.

Excellent means:

1. **A message stays exactly as long as it should.** A success leaves 6 s after it opens and never
   while the pointer or focus is on it; an error stays until its × is pressed, and × is reachable
   by keyboard even from inside a popup; both sit 76px from the bottom above the nav. Fake timers,
   the real focus trap and a measured e2e rect check it.
2. **Each message lands in the region for its urgency.** A success renders in a polite status
   region and an error in an assertive alert region, both mounted before any text arrives.
   Component tests assert the placement, the replacement and the repeat. Actual speech is not
   tested with a screen reader, so the claim stops at the DOM.
3. **A row is one thing.** Every row that opens something is one Tab stop, a link when it
   navigates and a button when it opens a window, that Enter and Space open exactly once, with a
   ring that matches its hover. No inert row has a hover, a pointer or a Tab stop. Every button
   inside a row is at least 24×24 and never opens the row. Component tests and browser-measured
   boxes and key presses check it.
4. **A receipt is announced once and never names a sender.** The arrival plays once per receipt
   per account, in whichever document shows it first, and a row that plays is animated from its
   first paint; reopening the popup does not replay it; importing an account, adding a token with
   history or allowing a sender plays nothing, on any account; reduced motion gets no slide and no
   count; lock and account changes take the snack away; the elsewhere-snackbar's text cannot
   change with the public event's `from`. A sentinel test, the incoming service's lock, chain
   block floors and e2e reopen and import checks cover it.

Good enough: the lists the mocks do not draw take the drawn rules with their own hover tints, and
the neutral notices take the success visuals.

## Round-5 picks

None picked (read 2026-09-24). The program says batch 4 needs no round-5 rows. Re-read the
artifact's `picks` store before P1 starts.

Re-read 2026-09-25 before P1: 22 docs, all at version 1; i10 "A only" (note "The timer bar on the
snackbar looks weird."), i10b "A′", i11 "A", i12 "B" — unchanged.

## UI impact

| # | Surface | Before → after (drawn values) | Shot | Sign-off |
|---|---|---|---|---|
| 1 | Every toast (popup, onboarding, dApp windows) | top 12px, centered, 2px outline, one nowrap uppercase label, icon per call, a decorative close glyph, click anywhere closes, 1.5–4 s → bottom, 76px with the nav (`r2/i10.html:20-21`), `width: calc(100% - 32px)`, `padding: 12px 14px`, `gap: 10px`, `background: var(--nulo-surface-high)`, `border: 1px solid var(--nulo-outline)`, `box-shadow: 0 8px 24px rgba(10, 9, 8, 0.45)` (`nulo.css:193`); a title (headline 12px/700, `0.06em`, uppercase, `:195`) and an optional sub line (11px, `--nulo-secondary`, `:196`); no timer bar | `10-snackbar`, `10-round1` | i10 A′ (owner); placement without the nav: owner, 2026-09-25: 1c, and over a sheet: owner, 2026-09-25: 12a (S-1); in a window shorter than the page, 85px up before the scroll: **sign-off pending** (S-1); width in the dApp windows: owner, 2026-09-25: 11a (S-2); the onboarding width and motion: **sign-off pending** (S-2, S-3) |
| 2 | Success snack | → 16px `check-circle` in `--green` (`:87`, `:97`), in the polite region, one action "View" (headline 11px/700, `0.12em`, uppercase, `--nulo-accent`, `padding: 6px 4px`, `:197`) only on transaction and receipt messages; hides after 6 s, waits while hovered or focused | `10-snackbar` | i10 A′; the first open's timer: owner, 2026-09-25: 2b (S-12); which messages get View: **pending** (S-7) |
| 3 | Error snack | → 16px `close-circle` in `--red`, `border-color: var(--red)`, title `--txt-primary` (`:473-474`), in the assertive region, a × button 24×24, `margin-right: -6px`, `--nulo-secondary`, glyph 16px, `aria-label="Close"` (`:471-472`, `r2/i10.html:21`); stays until × | `10-snackbar` | i10 A′; Details: owner, 2026-09-25: 10b (S-8) |
| 4 | Send's result | "Transaction submitted" alone, or the failure sentence in red → title "Transaction submitted", sub "{amount} {symbol} to {0x8c02…41fa}", View opens the transaction; title "Send failed", sub today's failure sentence | `10-snackbar` | i10 A′; sub copy **pending** (S-9, S-10) |
| 5 | The 130 call sites | icon, colour and duration per call → a kind per call (success or error), the rest from rows 2 and 3 | none | i10 "decided per call site and listed in the PR body"; the borderline groups **pending** (S-5, S-6) |
| 6 | Activity rows, Home and History | tx rows: a `div` with a 50% tint, no Tab stop; journal and received rows: no hover, no Tab stop; queued awaiting rows: pointer only → every openable row is a link (tx, journal, received) or a button (queued awaiting, which opens the approval window), full-row `--nulo-surface-low` tint with `transition: background 0.15s var(--bezier)`, `:active` `--nulo-surface-high`, focus = tint + `outline: 2px solid var(--nulo-accent); outline-offset: -2px` (`nulo.css:242-245`); the row box extends 8px each side (`margin: 0 -8px; padding: 6px 8px`, `:223`); the dollar figure's "At today's price" hover stays, because that span sits above the row's target and passes a plain click to it (R-7) | `11-rows` | i11 A (owner); the kept hover: **pending** (R-7) |
| 7 | Other lists (Settings, tokens, contacts, connected apps, authorizations, notes, fee contracts, accounts, senders, endpoints, contracts, the pickers) | mixed: Tab stops on inert rows, Enter-only rows, click rows keyboards cannot open, hover on rows that do nothing, contacts and connected apps announced as buttons though they navigate → the same rules (a row that navigates is a link); each list keeps its own hover tint and gains the drawn ring; the contact row's S chip keeps its "Registered as sender" hover the same way (R-7) | `11-rows` (rules, `parts/11-rows.html:47-53`) | i11 A; the Logs row and the Revoke expand button under the rules: owner, 2026-09-25: 5b, with the Logs row's fade, its ring box and a ring without the fade **pending**; the ring and the token tint off the drawing, the kept hover: **pending** (R-1, R-2, R-7) |
| 8 | Buttons inside rows | 14–20px glyphs (most not focusable) and 16×28 awaiting buttons → 24×24 (awaiting 24×28) buttons with an accessible name; layouts shift by the difference | `11-rows` | i11 A; the shift: **pending** (R-3, R-4) |
| 9 | Home on a new receipt | a row appears → the row slides in (`n-row-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)`) and glows green (`n-row-glow 2.4s ease-out 0.2s`), its amount green then primary (`n-amt 2.6s`); a chip "+{amount} {symbol}" rises above the hero and fades (`n-plus 2.6s`, `nulo.css:517-527`); the hero counts for 900ms (`page.js:663-674`) only between two displayed aggregates | `12-arrival` | i12 B; count-up: signed off, 9a (A-1′); chip text and chip width **pending** (A-2, A-14) |
| 10 | History on a new receipt | as row 9's row | `12-arrival` | i12 B |
| 11 | Anywhere else on a receipt that arrives while the page is open | nothing → one success snack, "Received {amount} {symbol}", "Private · {account}" or "Public · {account}", View opens the receipt (`parts/12-incoming.html:53`) | `12-incoming` | i12 B; where "elsewhere" is and which receipts it names: **pending** (A-3, A-4, A-11, A-13) |
| 12 | A snack while a popup is open (keyboard) | the snack cannot be reached by Tab → Tab reaches its View or × after the popup's controls | none | **pending** (K-1) |
| 13 | Lock and account changes | a toast survives the lock screen → the snack closes on lock; a snack with View closes when the profile, network or account changes | none | **pending** (S-16) |
| 14 | A receipt of zero (or an unreadable amount) | rows 9-11 would play it → no slide, glow, chip or snack: an ordinary row | none | **sign-off pending** |

Keyboard:

- The snack's View and × join the Tab order after the page's content, since `#toast` moves to the
  end of both app shells (it precedes the page today). Inside an open popup they follow the
  popup's controls (K-1).
- Every openable row is one Tab stop, opened by Enter and Space. The 24 click-mode Settings rows
  and the notes and authorization rows become reachable. The 14 inert Settings rows, the contracts
  rows and the non-queued awaiting rows stop being Tab stops. Inner buttons become Tab stops where
  they were bare glyphs.
- Esc does not close the snack (S-14); inside a popup, Esc still closes the popup.

Screen reader:

- Successes render in a polite region and errors in an assertive one; both stay mounted.
- Rows announce as a link or a button named by their visible text.
- The Home arrival's chip text lands in an always-mounted polite status (A-9).

Motion:

- The snack rises (S-3).
- The arrival slides, glows and counts. Under `prefers-reduced-motion: reduce` or the "Disable
  animations" setting, only the glow and the chip fade play in place (`n-row-glow 2.4s ease-out`,
  `n-plus-calm 2.6s`, `nulo.css:520-523`), and the hero does not count.

### UI asks for the owner (built as recommended, sign-off pending)

Snackbar:

- **S-1 · Placement where there is no nav.** Only the nav case is drawn (76px, 64px nav + 12px).
  Recommended and built: 12px above the bottom edge on Send, the sub-pages, onboarding and the
  dApp windows. It then covers the bottom of footers; in the execute window an error covers the
  approve/reject footer until closed. Alternative: today's top 12px wherever there is no nav.
  **Owner, 2026-09-25: 1c.** 12px above the page's bottom action row where it has one (P6.1).
  Over a sheet that covers the nav: owner, 2026-09-25: 12a, 12px from the bottom or above the
  sheet's own row (P6.5). **Sign-off pending:** in a window shorter than the page, the snack sits
  above where the footer stops at the end of the scroll, so before scrolling it sits 85px up, over
  the page's content (the execute window at 400×500).
- **S-2 · Width on the onboarding tab.** Drawn only at 360px. Recommended and built:
  `calc(100% - 32px)` capped at 368px, the width it takes in the 400px dApp windows (400px less
  the drawn 16px on each side), centered. **The dApp windows: owner, 2026-09-25: 11a**, 328px,
  the 360px content column less 16px a side (P6.4). The onboarding tab stays sign-off pending.
- **S-3 · The rise.** No keyframe or timing is drawn. Recommended and built: `opacity 0,
  translateY(20px)` → rest, 0.15s `var(--bezier)` (today's timing, mirrored); the leave reverses;
  reduced motion fades only.
- **S-4 · Icons.** Drawn: `check-circle` for success, `close-circle` for error. Recommended and
  built: every success takes `check-circle`, so today's `copy`, `download`, `info` and `zap` icons
  go.
- **S-5 · Neutral notices.** 24 sites are neither success nor failure ("Profile locked",
  "Switched to Testnet"). Recommended and built: the success visuals and the 6 s rule, with no third
  kind.
- **S-6 · Borderline classification.** Recommended and built:
  - refusals ("Finish or cancel …", "Accept the Terms to send") are errors;
  - external events and progress notices are successes;
  - "No contacts found" and "No contacts selected" are errors; a cancel notice is a success;
  - "Token added. Couldn't load balance …" is a success;
  - "Network added, but the switch didn't confirm" is an error.
- **S-7 · Where View appears.** Recommended and built: only on messages about one transaction or
  one receipt (send, receipt); copy confirmations and settings saves get no action.
- **S-8 · Details.** No error has a details surface today. Recommended and built: no Details on
  any error in this batch; the API carries an action so a later batch can add one. Alternative:
  "Details" on a failed send opens its journal page (`/popup/journal/:id`). **Owner,
  2026-09-25: 10b**, the alternative (P6.3).
- **S-9 · The send failure's sub line.** Drawn "Not enough Fee Juice for the fee" is sample text.
  Recommended and built: title "Send failed", sub today's sentence (`transfer-failure-copy.ts`,
  three constants).
- **S-10 · Amount format in the sub line and the arrival texts.** Drawn "250 USDC" is sample data.
  Recommended and built: the incoming row's 8-character text (`balanceFormatted(amount, decimals,
  8)`) when it keeps every whole-number digit, otherwise the full amount
  (`balanceFormatted(amount, decimals)`), because the 8-character form slices the whole string and
  would print 123,456,789 as "12345678" (`utils/amount.ts:111-113`). The same rule serves the send
  sub, the arrival snack's title and the chip (A-2). The row itself keeps today's formatter
  (follow-up).
- **S-11 · Long and hostile text.** Recommended and built: title and sub wrap
  (`overflow-wrap: anywhere`); a token symbol, which a token contract controls, and an account
  name, which a restored backup can carry at any length (`wallet/services/account/spec.ts:148`,
  `name: z.string()`), are stripped of control and bidi characters and cut at 32 characters with
  "…" (`sanitizeWireString(x, 32)`) on the snack and the chip. The amount is never cut (S-10); a
  u128 prints at most 52 characters with separators, so the snack wraps to a few lines at most.
  The chip, which does not wrap, is A-14.
- **S-12 · After a hold.** Recommended and built: the remaining time resumes. Alternative: a fresh
  6 s. **The first open: owner, 2026-09-25: 2b.** A success's 6 s starts when it opens, even under
  a resting pointer; only a pointer move onto the snack, or focus entering it, holds it (P6.2).
- **S-13 · Two messages.** Recommended and built: one at a time, the newest replaces the current,
  an error included (today's behaviour). The old snack finishes leaving before the new one rises,
  in the same place, whatever the two kinds, so two never show at once, side by side or
  overlapping.
- **S-14 · Esc.** Recommended and built: Esc does not close the snack (it would compete with the
  popup rule in CLAUDE.md § Keyboard & focus order).
- **S-15 · Across pages.** Recommended and built: a snack stays when the route changes and goes
  when the popup closes.
- **S-16 · Lock and scope changes.** Recommended and built: on lock, any open snack closes; when
  the profile, network or account changes, a snack that carries View closes; a send that completes
  after a lock or a scope change opens no snack (its result stays in the activity list). This
  keeps amounts, recipients and account names off the lock screen and stops View opening another
  account's record.

Keyboard:

- **K-1 · Reaching the snack from inside a popup.** Errors now stay, and many come from popup
  forms, whose focus trap keeps the keyboard out of the snack. Recommended and built: while a
  popup is open, Tab cycles the popup's controls, then the snack's View or ×, then back to the
  popup. When × closes the snack while it has focus, focus returns to the element focused before
  focus entered the snack if it is still on the page, and otherwise nothing is focused (the popup
  rule in CLAUDE.md). Alternative: keyboard users close a popup-raised error only after the popup
  closes.

Rows:

- **R-1 · The ring on lists the mocks don't draw.** Recommended and built: each list's own hover
  tint plus the drawn `2px solid var(--nulo-accent)` at `-2px`.
- **R-2 · Token rows' tint.** Today `color-mix(surface-low 50%)`. Recommended and built: the
  activity rows' `--nulo-surface-low`, since both sit on Home.
- **R-3 · 24×24 inner buttons.** Recommended and built: the amount column and labels move by the
  added width; the awaiting card's reservation grows from 36px to 52px. The awaiting buttons'
  16px width was tuned by the owner (`TransactionAwaitingCard.vue:173-176`); item 11's "at least
  24×24" supersedes it, and the owner confirms here.
- **R-4 · The authorization revoke.** Hidden until hover today. Recommended and built: also
  visible while the row or the button has focus.
- **R-5 · The awaiting "focus" button.** It now duplicates the row. Recommended and built: kept.
- **R-6 · Inert Settings rows.** Recommended and built: they lose their Tab stop; their toggle or
  control keeps its own.
- **R-7 · Hover text inside a link row.** The row's target is stretched over the row, and a
  browser title tooltip shows only for the element under the pointer, so two kept titles would
  stop showing on every link row: the dollar figure's "At today's price" on activity rows
  (`TransactionCardLayout.vue:138`, kept by batch 3's tips map, `dist/shots/text.json`
  "tips-map") and the contact row's S chip, "Registered as sender" (`ContactRow.vue:40`).
  Recommended and built: those two spans sit above the target and pass a plain click to it, so
  the hover text stays and pressing them opens the row; a modified click on them opens the row in
  place, not in a new tab. Alternative: lose the hover text on link rows.
- **Two rows outside the list. Owner, 2026-09-25: 5b.** The Logs row in Settings → Advanced and
  the Revoke authorizations popup's expand icon come under the row rules (P6.6).

Arrivals:

- **A-1′ · What counts on Home.** Drawn: a token hero ("2,514.10"). Real Home shows the aggregate
  USD, which the service refreshes after the receipt is committed. Recommended and built: the
  hero counts only between two aggregates the wallet actually displayed, from the value shown
  before to a higher one, when that change comes within 10 s after the arrival (or came within
  10 s before it); otherwise the chip alone. No count while the aggregate is loading or unknown, or
  while fiat is off. Alternative (the first draft): count from `aggregate − receipt value`, which
  can show a balance that never existed. **Signed off, 9a** (owner, 2026-09-25).
- **A-2 · The chip's text.** Drawn "+1,000 USDC"; the row reads "+1,000.00 USDC". Recommended and
  built: "+" and the S-10 amount, then the S-11 symbol.
- **A-3 · The token page, and receipts already there (amended in rounds 4 and 5).** Recommended
  and built: the token page is "elsewhere", so it gets the snack and its rows do not play. The
  elsewhere snack is only for a receipt that arrives while the page is open: the first read of a
  scope only records the receipts the wallet already holds and opens no snack on any route, and
  those receipts play on Home (or History) when their rows are first shown. That first read runs
  as soon as the popup has a session and a profile, network and account, on whatever screen is
  showing, the lock screen included, where it shows nothing. So a page reloaded on Settings, or a
  popup just unlocked, shows no snack for what came in while it was closed or locked, Home still
  plays it, and the first receipt that arrives afterwards while the person is on Settings gets its
  snack, as the drawing's "Arrives while you're in Settings" (`parts/12-incoming.html:54`) and the
  spec's "otherwise the next popup open" (`../design/spec.md:255-256`) read. No arrival snack
  opens on the lock or register screen or in a dApp window (S-16, A-13). Alternative: the first
  read also announces the newest receipt already there, which then does not play on Home, and on
  a page reloaded on Settings, or just unlocked, shows its amount and account name before the
  person has done anything. **Sign-off pending.**
- **A-4 · Other accounts.** Recommended and built: only the active account on the active network
  plays or gets a snack.
- **A-5 · Several at once.** Recommended and built: on Home and History every new row that renders
  glows and the chip names the newest; elsewhere one snack names the newest, and the other new
  receipts stay unseen and play when their rows are first shown.
- **A-6 · History that arrives late.** Recommended and built: nothing plays for a receipt mined
  in a block the chain had already reached when the account was added or first opened, or when
  its token was added, so importing an account, adding a token with history, or the first open
  after this ships plays nothing. Five edges follow, each on the silent side, and are accepted:
  - a receipt mined in the block the node reports at that moment counts as history;
  - once an account has played more than 500 receipts, an unplayed receipt older than the 500
    newest played stays silent;
  - the floor is the latest proposed block, which the chain can still drop, so a receipt sent
    just after a floor can land at or below it and stay silent;
  - floors never move down, so a local chain restarted under the same network plays nothing
    until it passes the block the wallet last recorded (a testnet reset comes with a new chain
    id, so it is not affected);
  - when the wallet cannot read its arrival state, or a newer read of its receipts fails (the
    node or the service fails either read), the receipts it is showing stay at rest in that popup
    page and play on its next open, and one that arrived during the failure gets no snack (added
    in round 4, widened to the receipts read in round 5: an Allow or a token add has just moved a
    floor the page may not have read).
- **A-7 · The snack marks its receipt seen (amended in rounds 8 and 9).** Recommended and
  built: yes, only the receipt it names, so Home does not replay it. One edge follows: the wallet
  marks the receipt seen a moment before the snack opens. If Home or History opens in that
  moment, no snack opens, and the receipt's row slides once as it first shows, or not at all. If
  the receipt is hidden in that moment (visibility turned off, or it falls under the dust
  threshold), or the wallet locks or switches account, it stays seen and neither the snack nor
  its row plays. **Sign-off pending.**
- **A-8 · "Disable animations".** Recommended and built: it behaves as reduced motion.
- **A-9 · Speaking the Home arrival.** Recommended and built: the chip is a polite status, so the
  "+{amount} {symbol}" is read once.
- **A-10 · Receipts shown by trusting a sender.** Recommended and built: they do not play, on
  any account; Allow moves that token's floor, for every account of the profile on that network,
  to the chain's block at the Allow, so the receipts the person just accepted count as history.
- **A-11 · A receipt shown later than it arrived (amended in rounds 5 and 6).** Visibility
  turned back on, a lowered dust threshold, a quote that lifts it over the threshold, or the
  dust filter failing open while quotes are stale. Recommended and built: its row plays once on
  Home or History, when first shown, if it was mined after the account's first open and after
  its token was first seen; elsewhere it opens no snack, whether the wallet found it before the
  page opened or while the page was open but the receipt was hidden (visibility off, or under
  the dust threshold). The snack names only a receipt that the page's first read after the
  wallet found it shows, so turning visibility on in Settings, or a quote refresh on the token
  page, never announces a receipt as "Received". One edge follows from "first read": a quote or
  threshold change in the fraction of a second between the arrival and that read counts as
  shown, so a receipt lifted over the threshold in that moment is announced. Alternatives: for
  the row, only receipts discovered while shown play; for the snack, the newest revealed
  receipt is announced (the round-4 build), though nothing arrived; or only a receipt found
  while the page was open is announced on its reveal, one found before the page opened is not.
  **Sign-off pending.**
- **A-12 · A new receipt Home cannot show.** Home shows a fixed number of rows
  (`RecentActivityView.vue:97-118`). Recommended and built: a receipt whose row did not render
  stays unseen and plays where its row is first shown (History, or Home later); the chip and count
  follow only rendered receipts.
- **A-13 · dApp windows.** They are popup-app routes. Recommended and built: no arrival and no
  arrival snack in the execute, discover, capabilities and verify windows; the receipt stays
  unseen for the main popup.
- **A-14 · The chip's width.** Drawn `white-space: nowrap`, centered over the hero
  (`nulo.css:517`), with a short sample. A whole u128 amount plus a 32-character symbol is wider
  than the popup. Recommended and built: `max-width: 312px` (the 360px popup less the drawn
  24px side padding, `nulo.css:202`), `overflow: hidden; text-overflow: ellipsis`, so a long chip
  ends in "…". Alternative: the chip wraps.
- **A-15 · A receipt whose amount cannot be formatted.** A token's `decimals` comes from contract
  metadata; an invalid value makes the formatter throw (`utils/amount.ts:238-240`), and a huge
  one reaches `10n ** BigInt(decimals)`. The token row accepts any number (`wallet/services/
  token/spec.ts:45`, `decimals: z.number()`), and the incoming row formats it unchecked
  (`TransactionIncomingCard.vue:41-44`), so today such a row throws while rendering. Recommended
  and built: `isValidDecimals` (`utils/token-amount.ts:14-16`) is checked first everywhere the
  amount is formatted; a receipt that fails it opens no snack and no chip, and its row renders
  with no amount column (the layout's existing empty-amount case, `TransactionCardLayout.vue:135`)
  and plays when first shown. Alternative for the row: a placeholder such as "—" in the amount
  column.
- **A-16 · Two open documents.** The row plays from its first paint, before the service's claim
  answers, so a popup and a tab (or two tabs) that show the same new row at the same moment both
  animate it; the stored claim, the chip, the count and the snack stay single. Recommended and
  built: accept it. Alternative: claim before painting, which shows the row at rest first and
  slides it a moment later, the flicker the drawing does not have.

## Architecture & Implementation

### The toast composable (`packages/design/src/composables/toast.ts`, item 10)

- API:
  - `openToast({ kind: "success" | "error", label, sub?, action?: { label, onSelect } })`.
  - `closeToast()`, `holdToast(held: boolean)`, `SUCCESS_TOAST_MS = 6_000`.
  - `TOAST_DURATION`, `icon`, `color` and the duration argument are deleted in the same phase that
    migrates every caller, so no phase has a half-old API.
- State: the singleton `toast` ref gains an `id` (a counter), so replacing a snack with the same
  text re-renders and re-renders its region.
- Timer: `success` arms one close timer at 6 s and records its deadline; `error` arms none.
  `holdToast(true)` clears the timer and keeps the remainder; `holdToast(false)` re-arms it with
  the remainder (S-12). Both are idempotent: a repeated report changes nothing. `closeToast` and
  every open clear the timer and the hold; `closeToast` on nothing is a no-op.
- A missing or unknown `kind` is treated as `error`, so a message of unknown class never leaves on
  its own. The source scan keeps that branch unreachable from the extension.
- Selecting the action closes the snack, then runs `onSelect`.
- The design package's TSDoc states the contract: success 6 s and held while hovered or focused,
  error until closed, one at a time.

### The snack (`packages/design/src/ui/ToastManagerBase.vue`)

- Always mounted: `<Teleport :to="teleportTo" defer>` holds two regions, a
  `<div role="status" aria-live="polite" aria-atomic="true">` and a
  `<div role="alert" aria-atomic="true">`, and the snack renders inside the one matching its kind,
  each region with its own `<Transition mode="out-in">`. The regions exist before the text
  arrives, which is what lets browsers announce it.
- Replacement (S-13): the view renders `shown`, a copy of the shared toast. A replacement of the
  same kind is `out-in` in its region. A replacement of the other kind first sets `shown` to
  nothing and marks a leave as waiting, so the old card finishes leaving before the new one rises,
  across regions too; while a leave waits, a change of the shared toast only waits with it. The
  leaving region's `after-leave` then sets `shown` to the shared toast as it is at that moment,
  never to a copy taken earlier: after a `closeToast()` (the lock's included, S-16) it is nothing,
  after a newer open it is the newest. The view keeps no pending copy, so nothing can be installed
  after a close, and an `after-leave` that runs after unmount does nothing.
- Wrap: `position: fixed; left: 0; right: 0; bottom: <bottomInset>px; pointer-events: none;
  z-index: 2000` (the drawn wrap, `nulo.css:189`, with `fixed` for the popup's viewport and
  today's z-index, so it stays above popups up to the third level, `Popup.vue:98`), laid out as
  `display: grid` with both regions in the same cell (`grid-area: 1 / 1`), each stretched to the
  full width and laid out as the drawn wrap, `display: flex; justify-content: center`, so the
  card's `calc(100% - 32px)` resolves against the viewport as drawn. `bottomInset` is a new prop,
  default 12.
- Snack, `data-testid="snackbar"`, `data-kind`: the values in UI impact rows 1 to 3, width
  `calc(100% - 32px)` with `max-width: 368px` (S-2); `pointer-events: auto`.
  - Icon: `<Icon>` `check-circle` or `close-circle`, 16px, `--green` or `--red`,
    `aria-hidden="true"`.
  - Text: `snackbar-title`, `snackbar-sub`; `overflow-wrap: anywhere` (S-11).
  - Action: a `<button type="button" data-testid="snackbar-action">` with the drawn `.n-snack-act`
    values.
  - Close (error only): `<button type="button" aria-label="Close" data-testid="snackbar-close">`,
    24×24, `margin-right: -6px`, `<MaterialIcon name="close" :size="16">` in `--nulo-secondary`.
  - No click-to-close on the card (round-1 note, "Clicking elsewhere leaves it running out",
    `parts/10-toasts.html:44-48`).
- Hold: the view keeps `hovered` (`mouseenter`/`mouseleave`) and `focusWithin` (`focusin`, and
  `focusout` whose `relatedTarget` leaves the card) separately and reports
  `holdToast(hovered || focusWithin)` whenever either changes. On every new id it re-derives both
  from the rendered card (`matches(":hover")`, `contains(document.activeElement)`), since a snack
  that replaces another under a resting pointer gets no `mouseenter`. Unmount releases a hold.
- Transition: its own module classes through `enter-from-class`, `enter-active-class`,
  `leave-to-class` and `leave-active-class` (S-3), and an opacity-only variant under
  `prefers-reduced-motion: reduce`. `base.css`'s `.toast-*` rules stay, unused.
- `ToastManagerBase.stories.ts`: success with View, error with ×, a long wrapped message.

### The wrapper and the shells

- `components/ui/ToastManager.vue` passes `:bottomInset="route.meta.showBottomNav ? 76 : 12"` (76
  from `r2/i10.html:20`; 12 is S-1). Its comment keeps one sentence: why the tag resolves locally.
- `composables/toast.js` and `.d.ts` re-export the new names; the "design-system round-2" comment
  goes.
- `popup/app.vue` and `onboarding/app.vue`: `<div id="toast" />` moves to the end of the template,
  so the snack's buttons come after the page in Tab and reading order. `defer` on the teleport
  resolves the later target.
- `popup/app.vue` (S-16): the lock's seal (`popup/locked-state.ts`) calls `closeToast()` and
  clears `isLogined` before the lock event awaits its profile lookup, and a `flush: "sync"` watcher
  on `isLogined` does the same the moment the header marks the popup locked; a `flush: "sync"`
  watcher on the active profile, network and account ids closes the snack when it carries an
  action (only transaction and receipt snacks do, S-7). Both bump a new `appStore.scopeEpoch`
  counter, the one fence Send and the arrival coordinator compare after an await, so a round
  trip (A → B → A, or lock → unlock) is caught where comparing the final ids is not.

### Focus from a popup (`components/Popup/Popup.vue`, K-1)

- The trap takes two containers: `createFocusTrap([container, document.getElementById("toast")],
  …)`, the second only when the anchor exists (Storybook has none). `#toast` is always in the DOM,
  and focus-trap 8.2.2 recomputes its tabbable nodes on every Tab (`focus-trap.esm.js:559-565`), so
  a snack that opens later is reachable with no container update. Stacked popups keep working: only
  the top trap is active. Esc on the snack's × reaches the trap's handler and closes the popup,
  which is S-14.
- The invisible `aria-hidden` "focus trap dummy" button (`Popup.vue:102-105`, with its "Need to
  refactor !!!" comment) goes: it is a Tab stop inside the K-1 cycle, and a focusable element
  under `aria-hidden`. The wrapper gains `tabindex="-1"`, so the existing `fallbackFocus:
  container` (`:61`) is focusable when a popup has no tabbable control.
- The snack records the element focused when focus first enters it from outside, and × restores
  focus there if it is still connected (K-1).

### Call sites (item 10: "decided per call site and listed in the PR body")

- Every one of the 130 calls in 56 files takes a literal `kind`; icons, colours and durations go.
  The per-site table (file:line, message, kind, rule) is generated in P1 into
  `lessons/phase-1.md` and copied into the PR body. The rules: a failure, a refusal or a state the
  person must act on is `error`; everything else is `success` (S-5, S-6); a ternary between two
  messages takes `kind: cond ? "success" : "error"` in the same order.
- `utils/clipboard.ts`: `CopyToastSpec` keeps only `label`; the copy success is
  `kind: "success"` and the failure `kind: "error"` (the `3_000` goes). That covers the 20 direct
  callers; the three that pass their own spec (`IncomingTrustPopup.vue:78`,
  `received/received-copy.ts:10`, `components/header-copy-address.ts:13`) drop their icon and
  duration.
- A source scan, `utils/toast-call-sites.test.ts`, in the `call-sites.test.ts` style
  (`wallet/services/legal/call-sites.test.ts:11-22`):
  - every `openToast(` in `apps/extension/src/**/*.{ts,js,vue}` (tests excluded), matched across
    whitespace and newlines (five calls put `{` on the next line), opens an object literal whose
    `kind` is `"success"`, `"error"`, or a ternary of the two, and has no second argument;
  - no argument names `icon:`, `color:` or `TOAST_DURATION`;
  - the count is at least 100 (130 today), so it cannot pass vacuously.

### Send (`popup/pages/send-submit.ts`, UI impact row 4)

- `SubmitDeps.executeTransfer` is typed `Promise<string>`, the hash the service already returns
  (`wallet/services/execution/service.ts:469-489`).
- `TransferSnapshot` gains `symbol`, `decimals` and `epoch`
  (`appStore.scopeEpoch`), filled by `snapshotTransfer` (`send.vue:383-407`) from
  `activeToken.value` and `appStore`.
- After the await, a new `deps.isCurrent(epoch)` (`appStore.isLogined` and `appStore.scopeEpoch`
  still equal to the snapshot's) gates both snacks; when it fails, nothing opens (S-16). An
  account switched away and back, or a lock and unlock, during the send moves the epoch.
- Success: `kind: "success"`, `label: "Transaction submitted"`, `sub: "{amount} {symbol} to
  {trimAddress(dest, 6, 4, "…")}"` with the S-10 amount and the S-11 symbol. View calls a new
  `deps.viewTransaction(hash)` (`router.push(\`/popup/tx/${hash}\`)` in `send.vue`), offered only
  when the hash matches `/^0x[0-9a-f]{64}$/i`.
- Failure: `kind: "error"`, `label: "Send failed"`, `sub: transferFailureCopy(err)`. A cancel stays
  silent (`send-submit.ts:65`).

### Rows (item 11)

- **`components/ui/RowTarget.vue`** (L2, local and host-coupled, like `Button.vue`: it renders
  `RouterLink`): the row's one focusable element, `data-row-target`.
  - With `to`: `<RouterLink custom v-slot="{ href, navigate }">` rendering `<a :href>` with
    `@click="navigate"` (the `Button.vue:34-53` pattern) and `@keydown.space="navigate"`, with no
    `.prevent`: vue-router's `guardEvent` refuses an event whose default is already prevented
    (vue-router 5.2.0, `dist/vue-router.cjs:2111-2121`, the check at `:2113`; `navigate` at
    `:2030-2037`), so `.prevent` would make Space inert;
    `navigate` prevents the default itself when it navigates (`:2119`), so the page does not
    scroll. Enter navigates once through the anchor's native click; a modified click or key
    keeps the browser's default (a new tab), as an ordinary link does. No row runs a side effect
    before navigating: the contact row carries its contact in the URL (below).
  - Without `to`: a `<button type="button">` with no handler; its click (pointer, Enter, Space)
    bubbles to the row root's listener.
  - It is stretched over the row (`position: absolute; inset: 0`), transparent, and is the hit
    surface; it has no outline of its own. `aria-labelledby` names the row's visible text (ids
    from Vue's `useId()`).
  - One comment says why it is stretched: nested controls stay siblings above it, not
    descendants of a link or button.
  - It exposes `activate()`, which clicks its element. A titled span that must keep its hover
    text (R-7: `activity-fiat` in `TransactionCardLayout.vue:138`, `contact-sender-chip` in
    `ContactRow.vue:37-43`) carries `position: relative; z-index: 1` and
    `@click.stop="target?.activate()"`, so its title shows and a press still opens the row once:
    without `.stop`, in button mode the span's own click would reach the root's listener and the
    button's forwarded click would reach it again.
- **The row root** carries `$style.interactive` when it has a target: `position: relative`,
  `cursor: pointer`, `transition: background 0.15s var(--bezier)`, `:hover` and
  `:has(> [data-row-target]:focus-visible)` tint, the ring on the latter, `:active`
  `--nulo-surface-high`. Inert rows carry none of it and no `tabindex`.
- **`RowAction`** (L2, router-free, so in `packages/design/src/ui/RowAction.vue`, exported and
  added to `NULO_DESIGN_COMPONENTS` in `apps/extension/scripts/design-resolver.ts`): a 24×24
  `<button type="button">` (or an `<a target="_blank" rel="noopener noreferrer">` with `href`) with
  a required `label` (`aria-label`), the icon centered at its current size, `@click.stop`,
  `position: relative; z-index: 1` above the target, and the testid passed through. CLAUDE.md
  § L0–L6 gains `RowAction` in the L2 list and `RowTarget` as the fourth host-coupled holdout.
- **`TransactionCardLayout.vue`** (L3) owns the interactivity, as `parts/11-rows.html:44` says
  ("Wrappers stop adding their own"):
  - new props `to` (a route) and `opens` (a boolean; the root emits `activate` on click); it
    renders `RowTarget` when either is set;
  - root box `margin: 0 -8px; padding: 6px 8px` (`nulo.css:223`), the actions slot moves to
    `right: 8px`, reservations grow for 24px buttons (R-3);
  - the testid and the `data-tx-*`, `data-stage`, `data-backend` attributes stay on the root;
  - an `arriving` prop puts the arrival class on the root (`n-row-in` + `n-row-glow`) and on the
    amount span (`n-amt`), which is this component's element (`:136`), with `data-arriving="true"`
    on the root;
  - the docblock (`:4-10`, "plan-v4 Branch 4") shrinks to the layout's contract; the slot
    comment at `:71-83` shrinks to its invariant (slot presence does not prove rendered content,
    and slot VNodes are not reactive dependencies, so it is a method, not a `computed`); the
    `actionCount` doc's "16px" (`:67`), the reservation paragraph with its chip history
    (`:153-163`), "Two 16px buttons" (`:168`) and the "tuned manually" note (`:173-175`) go with
    the values they describe (R-3).
- **The four cards**:
  - `TransactionCard.vue`: its `.row` pointer and 50% tint go; the explorer link
    (`:193-202`) becomes a `RowAction` with `href`, in place.
  - `TransactionIncomingCard.vue`, `TransactionTerminalCard.vue`: pass `to` through; the incoming
    card also passes `arriving`, and its `formattedAmount` (`:41-44`) returns `null` when
    `isValidDecimals(tokenDecimals)` fails (A-15). The incoming card's docblock (`:2-12`, "a
    decrypted note" only, and an icon name, `download`, that the template does not render,
    `:55-56`) is corrected to cover public receipts and drop the icon sentence.
  - `TransactionAwaitingCard.vue`: `opens` only when `focusable` (`:65`), so a queued row looks
    like a settled one and other stages are inert; its two buttons become 24×28
    (`tx-awaiting-focus`, `tx-awaiting-cancel`, aria labels unchanged); the "Phase 2 follow-up"
    lines (`:8-14`, `:44-45`), the stale "no ARIA role" paragraph (`:16-18`) and the 16px
    justification (`:173-176`) go.
- **`TransactionsList.vue`** and **`RecentActivityView.vue`** pass `to` (`/popup/tx/${hash}`,
  `/popup/journal/${op.id}`, `/popup/received/${inc.id}`) instead of `@click` → `router.push`, and
  `@activate` to the awaiting card's focus handler. `handleSelectRow` and the three
  `handleSelect*` go with their comments; `TransactionsList.vue`'s docblock (`:2-20`, history plus
  a false "only tx rows are clickable") goes.
- **Other lists** (UI impact row 7), each kept in its own tint (R-1):
  - `SettingItem.vue`: `disabled` decides first: a disabled row is an inert `div` with no target,
    no `href` and no handler, whatever `to` or `@click` it carries. Two callers disable a row that
    has a mode (`settings/profile/index.vue:43`, a click row that only navigates, and
    `settings/networks/[id].vue:166`); today `:tabindex="disabled ? -1 : 0"` and the emptied `:to`
    keep them off the Tab path (`SettingItem.vue:46`, `:50`), while `pointer-events: none`
    (`:135-138`) stops only the pointer, so an `<a href>` or a `RowTarget` there would be a Tab
    stop that Enter opens. Otherwise the mode comes from `to`, `useAttrs().onClick`, or neither. Link rows keep
    an `<a>` root and gain Space and the ring: an internal link renders through `<RouterLink custom
    v-slot="{ href, navigate }">` with `navigate` on click and on `keydown.space` (no `.prevent`,
    as in `RowTarget`), since a plain `router-link` root (`SettingItem.vue:44-51`) exposes no
    `navigate` and a hand-rolled push would skip `guardEvent`'s modifier rules; an external row
    (`<a target="_blank">`, `:47-48`) answers Space without a modifier with `.prevent` and the
    anchor's own `click()`, since an anchor has no native Space action. No root carries a
    `tabindex` (`:50` goes): a link is focusable natively. Click rows keep the `div` root (three
    of them nest controls: `AccountsPopup.vue:74`, `settings/accounts/index.vue:83`,
    `settings/networks/[id].vue:196`) and render `RowTarget` as a button. Inert, `raw` and
    `disabled` rows get no `tabindex`, hover or pointer (R-6). The `.raw` block's hover override
    goes with it. A click row whose handler only navigates is a link under item 11: the P3
    inventory lists each one and it becomes a `to` row.
  - `TokenCard.vue`: the `RouterLink` root (`:70`) becomes `RouterLink custom` with `navigate` on
    click and Space, the same way, and gains the ring and `--nulo-surface-low` (R-2).
  - `ContactRow.vue`, `connected-apps/index.vue`: `role="button" tabindex="0"` with Enter only →
    `RowTarget` link (the app's detail page; for a contact, `/popup/send?contact=<id>`); the
    nested `span role="button"` actions → `RowAction` (testids kept, `session-disconnect`
    included).
  - The contact preselection moves into the URL. Today `popup/pages/settings/contacts/index.vue:
    118-121` writes the contact into the Pinia `cacheStore.preselectedContactToSend`
    (`stores/cache.store.ts:21`), which a new tab's document does not share, and Send reads it at
    `send.vue:539-542`. Send now resolves `route.query.contact` against the contacts it already
    loads for the active profile (`send.vue:474-499`), the way it resolves `route.query.tokenId`
    (`:529-536`); an id that is not one of them selects nothing. `preselectedContactToSend`, its
    reset (`send.vue:576`) and `handleClickContact` go.
  - `AuthwitCard.vue`, `notes/index.vue`: `div @click` → `RowTarget` (link or button by what the
    row opens); the revoke glyph → `RowAction`, shown on hover and on `:focus-within` (R-4).
  - `FpcRow.vue`, `AccountsPopup.vue`, `settings/accounts/index.vue`, `settings/tokens/index.vue`,
    `senders/index.vue`, `settings/networks/[id].vue`: bare `<Icon @click.stop>` → `RowAction`
    (`fpc-edit-btn`, `fpc-delete-btn`, `account-export-btn`, `account-edit-btn`, `account-hide`,
    `sender-delete`, `endpoint-edit-btn`, `endpoint-delete-btn` kept); inert rows lose hover.
  - `settings/advanced/account-state/contracts/index.vue:77`: pointer and hover with no action →
    inert.
  - `SelectTokenPopup.vue`, `SelectProfilePopup.vue`: inherit `SettingItem`'s click mode.
- `RowAction` inside batch 3's `Tooltip` (`FpcRow.vue:46-79`, `AccountsPopup.vue:87-98`,
  `settings/networks/[id].vue:209-232`): batch 3's press rule closes the tooltip and cancels no
  key's default, so Enter and Space still activate the button; P3 proves it in the browser.
- The P3 inventory table (list, file:line, before, after) goes into `lessons/phase-3.md` and the PR
  body.

### Arrivals (item 12)

The seen state answers one question per receipt: has this account already been shown it? It is
keyed by receipt id, since a local `discoveredAt` watermark loses same-millisecond receipts and
replays history the wallet discovers late (recon facts 12, 12a). Floors in the chain's own block
numbers keep late history silent (A-6): a receipt sent after a floor was taken is mined in a
higher block, whatever the device clock says, and `l2BlockNumber` is a required field of every
record (`spec.ts:63-64`, `:130`), where `blockTimestamp` is optional and backfilled without an
event (`service.ts:1201-1211`).

The incoming-transfer service owns the state. It already serializes every write under its lock
and fences writes that follow an await by `serviceEpoch` (`service.ts:1201-1211`), it is where
history gets committed (account add, token add, Allow), and every deletion path already awaits
its purges (`profile-deletion/coordinator.ts:122`, the chain fan-out at `service.ts:319-321`,
`purgeDeletedAccountOnNetworkLocked` at `:407-436`). A UI-side key with a Web Lock could not
share that lock with the purges, nor see an Allow on another account.

- **Pure module `wallet/services/incoming-transfer/arrival-state.ts`**, beside `spec.ts`, imported
  by the service and by the popup coordinator (the popup already imports `spec.ts`,
  `useIncomingTransfers.ts:4`):
  - `ArrivalState = { sinceBlock: number | null, floors: Record<string, number | "pending">,
    played: string[] }`, the view the popup holds; `sinceBlock: null` plays nothing.
  - `isArrivalEligible(record, state)`: `sinceBlock` known, the id not in `played`, the contract's
    floor not `"pending"`, and `record.l2BlockNumber > max(sinceBlock, floors[contract] ?? -1)`.
  - `claimPlayed(row, records)`: adds `[id, l2BlockNumber]` for each; when more than 500 entries
    remain, it raises `sinceBlock` to the block of the newest entry past the 500 newest and keeps
    only entries above it. An evicted receipt then sits at or below the account floor and can
    never play again; the cost is A-6's second edge.
  - The stored row's zod schema: `sinceBlock` a non-negative safe integer; `played` at most 500
    pairs of an id of at most 200 characters (`note:<profile>|<network>|<nullifier>` and
    `pub:…|<txHash>|<idx>` fit) and a non-negative safe integer. A row that fails to parse reads
    as missing.
- **Storage** (`repository.ts`, pre-production, so no migration): a new EntityStorage table
  `nulo:core:incoming-arrivals` keyed `${profileId}|${networkId}|${accountAddress}` holding
  `{ sinceBlock, played }`; the trust row (`IncomingTrustRecord`, `spec.ts:156-172`, keyed per
  profile, network and contract) gains an optional `arrivalFloor: number` and an optional
  `arrivalFloorPending: true`; `getArrivalState` reports a pending floor as `"pending"`, whatever
  number it retains. `repo.setTrust` (`repository.ts:107-111`) keeps both stored fields unless
  its caller passes them, because three transitions call it directly rather than through
  `_setTrustStateLocked` (`service.ts:1036`, `:1223`, `:1921`). Neither is in a backup slice
  (`wallet/services/backup/backup-migration-registry.ts` has no incoming entry).
- **The chain tip**: a new PXE service method `getLatestBlockNumber(network)`, serving
  `node.getBlockNumber()` with no tag, which is the latest proposed block (`@aztec/stdlib` 5.2.0
  `dest/interfaces/aztec-node.d.ts:143-146`). It is added where `getPublicScanTips` is, in
  `packages/aztec-runtime/src/pxe/`: `spec.ts:100` (Methods), `descriptors.ts:64` (`rpc: true,
  ipxe: false, requiresNetwork: true`; `descriptors.test.ts` gains it in `SW_ONLY` and its
  method count moves from 25 to 26), `service.ts:101` and `:686-687` (the rpc list and a
  `withPxeRead(…, (_pxe, node) => node.getBlockNumber())`), and `client.ts:356-357`
  (`PxeServiceClientBase`). The incoming service reads it through its `PublicEventReader`
  (`public-event-indexer.ts:26-30` gains `getLatestBlockNumber(networkId)`; the adapter at
  `service.ts:272-287` forwards it), so the scenario tests' injected reader (`:211`, `:234`) fakes
  the tip. The public scan's tips are checkpointed (`public-events.ts:393-406`) and lag blocks
  whose notes the PXE has already synced, so they cannot serve as the floor. The service reads the
  tip outside its lock, as it already does PXE I/O (`service.ts:1107-1108`), fresh every time it
  writes from it, with no cache: only floor writes, baselines and pending-floor resolutions read
  it, and nothing is ever lowered to it.
- **Where floors are taken**, each with a fresh tip read before the lock and written inside it,
  before the history it covers is committed:
  - `onAccountAdded` (`service.ts:341-374`): in its existing critical section, before the cursor
    reset, the new account's row gets `sinceBlock = tip` on each network of its chain, unless a
    row exists.
  - `onTokenAdded` (`:930-958`): in its critical section (`:947`), before `hydrateSchedulers`
    starts the scans, the token's `arrivalFloor = max(stored, tip)`, on every add.
  - `setTrustAllow` (`:578-608`): inside its lock (`:580`), before the flip, `arrivalFloor =
    max(stored, tip, the highest l2BlockNumber among the records it un-hides)`. `listByContract`
    returns every account's records (`:592`, `repository.ts:96-98`), and the trust row is per
    contract, so one floor covers every account of the profile on that network (A-10).
    `PopupManager.vue:99` is unchanged.
  - Every numeric floor write takes the max with the stored number, pending or not, and clears
    the pending mark, because two writers for one contract each read their tip before the lock
    and can enter it in the other order: an add that read N waiting behind an Allow that read
    N + k would otherwise write N back.
  - A failed tip read marks the token's floor pending (a re-added token's history must stay
    silent) and keeps the stored number, if any, as its lower bound; it writes no row for an
    account. The next `getArrivalState` that reads a tip resolves the network's pending floors to
    `max(retained number, tip)`, writing only a floor that is still pending inside the lock. Until
    then nothing of that token plays. Keeping the number is what keeps "never lowered" true across
    a failure: 200, then pending, then a tip of 150 resolves to 200, not 150; Allow keeps every
    record it un-hid (`service.ts:592-605`), so a floor lowered to a lower tip would make that
    history eligible.
- **`getArrivalState(profileId, networkId, accountAddress)`** (new method; a passthrough added to
  `client.ts:36-48`): the account's row and the network's floors, as an `ArrivalState`. A missing
  or unparsable row is baselined to the tip (nothing plays that time, A-6), but only while the
  profile service still lists the profile (a tombstoned profile is absent to every read,
  `profile/service.ts:577-581`) and the network and account still exist; otherwise it returns
  `sinceBlock: null` and writes nothing. It reads a tip only to baseline or to resolve a pending
  floor. A stored `sinceBlock` or floor is never lowered: a floor raised by eviction has already
  forgotten the ids beneath it, so lowering it to a stale or restarted chain's tip would replay
  them (the restarted-chain cost is A-6's fourth edge).
- **`claimArrivals(profileId, networkId, accountAddress, ids)`** (new): captures `serviceEpoch`,
  and inside the lock reads each record by id, keeps those in this scope that are still
  eligible, then writes the row through `claimPlayed` only when the epoch is unchanged and the
  lock's `isCurrent()` still holds (a watchdog force-release after five minutes admits a successor
  while the displaced section keeps running, `packages/wallet-core/src/utils/lock.ts:79-88`, and
  moves no epoch), and returns the ids it claimed. It writes nothing when it claims nothing. Every
  other arrival write (baselines, floors) checks the same two things before writing. Ids of another scope, played ids and
  unknown ids are ignored, so a stale or hostile document cannot mark or replay anything
  outside its scope.
- **Purges**: `clearProfile` (`:633-660`), `clearChain` (`:662-686`) and
  `purgeDeletedAccountOnNetworkLocked` delete the arrival rows of their scope in the same
  critical section as the records they already delete; the floors go with the trust rows. Each
  of them bumps `serviceEpoch` (`:639`, `:667`, `:401`), so a claim that read before a purge
  refuses to write after it, and a claim or baseline after it finds no records and no profile:
  no residue window.
- **The coordinator, `composables/useArrivals.ts`** (C1), mounted once in `popup/app.vue`, which
  owns its incoming-transfer, token, config and price clients (connect; every `disconnect()`
  before the composable's `dispose()` in `onBeforeUnmount`):
  - Its reads run whenever the session is logged in with a complete scope (profile, network,
    account), on every route. An unlock sets the session before `loadProfile` pushes Home, and
    that push is a route change, not a scope change, made only from `popup-auth` or
    `popup-register` (`popup/app.vue:309`, `should-advance-to-general.ts:3`, `:19-21`, Fact 35);
    a read gated on the route would skip the unlock's seeding read, so the first receipt to reach
    Settings afterwards would seed instead of announce (the drawn `12-incoming` case). The route
    gates only what is shown: no snack opens and nothing is claimed on `popup-auth`,
    `popup-register` (the `AUTH_ENTRY_ROUTES`) or a `windows-*` route (S-16, A-13; a candidate a
    read finds there joins `known` unclaimed and plays on Home), and `isArriving` and `present`
    answer only on Home and History (below). In a dApp window the reads are storage reads through
    the service, plus a tip read only when a row is baselined or a floor is pending. It fences
    every await on `appStore.scopeEpoch`, on its own disposal,
    and on a read generation: each of its reads takes one new number, which the read's nested
    `load` reuses, and a `load` invoked on its own (a list's `afterRead`) takes its own; a result
    whose number is no longer the newest is dropped before it assigns state or claims; a claim
    already sent is the one exception (below).
    That is the list's `refreshSeq` rule (`useIncomingTransfers.ts:67-80`, one number per logical
    refresh); without it an older read that returned a visible record could finish after a newer
    read with visibility off, which moves no epoch, and still open a snack. A list `load` can drop
    a read only on Home and History, where reads open no snack, because only those lists pass
    `afterRead` (below).
  - It holds the current scope's `ArrivalState` in memory. `load(scope)` calls `getArrivalState`
    and keeps the result when the epoch and the generation have not moved, merged with the ids it
    has claimed since. `load` never rejects. A failed `getArrivalState`, or a coordinator read of
    the newest generation whose `getIncomingTransfers` rejects before it reaches `load`, marks the
    scope suppressed: nothing is eligible, as with `sinceBlock: null`, until a later `load`
    succeeds. Keeping the earlier state instead would judge records just un-hidden by an Allow, or
    committed by a token add, against a floor from before it (`setTrustAllow` emits Added for each,
    `service.ts:593-605`), and they would animate; the cost is A-6's fifth edge. A `load` whose
    result a newer generation drops resolves only once no newer generation is in flight (each
    one settles, and one that fails at either step suppresses the scope before the dropped `load`
    resolves), so a list that awaits it assigns its rows under the newest state, or at rest, and
    never under the one that state replaced.
  - `isArriving(record)` is synchronous and false on any route other than Home and History. There,
    an id it has already judged answers only from its window: true for 2,600 ms after it was
    first judged, and only on the route that judged it (so History mounted from Home inside the
    window does not slide it again). An id rendered while the scope is suppressed is judged at
    rest and stays false in this document, so a row first shown at rest never slides once a later
    `load` succeeds; it stays unclaimed and plays on the next open. Any other id never judged
    answers `isArrivalEligible(record, state)`; a true answer records its time and route and arms
    one timer that bumps a reactive
    version at 2,600 ms (the longest drawn animation, so hover works again afterwards; a `both`
    fill would hold the glow's background over `:hover`). Eligibility is not consulted again for a
    judged id, so a receipt whose claim another document won stops after its 2.6 s. `RecentActivityView` and
    `activity.vue` inject the coordinator and pass `isArriving(inc)` to each incoming card as its
    `arriving` prop, so the row carries the class on its first paint and slides once, as the
    drawing does (`page.js:653-656`); the L3 card never injects from the shell.
  - `present(records)`: the lists call it after the render that showed rows as arriving, with
    those records. It sends `claimArrivals` and adds the claimed ids to `played`; on Home it then
    sets `latest` (`{ id, label }`) to the newest claimed record for the chip, so a document
    that lost every claim shows no chip (A-16). Home renders a row budget
    (`RecentActivityView.vue:97-118`), so a receipt whose row did not render is never passed and
    stays unseen (A-12).
  - Its own reads, for the elsewhere snack: at start and whenever the session and a complete
    scope return (an unlock included), on `onConnected`, on a scope change, after
    Added (one read 250 ms after the last Added, and at most 1 s after the first, so a steady
    stream cannot postpone it), on the config keys `incomingTransfersVisible` and
    `incomingDustUsdThreshold`, and on `onQuotesUpdated`: the triggers the list already uses
    (`useIncomingTransfers.ts:111-135`), each added once and removed in `dispose()`, as is the
    `onIncomingTransferDeleted` listener below, which starts no read. A read is
    `getIncomingTransfers`, then `load`, in that order: every floor is written before the history
    it covers is committed, so a state read after a records read covers every historical record
    that read returned.
  - It keeps `known`, the ids its earlier reads in this scope returned: every read that completes
    in the scope adds its ids, even one a newer generation drops or one whose state was
    suppressed, since an id a read returned was already there. The first read to complete in a
    scope only seeds `known` and records `seededAt`, the device time at which that read started:
    it opens no snack and claims nothing (A-3, amended), so the receipts that came in while the
    page was closed or locked play on Home instead of being announced, and claimed, on whatever
    route the page opened on. It then sets `seeded`, which the shell mirrors as
    `data-arrivals-seeded="true"` on its root, a test hook with no visible effect. Elsewhere (the
    token page included, A-3) and off the auth and window routes, the snack candidates of every
    later read are the eligible records it settles from `announced` (below) whose `discoveredAt`
    is later than `seededAt` (A-11, amended): a record a later read returns only because
    visibility was turned on (`getIncomingTransfers` returns nothing while it is off,
    `service.ts:455`), the dust threshold was lowered or a quote lifted it (dust is filtered
    last, `:460`) has no unsettled Added, so it joins `known` and plays on its row only. Both times are the device
    clock (`discoveredAt` is `Date.now()` at commit, `spec.ts:76`, recon fact 12a), so no chain
    time is compared and Disputed 3 stands; `setTrustAllow` keeps `discoveredAt` (Fact 14), so
    Allow's records are also silent by this rule, besides their floor. Candidates come only from
    **`announced`** (A-11, amended in rounds 6 and 7), never from `known`: the ids whose Added
    reached this page after the seeding read started, each with the device time its Added
    arrived. It is per scope and cleared with `known`. An id is settled by the first read that
    started after its Added and completes as the newest generation. If that read returns it
    eligible, it is a candidate; if the read leaves it out, or fails (A-6), the id leaves
    `announced` with no snack. A read that started before the Added, or one a newer generation
    supersedes, leaves the id unsettled for the next read. Adding an id to `known` never settles
    it, so a read that started before the Added and returned the just-persisted record
    (`service.ts:1268` persists before `:1270` emits) cannot silence it. A record discovered
    while visibility is off gets no Added (`:1270`), and one the settling read filtered as dust
    (`:460`) leaves unannounced, so either, revealed later, plays on its row only. Allow emits
    Added (`:603`); its floor and `discoveredAt` keep those records ineligible. The comment on
    `announced` states the ownership rule: only the settling read decides an id. It claims the
    newest candidate whose decimals pass `isValidDecimals` (A-15), and when the claim returns that id it
    opens one success snack (A-5, A-7): title `Received {amount} {symbol}` (S-10, S-11), sub
    `Private · {account name}` for a note or `Public · {account name}` for a public event, View →
    `/popup/received/${id}`. It builds the text from `amountRaw`, the token's symbol and decimals,
    the record's `kind` and the account name only, never through `buildIncomingCardProps`, which
    reads `from` (`received-display.ts:30-35`, `:69`). Every read then adds its ids to `known`, so
    the older members of a batch never become later snacks; they play on their rows (A-5). On
    Home and History a read opens no snack. A claim, once sent, owns its id (A-7, amended in
    rounds 8 and 9): only a lock, a scope change or disposal drops its result, never a newer
    generation, because a successful claim has already marked the receipt played, so no later
    read could announce it. Its id has left `announced`, so no newer coordinator read claims it
    again (a list's `present` may still ask, and the claim's locked eligibility check lets only
    one succeed). When the claim returns the id, the snack is decided by the receipts of
    the newest coordinator read: if a coordinator read that started after the settling read is in
    flight, the snack waits for the newest such read's `getIncomingTransfers` (a newer
    coordinator read replaces it as the decider, whenever the older one completes). A list
    `load` reads arrival state only, never the filtered receipts, so it neither decides a pending
    snack nor makes one wait, though it takes a generation for state. The snack opens only if the
    route still allows one and the deciding read, or the settling read when no coordinator read
    started since, returned the id; a deciding read that leaves the id out, or fails (A-6), opens
    no snack, and the id stays claimed. The wait ends in practice: Added reads coalesce within
    1 s and quotes refresh every three minutes (`price/service.ts:27`). Any read that started after the settling read
    also started after the receipt was stored, so leaving the id out means visibility or the dust
    filter now hides it. The comment on the claim says why its result outlives its read.
    `onIncomingTransferDeleted` removes its record's id from `announced` and vetoes a pending
    snack for it, whatever the deciding read returns: a read can capture a receipt before its
    asynchronous dust filter (`service.ts:456-460`) while reconciliation or a purge deletes it
    (`:430`, `:1027`, `:1071`, `:1809`), so no snack opens for a receipt already gone. A claim
    already persisted stays; nothing reads a deleted record's claim.
  - A lock or a scope change (a new `scopeEpoch`) drops the state, `known`, `seeded`,
    `seededAt`, `latest` and every timer; `dispose()` does the same and removes the listeners. The parent calls it in
    `onBeforeUnmount`, after the clients' `disconnect()`.
  - It `provide`s `{ isArriving, present, latest, load }`. On a route that is not Home or History,
    `isArriving` is false and `present` does nothing.
- **`useIncomingTransfers.ts`**: `onAdded` schedules one coalesced `refresh()` (250 ms after the
  last Added, at most 1 s after the first) instead of inserting the event's raw record, so the
  list, and every arrival, passes the dust filter (`service.ts:440-462`). It takes an optional
  `afterRead(scope)` that it awaits after `getIncomingTransfers` and before assigning the rows,
  inside the existing sequence, scope and disposal guards (`:71-81`); a rejected `afterRead` is
  caught and the rows are assigned anyway, since `refresh` has no catch and its callers do not
  await it (`:113`, `:116`, `:125`, `:133`). Home and History pass the coordinator's `load`, so
  rows are assigned only once the state that judges them is known; `RecentActivityView` passes it
  only without a `token` (Home, `general.vue:56`), so the token page's copy (`tokens/[id].vue:279`),
  whose rows never play (A-3), passes none and never drops a read that could open its snack. Its docblock loses "which
  previously duplicated this verbatim" (`:6-8`) and "the optimistic add/update/delete merges"
  becomes the update and delete merges and the coalesced refresh on Added (`:10-11`).
- **`TransactionIncomingCard.vue`**: passes `arriving` to the layout, which applies
  `n-row-in` + `n-row-glow` on the row and `n-amt` on the amount (`nulo.css:519`, `:524-527`,
  copied as module keyframes); the calm variant (`:520`) under `@media (prefers-reduced-motion:
  reduce)` and `:global(.noanimations)` (A-8).
- **`BalanceView.vue`**:
  - The hero sits in a relative inline wrapper (`.n-bal-wrap`, `nulo.css:516`).
  - Inside it, one always-mounted `<span role="status" data-testid="balance-arrival-status">`,
    empty with no arrival, holds the chip, `data-testid="balance-arrival-chip"`, with the `.n-plus`
    values (`:517`), A-14's width cap, and `n-plus 2.6s ease-out forwards` (`:518`, `:522`) or
    `n-plus-calm` (`:521`, `:523`). Only the chip is keyed by the arrival id, so each arrival
    restarts its animation while its text lands in a live region that already exists (A-9). It
    reads `latest` through a new `arrival` prop from `general.vue`; an arrival that fails
    `isValidDecimals` shows no chip (A-15).
  - Count (A-1′): the view records each displayed aggregate (micro-USD) with the time it was
    established. It counts when the aggregate rises to a value established within 10 s after the
    arrival, or within 10 s before it, from the value displayed just before that rise, whatever
    that value's age; the tween runs over 900ms with `1 − (1 − k)³` on `requestAnimationFrame`
    (`page.js:663-674`) in bigint micro-USD, and its last frame shows the new aggregate's own
    formatted string. A rise or an arrival during a running count retargets it from the value
    on screen. Loading, unknown or fiat-off states never count. Reduced motion or `.noanimations`
    (read once per arrival with `matchMedia` and `classList`) set the final value at once.
    `enterScope` (`:227-232`) and a loading, unknown or fiat-off state cancel the frame and clear
    the recorded values; unmount cancels the frame, beside `capTimer` and `retryTimer`
    (`:245-254`).
- **Testids**: `snackbar`, `snackbar-title`, `snackbar-sub`, `snackbar-action`, `snackbar-close`,
  `balance-arrival-status`, `balance-arrival-chip`; `data-kind`, `data-arriving`,
  `data-row-target`. Every existing testid stays on its element.

### Stale comments dropped in touched files

- `ToastManager.vue:2-5`; `composables/toast.js:1-4`. `packages/design/src/composables/toast.ts`
  is rewritten but keeps its singleton sentence (`:19-22`), the invariant that explains why the
  extension's shim re-exports one ref.
- `utils/clipboard.ts:5-8` (success and failure no longer carry their own icon and duration).
- `incoming-transfer/repository.ts:2-9` (the table inventory gains the fifth table), `:168` and
  `:191` ("four tables" becomes "five").
- `TransactionCardLayout.vue:4-10`; `:71-83` (to its invariant); `:67`, `:153-163`, `:168` and
  `:173-175` (the 16px, 20px and tuning notes, with the values they describe).
- `TransactionsList.vue:2-20` and the "Phase 2 follow-up v4" clause of the `tokensById` doc
  (`:36-38`).
- `RecentActivityView.vue`: "Shared verbatim with activity.vue" (`:241`); the
  execution-client comment (`:274-275`, a "Phase 2 follow-up" label and a narration); the "Phase 2
  follow-up:" label that opens `:278` (the per-card cancel sentences at `:278-283` and the id
  correlation at `:285-289` stay); the comments of the removed `handleSelectIncoming` (`:270`)
  and `handleSelectTerminal` (`:697-698`).
- `TransactionAwaitingCard.vue:8-18`, `:44-45` and `:173-176`;
  `TransactionIncomingCard.vue:2-12` (corrected, the `download` icon sentence at `:10-11` gone).
- `Popup.vue:102` ("Need to refactor !!!", with the dummy button).
- `useIncomingTransfers.ts:6-8` (one clause) and `:10-11` (the Added merge); the first sentence
  of `tests/e2e/fixtures/helpers.ts:1895-1898`.
- `popup/pages/activity.vue:53-55` (the Added merge is now the coalesced refresh, and History
  passes `afterRead` where the token page's copy does not, so neither "optimistic merges" nor
  "Shared verbatim with the home Recent-Activity widget" holds) and the "(Phase 2 follow-up)"
  label at `:73`.

New comments state invariants only: why `RowTarget` is stretched, and why the titled spans sit
above it; why Space binds `navigate` without `.prevent`; why the toast tag resolves locally; why a
floor is written before the history it covers is committed, why floors never move down (and so
every write takes the max with the stored one), and why an arrival write checks both the service
epoch and lock ownership; why the list reads the arrival state after its records; why
`arriving` is released after 2.6 s and a judged id is not judged again; why an evicted played id
raises the account floor; why a pending floor keeps its number; beside `known`, that the reads
are route-blind while the announce is not, that the first read only seeds it, and that only ids
discovered after it started are announced; beside the replacement wait, that `after-leave` reads the shared toast, not a copy,
so a close during the wait installs nothing.

## Security & Adversarial Considerations

- **No sender, ever.** A public event carries `from`, which can be any address or look like a
  name. The snack's text comes from the amount, the token's symbol and decimals, the record's
  `kind` and the account name, not from `buildIncomingCardProps`, which reads `from` to pick a
  label. A test gives the record a sentinel `from` and asserts it is absent from every argument,
  View's target included, and that changing `from` changes nothing.
- **Hostile token metadata and names.** The symbol is contract-controlled
  (`wallet/services/token/service.ts:377-395` takes it uncapped), and an account name can come
  from a restored backup at any length. On the snack and the chip both pass
  `sanitizeWireString(x, 32)` (control and bidi characters stripped, cut with "…", S-11), then Vue
  text interpolation (no `v-html`). `decimals` passes `isValidDecimals` before any formatting, in
  the coordinator, the chip and the incoming row, so a hostile value can neither throw out of a
  render nor reach a huge exponent (A-15). The snack wraps to a bounded height; the chip is capped
  at 312px (A-14); P4.8 measures both in the browser with a 31-character symbol and a
  1,000-character account name.
- **Dust and untrusted senders.** Added is emitted only for trusted, visible records; the
  coalesced refresh makes the dust filter apply before any row, chip or snack. The filter fails
  open when config, token, network or a fresh quote is unavailable (`service.ts:533-564`), which
  is its existing contract: then a dust receipt renders, and it can play once (A-11). A test feeds
  a dust record through Added with fresh quotes and asserts nothing plays.
- **Replays.** History discovered late (an imported account, a new token, a cursor reset, an
  Allow on any account) never plays: its floors are block numbers read fresh from the node before
  that history is committed, so neither device clock skew nor a cached tip moves them. A played
  id is claimed once, under the incoming service's lock, whichever document asks; eviction past
  500 raises the account floor instead of forgetting, and no floor ever moves down, so no receipt
  replays. A corrupt row re-baselines. A document that judged a row arriving answers from its
  2.6 s window afterwards, never from eligibility again, so a lost claim cannot keep a row
  classed. The one visual duplicate, two documents painting the same new row before either claim
  returns, is owner ask A-16; the stored claim, the chip and the snack stay single, because the
  chip and the snack follow only a successful claim.
- **Lock, scope and stale documents.** Every await in the coordinator and the send path is
  followed by an `appStore.scopeEpoch` check, which also catches A → B → A and lock → unlock, and
  the coordinator's reads by a generation, which catches a newer read in the same scope (a
  visibility or dust change); the service re-checks its own epoch and its lock ownership before
  any arrival write and ignores ids outside the claimed scope, so a late or hostile document
  cannot write or announce into another profile, account or network. A lock closes the snack and
  drops arrival state (S-16), and a cross-kind replacement waiting for its leave installs the
  shared toast as it is when the leave ends, so a snack replaced just before the lock never
  reappears on the lock screen. The coordinator reads on the lock and register screens but
  announces and claims nothing there or in a dApp window, a page's first read announces nothing
  (A-3), and a later read announces only a receipt discovered after the first one started
  (A-11), so a receipt that came in before the page opened, or one a setting reveals, puts no
  amount or account name on the lock screen or on the page it reloads on.
- **Residue.** The arrival row links a profile, a network and an account address to receipt ids;
  it is device-local, not in backups, and deleted with the profile, the chain or the account in
  the same critical section as the records. A purge bumps the service epoch, a claim re-checks it
  before writing, and a baseline is written only while the profile, network and account still
  exist, so nothing recreates a deleted scope's row.
- **View targets are built from checked values.** A tx hash is checked as 32-byte hex before View
  is offered; a receipt id comes from the service record, is routed as a param and resolved
  active-profile-scoped (`received/[id].vue:147`, `spec.ts:307-309`). No dApp can open a Nulo
  snack: `openToast` runs only in extension pages.
- **Clickjacking and overlays.** The snack covers at most a strip above the nav or the bottom edge.
  It holds only its own buttons, and the wrap is `pointer-events: none`, so a click beside the snack
  reaches the page. An error in the execute window sits above its approve/reject footer (1c), also
  in a window shorter than the page, and never presses them. `NotificationManager`'s modal (z 9999) covers the snack.
- **Rows.** The target is a real link or button below every nested control; nested controls stop
  propagation; the two raised titled spans only forward a plain click to the target (R-7). A link row navigates through `navigate`, which prevents the anchor's default, so
  no key press navigates twice. The contact row's `?contact=<id>` is resolved only against the
  active profile's own contacts, so a crafted URL selects nothing else.
- **Logging**: none added. **Permissions**: none. **Dependencies**: none.

## Assumptions

### Facts (verified in recon, by both audits, or by reading the file)

1. `openToast` always arms a timer (`toast.ts:27-36`); the card closes on click
   (`ToastManagerBase.vue:37`), shows `toast.icon || 'check-circle'` at 14px (`:44`), sits in an
   absolute wrapper at top 12px (`:55-63`) and has no live region.
2. 130 production calls in 56 files, 7 red (the multi-line `useNetworkActivation.ts:32-33`
   included), five with `{` on the next line, none in a template; the clipboard helpers have 20
   direct production callers (`utils/clipboard.ts:30-53`).
3. `#toast` is the fifth teleport anchor and precedes the page in both shells
   (`popup/app.vue:407-411`, `onboarding/app.vue:79-83`).
4. The nav is 64px and shown by `route.meta.showBottomNav` (`Navigation.vue:49-65`,
   `popup/app.vue:442`); the drawn wrap is `bottom:76px` (`r2/i10.html:20-21`). The shell writes
   `data-has-nav` from the same meta (`popup/app.vue:44-51`), and the design package's `base.css`
   already keys on it (`:68-70`).
5. `ExecutionService.executeTransfer` returns the hash (`service.ts:469-489`,
   `transfer-executor.ts:206`); `send-submit.ts:59-61` drops it.
6. Popups trap focus with `allowOutsideClick: true` (`Popup.vue:58-64`), with focus-trap 8.2.2,
   which recomputes tabbable nodes on every Tab (`focus-trap.esm.js:559-565`).
7. Firefox's minimum is 153 (`manifest.test.ts:138-139`), so `:has()` works on it and on current
   Chrome (an environment assumption the smoke suite exercises); Vue is `^3.5.38`, which has
   `Teleport defer`.
8. `.noanimations` stops transitions only (`base.css:389-392`), toggled on `<html>`
   (`popup/app.vue:68-70`).
9. Added fires before the dust filter, which fails open; `useIncomingTransfers` inserts the raw
   record (`service.ts:1270-1272`, `:1955-1957`, `:586-605`, `:533-564`;
   `useIncomingTransfers.ts:92-97`).
10. `IncomingPublicEventRecord` has `from` (`spec.ts:97-106`), and `buildIncomingCardProps` reads
    it (`received-display.ts:30-35`, `:69`).
11. Home's hero is the aggregate USD; only the token page passes `tokenBalance` (`general.vue:51`,
    `BalanceView.vue:102-106`, `tokens/[id].vue:271`); a commit only marks the balance dirty
    (`service.ts:1267`).
12. `clickByTestId` calls `target.click()` on the testid element (`fixtures/extension.ts:1429-1450`),
    which proves no hit-testing; no spec clicks an activity row's or a contact row's root.
13. 67 `SettingItem` tags in 26 files: 29 link, 24 click, 14 neither; all but disabled ones are Tab
    stops today (`SettingItem.vue:50`).
14. `discoveredAt` is local discovery time; account adds and token adds commit history later as
    Added (`service.ts:341-374`, `:930-960`, `:1985`, `:2161`); `blockTimestamp` is optional and
    backfilled with no event (`spec.ts:77-82`, `service.ts:1185-1211`); `l2BlockNumber` is
    required (`spec.ts:63-64`, `:130`); `setTrustAllow` keeps `discoveredAt` and flips every
    account's hidden records for the contract (`:578-608`, `listByContract` at
    `repository.ts:96-98`).
15. `balanceFormatted(x, d, 8)` slices the whole string (`utils/amount.ts:111-113`).
16. `enterLockedState` leaves an open toast (`popup/app.vue:174-186`); dApp windows are popup-app
    routes named `windows-*` (`utils/legal-sheet.ts:22-28`).
17. Home renders a row budget and the token page reuses `RecentActivityView`
    (`RecentActivityView.vue:97-118`, `tokens/[id].vue:279`).
18. Contacts and connected apps navigate (`popup/pages/settings/contacts/index.vue:118-121`,
    `connected-apps/index.vue:67-69`); the contact preselection is a Pinia ref
    (`stores/cache.store.ts:21`) read by Send at `send.vue:539-542`, and Send already resolves a
    `tokenId` query against its own list (`:529-536`).
19. vue-router 5.2.0's `navigate` refuses an event whose default is prevented and prevents it
    itself when it navigates (`dist/vue-router.cjs:2030-2037`, `:2111-2121`).
20. Profile deletion and reset run `incoming.clearProfile` (`profile-deletion/coordinator.ts:
    115-129`, `reset.vue:66`); `clearProfile`, `clearChain` and the account purge each bump the
    service epoch (`service.ts:639`, `:667`, `:401`); a tombstoned profile is absent from
    `getProfiles` (`profile/service.ts:577-581`).
21. The arrival e2e's poll gate exists only in proverless builds
    (`src/e2e/chrome-storage-incoming-poll-gate.ts:31-36`).
22. Batch 3's tooltip press closes on a control press and cancels no key's default
    (`../b3-tooltips-glossary/plan.md` § Tooltip, "Pressing a control inside the trigger").
23. The Aztec node's `getBlockNumber()` with no tag returns the latest proposed block
    (`@aztec/stdlib` 5.2.0 `dest/interfaces/aztec-node.d.ts:143-146`); the public scan bounds itself
    by the checkpointed tip (`public-events.ts:393-406`); no popup-reachable method returns a block
    number today (`incoming-transfer/client.ts:36-48`).
24. The storage facade's `storageLocalSet` awaits a running migration before writing
    (`utils/storage.ts:78-83`), so a UI-side check made before the call can lapse; the arrival
    state no longer goes through it.
25. `Popup.vue` holds an invisible, `aria-hidden`, tabbable "focus trap dummy" button
    (`:102-105`), and its trap already names the wrapper as `fallbackFocus` (`:61`).
26. `useIncomingTransfers` refreshes on reconnect, on the visibility and dust-threshold config
    keys and on `onQuotesUpdated` (`:111-135`); `refresh` has no catch and its callers do not
    await it (`:71-81`, `:113`, `:116`, `:125`, `:133`).
27. `repo.setTrust` writes a fresh record from its four arguments (`repository.ts:107-111`), and
    three transitions call it directly, not through `_setTrustStateLocked` (`service.ts:1036`,
    `:1223`, `:1921`).
28. The service lock's watchdog force-releases after five minutes and the displaced section keeps
    running; `isCurrent()` is the ownership check before a write (`packages/wallet-core/src/
    utils/lock.ts:79-88`, `:144-160`; `service.ts:242-246`). No chain reset moves records or
    floors: only network and profile deletion purge a chain (`network/service.ts:826-873`).
29. `getPublicScanTips` is a PXE service RPC in `packages/aztec-runtime/src/pxe/` (`spec.ts:100`,
    `descriptors.ts:64`, `service.ts:101`, `:686-687`, `client.ts:356-357`; `descriptors.test.ts`
    pins 25 methods and the SW-only list); the incoming service reaches it through its
    `PublicEventReader` adapter (`service.ts:272-287`), which tests replace (`:211`, `:234`).
30. Vue 3.5's leave waits two animation frames, then the computed transition duration
    (`@vue/runtime-dom` 3.5.41 `dist/runtime-dom.cjs.js:226-235`, `:283-288`, `:289-305`), so in
    jsdom, with no computed duration, a leaving card lasts two frames.
31. The incoming row formats `decimals` unchecked (`TransactionIncomingCard.vue:41-44` →
    `utils/amount.ts:89`, which throws at `:238-240`), and a token row's `decimals` is any number
    (`wallet/services/token/spec.ts:45`).
32. A title tooltip shows only for the element under the pointer: `activity-fiat`
    (`TransactionCardLayout.vue:138`) and `contact-sender-chip` (`ContactRow.vue:37-43`) carry the
    two titles inside link rows; the awaiting card's title is on its root (`TransactionAwaitingCard.vue:74`),
    an ancestor of the target, so it keeps showing.
33. In jsdom a real focus trap finds no tabbable node: tabbable 6.5.0's default display check
    treats an attached node with no client rects as hidden (`tabbable/dist/index.js:421`) and
    jsdom returns none, which is why `Popup.test.ts:16-17` mocks `focus-trap`. jsdom 29.1.1's
    selector engine matches `:hover` only while a mouse event is being dispatched
    (`@asamuzakjp/dom-selector` 7.1.1 `src/js/finder.js:1132-1141`).
34. `deployTestToken` names a token `` `${symbol} Token` `` unless given a name
    (`tests/e2e/fixtures/aztec.ts:148-153`), and the 5.0.1 token constructor takes a name and a
    symbol of at most 31 characters each (`token_contract-Token.json:11288`). An account name is
    capped at 25 by rename (`EditAccountPopup.vue:100`) and 40 by import
    (`settings/accounts/import.vue:244`), not by the service (`changeAccountName`,
    `account/service.ts:303-305`) or a restored backup (`account/spec.ts:148`).
35. After an unlock the popup reaches Home only through `loadProfile`'s advance, which runs only
    from `popup-auth` or `popup-register` (`popup/app.vue:308-310`,
    `should-advance-to-general.ts:3`, `:19-21`); a page opened on any other authed route stays
    there.
36. `onTokenAdded` and `setTrustAllow` each take the service lock (`service.ts:947`, `:580`), and
    Allow emits Added for every record it un-hides (`:593-605`).
37. `getIncomingTransfers` returns an empty list while visibility is off or unreadable
    (`service.ts:455`) and applies the dust filter last (`:460`), so a later read can return a
    record discovered long before; `discoveredAt` is a required field (`spec.ts:76`, `:134`),
    stamped with the device clock at commit (recon fact 12a).
38. Two `SettingItem` callers pass `disabled` on a row with a mode: `settings/profile/index.vue:43`
    (a click row that only navigates) and `settings/networks/[id].vue:166` (a click row); a
    disabled row is off the Tab path today only through `:tabindex` and the emptied `:to`
    (`SettingItem.vue:46`, `:50`), and `.disabled` sets `pointer-events: none` (`:135-138`).

### Asks → codex (decided in the plan audit)

1. **Required `kind`, no duration, no icon or colour**: **approved** (both legs). The scan matches
   across newlines, accepts a kind ternary, refuses non-literal arguments and keeps its ≥ 100 floor
   (fable).
2. **Timer in the composable with `holdToast`**: **amended** (codex, fable). Hover and focus are
   tracked separately and reported as their OR; releases are idempotent; a replacement re-derives
   the hold from the rendered card.
3. **Two always-mounted live regions holding the card**: **approved, qualified** (codex): the
   announcement claim stops at the DOM. Fable's visually hidden announcer pair is not adopted
   (codex: no demonstrated duplicate announcement); fable conceded in round 2 (Disputed 1). Both
   regions transition `out-in` and share one grid cell.
4. **`bottomInset` prop from the wrapper, `position: fixed`**: **approved** (codex); fable
   conceded in round 2 (Disputed 2).
5. **The stretched, pointer-transparent `RowTarget`**: **amended** (codex, fable): the target is
   the hit surface, with nested controls above it.
6. **One activation path through the row root**: **rejected** (codex, fable): Enter on the link
   navigated twice. A link row activates through `RouterLink`'s `navigate`; a button row's click
   bubbles to the root.
7. **A `discoveredAt` watermark**: **rejected** (codex); both legs found the loss and replay cases.
   Replaced by receipt ids with floors per account and per token (fable's floor, the driver's
   per-token extension); no arbitrary margin. Round 2 (Disputed 3, codex): the floors are chain
   block numbers read from the node, not device milliseconds against block timestamps in
   seconds; the clock probe goes.
8. **The mark in the UI facade**: **reversed in round 2** (codex findings 5 and 6): the state is a
   table of the incoming-transfer service, written under its lock and epoch, where Allow, token
   add, account add and every purge already run. A UI key could neither share the purges'
   exclusion nor see an Allow on another account.
9. **Refresh on Added**: **amended** (codex, fable): one coalesced trailing refresh with the
   existing guards. B's emit-time dust filter is **rejected** (both): it would await config,
   network, tokens and quotes inside the commit's lock (`service.ts:539-555`, `:1247-1274`).
10. **The count-up**: **amended** (codex, fable) to A-1′: count only between established,
    displayed aggregates; the owner decides.
11. **The elsewhere listener in `popup/app.vue`**: **amended** (codex, fable): one shell
    coordinator owns the clients, the listeners and the route check, holds the scope's arrival
    state in memory for a synchronous first-paint answer, claims through the service, fences every
    await on `appStore.scopeEpoch`, and provides state that the lists pass to the cards as props.
12. **Moving `#toast` to the end with `Teleport defer`**: **approved** (both); keyboard access from
    popups is Ask 13.
13. **K-1's second trap container** (new): **approved** (codex, fable): `#toast` as a second
    container, no container updates, focus return on ×; the owner decides the Tab order.
14. **A modified click on a link row** (outline B): **approved** as ordinary link behaviour
    (codex): a new tab. Round 2 (codex): the contact row carries its contact in the URL, so the
    new tab keeps the selection and the originating document is not mutated.
15. **`@requires-proverless` on the arrival spec** (new, fable): **approved** by the driver under
    the program's Local gates (Fact 21); Chrome runs it with `NULO_E2E_PROVERLESS=1`.
16. **B's 10-minute live window and 5 s view-time margin**: **rejected** (codex): they can suppress
    unseen receipts, and a missing timestamp bypassed the window.
17. **Presentation versus detection** (new, codex): **approved**: only rendered rows and the named
    snack claim a receipt; the overflow case is owner ask A-12.
18. **First-paint arrival** (new, round 2, fable): **approved**: the lists answer `arriving`
    synchronously from the in-memory state and claim after render; the rows wait for the state
    before they are assigned. Round 3 (codex, fable): a judged id answers only from its window,
    the chip follows only a successful claim, and the two-document duplicate animation is owner
    ask A-16, not a technical acceptance.
22. **Floors never lowered** (new, round 3, codex): **approved**: lowering a floor to a lower tip
    replays the ids an eviction forgot; the tip is read fresh, never cached, for every write. A
    chain-reset detector (codex's other option) is not built: the service has no reset signal
    (Fact 28) and it would be new scope; the restarted local chain is A-6's fourth edge.
23. **Replacement across regions** (new, round 3, codex): **approved**: a replacement of the other
    kind waits for the leaving region's `after-leave`, so S-13 holds for every pair of kinds.
19. **Played-id eviction** (new, round 2, codex): **amended**: eviction raises the account floor
    to the newest evicted block, so nothing replays; an unplayed receipt under it stays silent
    (A-6).
20. **One scope epoch** (new, round 2, codex): **approved**: `appStore.scopeEpoch`, bumped by lock
    and by any scope change, fences Send and the coordinator.
21. **`Popup.vue`'s dummy tab stop** (new, round 2, codex): **approved**: removed; the wrapper is
    the trap's focusable fallback.
24. **One generation per coordinator read** (new, round 4, codex): **approved**: the nested `load`
    reuses its read's number; only Home's and History's lists pass `afterRead`; a dropped `load`
    resolves only once no newer generation is in flight (driver, ledger row 13).
25. **Suppress on a failed state read** (new, round 4, codex): **approved**: nothing is eligible
    until a `load` succeeds, and rows shown meanwhile stay at rest in that document (A-6's fifth
    edge for the owner).
26. **No pending toast copy** (new, round 4, codex): **approved**: `after-leave` installs the shared
    toast as it is then, so a close or lock during the wait installs nothing.
27. **Floors take the max** (new, round 4, fable): **approved**: every numeric floor write is
    `max(stored, new)`; a failed tip read still marks the floor pending. Round 5 (codex): the
    pending mark keeps the stored number, and the resolution writes `max(retained, tip)`.
28. **A failed superseding records read suppresses** (new, round 5, codex): **approved**: a
    coordinator read of the newest generation that fails at either step suppresses the scope
    before a dropped `load` resolves; A-6's fifth edge widened for the owner.
29. **Route-blind reads, route-gated announce** (new, round 5, fable): **approved**: the reads
    run on every logged-in route with a complete scope, so the unlock's seeding read completes on
    the lock screen; the snack, the claim, `isArriving` and `present` stay route-gated (S-16,
    A-13).
30. **Disabled rows are inert whatever their mode** (new, round 5, fable): **approved**:
    `disabled` decides before `to` and `onClick`; no visible change (Fact 38).

### Plan audit ledger

Round 1 ran in parallel, both legs seeing both outlines.

- `/codex high` (GPT-6 Astra, session `01a0d4e1-2362-7d03-95b1-db5ba29a6db4`): **conditional
  approve, confidence high** (moderate on screen-reader behaviour, which DOM assertions cannot
  establish). Conditions: its findings 1-11, the record and comment corrections in 12, and the
  parity differences carried to the owner.
- Fable (same-family leg): **conditional approve, confidence high**. Conditions: P1 consistency,
  the backfill floor, K-1, A-1′, the hit-surface `RowTarget` with `navigate`, the proverless
  arrival spec, bounded snack height, coalesced Added, one writer of the seen state.

Each finding was checked against the code before it was applied or rejected.

**Structural points** (outline B's numbering):

| # | Point | Won | Why |
|---|---|---|---|
| 1 | Toast API | main | Both legs: a required `kind` keeps one function type for `clipboard.ts` and `SubmitDeps`; no template calls exist, so a literal scan is complete |
| 2 | Phasing | B | Both legs: P1's "missing kind = error" made every unmigrated success sticky; one atomic phase |
| 3 | Timer | shared, B's OR | Codex: hover and focus released each other |
| 4 | Announcing | main | Codex decided (smaller); fable preferred B (Disputed 1) |
| 5 | Placement | main | Codex decided (host-agnostic prop); fable preferred B (Disputed 2) |
| 6 | Row activation | B | Both legs: no synthetic path, one navigation |
| 7 | Inner buttons | shared | `RowAction` moves into `@nulo/design` (codex: the L0–L2 rule) |
| 8 | SettingItem mode | shared + B's guard test | Both legs |
| 9 | Seen marker | neither | Both legs: ids (codex) with chain-time floors (fable), per token (driver) |
| 10 | Dust before arrival | main, coalesced | Both legs; B's emit-time filter rejected |
| 11 | Who decides "arriving" | B, amended | Both legs; props for L3 (fable), Web Locks and fences (codex) |
| 12 | Row class lifecycle | main, amended | Both legs: a 2.6 s timer, started when the row renders and is claimed; `animationend` never fires in jsdom or on a hidden row |
| 13 | Count-up | B (A-1′) | Both legs |
| 14 | Keyboard reach inside popups | B (K-1) | Both legs |
| 15 | Citations | B | Both legs |

**Disputed, carried to round 2** (built as decided; the round-2 codex pass is asked to confirm or
reverse with the stated fact):

1. Ask 3: fable holds that a region wrapping the card reads View or Close as part of every
   message and can announce twice when a success is replaced by an error; codex holds that the
   announcer pair is unjustified without a demonstrated duplicate.
2. Ask 4: codex's reason (the package stays independent of the extension's root attribute) is
   weakened by Fact 4, `base.css:68-70` already keys on `data-has-nav`; fable's rule would drop
   the prop and the route read.
3. Ask 7: the floors compare chain time with the device clock. A device clock ahead of the chain
   suppresses a receipt mined just after a floor; one behind it lets recent history play. P4
   measures the sandbox's offset first; codex settles whether an offset allowance is needed.
4. The seen-key purge from the incoming service (a background service removing `nulo:ui:*` keys)
   is the driver's design for codex's finding 4; round 2 confirms the owner.

Settled in round 2:

1. Regions hold the card: **kept**. Fable conceded; codex found no duplicate. The real defect,
   overlapping cards in a replacement, is fixed by `out-in` and one grid cell (round 2, row 4).
2. `bottomInset` prop: **kept**. Fable conceded; codex called both mechanisms workable.
3. Clock: **reversed** in codex's favour. Fable held the probe right; codex showed the
   device-millisecond floor is unsound even with no skew (a floor at 1000.5 s rejects a later
   receipt in a block stamped 1000 s) and that skew moves the boundary either way. The floors
   are now node block numbers; the clock probe became a tip probe (P4.1).
4. Service as owner: **confirmed and extended**. Fable confirmed the service; codex showed a UI
   Web Lock cannot exclude the service's purges and an Allow reaches every account. The state
   is now the service's own table, written under its lock and epoch, so fable's layering fix
   (the key builder in `spec.ts`) is absorbed.

**Findings:**

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex, fable | minor | Toast view line numbers wrong (`:81`, `:76-95`, `:127-148`); the file has 105 lines | Fact 1 and recon corrected (`:37`, `:44`, `:55-63`) |
| 2 | fable | minor | `BalanceView` cleanup is `:245-254`, not `:231-240` | Corrected |
| 3 | fable | minor | `TransactionsList.vue`'s docblock is `:2-20`; recon's `TransactionCard.test.ts` row-click test does not exist | Checked: the file exists (`popup/components/modules/activity/`) with no row-click test; recon and the comments list corrected |
| 4 | codex, fable | minor | Counts: "57/6" stale; 7 red only with the multi-line call; 42 clipboard callers is 20; 43 test files only reference `openToast`; disabled `SettingItem`s are not Tab stops | Recon and Facts 2, 13 corrected |
| 5 | codex | minor | `#toast` is the fifth anchor, not the first child; formatting lives in `TransactionIncomingCard.vue:41-44`; recon base is `803da36d` | Recon and Fact 3 corrected |
| 6 | codex, fable | major | P1 contradicts itself: "missing kind = error" makes every unmigrated success sticky, so its own smoke gate cannot pass, and it tests `snackbar-action` before any action exists | P1 is atomic (composable, view, every caller, tests, scan); P1's Tab test uses ×; View arrives in P2 |
| 7 | codex, fable | major | The `discoveredAt` watermark loses same-millisecond receipts, replays backfill (account import), and plays trust-changed receipts against A-10 | Receipt ids plus floors (account and token); A-10 through `floorContract` on Allow; tests for equal timestamps, delayed commits, trust, quote reappearance, import |
| 8 | driver | major | Found while checking row 7: adding a token trusts it and commits its whole history as Added (`service.ts:930-960`), which every earlier design would play | Per-token floors (A-6 amended); unit and e2e cases |
| 9 | codex | major | Detection is not presentation: marked rows may never render (row budget); the token page shares `RecentActivityView`; opening straight into Settings processes nothing | Claims only for rendered rows and the named snack; route gating; the start snapshot; A-12 and A-3 |
| 10 | codex, fable | major | Read/max/write is not atomic; three writers in one document and several documents; no fence after awaits; a snack survives the lock | One shell coordinator, Web Locks, generation and scope fences, S-16 (lock and scope close); send fenced by `isCurrent` |
| 11 | driver | minor | The coordinator would mount in dApp windows (popup-app routes, Fact 16) | Inactive on `windows-*`; A-13 |
| 12 | codex, fable | major | The seen key outlives profile deletion and reset (a profile-to-account link) | The incoming service's `clearProfile`, `clearChain` and account purge remove matching keys; Disputed 4 |
| 13 | codex, fable | major | Vue escaping neither bounds nor de-spoofs a hostile symbol; S-11's "wrap" makes the snack unbounded; the chip is nowrap; `buildIncomingCardProps` reads `from` | `sanitizeWireString(symbol, 32)` on snack and chip (S-11 amended, owner); the snack bypasses `buildIncomingCardProps`; tests with HTML-like, bidi and 1,000-character symbols and a sentinel `from` |
| 14 | codex, fable | major | The planned count-up fabricates a balance (the aggregate refreshes after Added); the 8-character formatter drops whole-number digits | A-1′ (owner); S-10 amended to keep whole digits; tests for both event orders, large integers, bad decimals, overlapping arrivals |
| 15 | codex, fable | major | Hover and focus holds release each other; a replacement under a resting pointer is not held | OR of two states; re-derive on each id; tests for both overlap orders, replacement, repeats, unmount |
| 16 | codex, fable | major | Persistent errors are unreachable by keyboard from inside a popup's trap | K-1 (owner): `#toast` as a second trap container, focus return; component test on the real trap and an e2e |
| 17 | codex | major | Batch 3's tooltip prevents Space's default, which would suppress the new row buttons | **Premise rejected**: batch 3's round 3 cancels no key's default (Fact 22). The cross-batch browser test is adopted (P3.9) |
| 18 | codex, fable | major | Contacts and connected apps navigate, so they are links; Enter on a link row navigated twice; endpoint icons were left out | Links through `navigate` with `before`; endpoint icons become `RowAction`; click rows that only navigate become `to` rows (driver) |
| 19 | codex, fable | major | Gates that cannot fail or cannot pass: the awaiting ancestry test, jsdom boxes, "gone within 6.5 s", role placement as proof of speech, reduced motion of the row and chip, `helpers.ts:1895` is a diagnostics comment, smoke's `retry: 2` | Ancestry asserted; boxes and keys measured in the browser; present at 5.5 s then gone by 6.5 s; claim qualified; reduced-motion e2e; diagnostics kept, one sentence removed; batch 1's scratch retry-0 config |
| 20 | fable | minor (gate-blocking) | The poll gate exists only in proverless builds, so the Chrome prover-on arrival run cannot hold discovery | Spec marked `@requires-proverless`; Chrome runs it with `NULO_E2E_PROVERLESS=1` |
| 21 | fable, codex | minor | N receipts in one sync open N snacks and N refreshes | One trailing refresh 250 ms after the last Added, in the list and the coordinator; burst test |
| 22 | fable | minor | Announcer pair instead of card-holding regions | Not adopted (codex decided Ask 3); Disputed 1 |
| 23 | fable | minor | Placement from `data-has-nav` instead of a prop | Not adopted (codex decided Ask 4); Disputed 2 |
| 24 | fable | minor | The scan regex misses the five multi-line calls | Matched across newlines, floor kept |
| 25 | fable | minor | Three click rows nest controls, so no `<button>` root; add B's guard test | Adopted (P3.6) |
| 26 | fable | minor | Reject B's emit-time dust filter | Agreed by both legs |
| 27 | fable | minor | Keep the 2.6 s timer over `animationend` | Kept; it starts at the claim of a rendered row (codex) |
| 28 | fable | minor | Tests that pass without the behaviour (card click with a no-op mock, action order, the facade, remount) and required behaviour with no test | Each rewritten as listed in the phases |
| 29 | fable, codex | minor | Stale comments in touched files (`TransactionsList`, `TransactionAwaitingCard`, `TransactionIncomingCard`, `TransactionCardLayout`, `useIncomingTransfers`, `toast.js`) | The comments list above |
| 30 | codex, fable | minor | Parity: `10-round1` is a History shot; the incoming card differs from the drawing (title, label, hash, icon); a History hovered row is not captured; History's side padding for the −8px box | P5 corrected; the differences listed for the owner; P3 checks the padding |
| 31 | driver | minor | The awaiting buttons' 16px width is marked as owner-tuned (`TransactionAwaitingCard.vue:173-176`) | Named in R-3 for the owner |
| 32 | driver | minor | The dust filter's fail-open lets a dust receipt play once | Stated in Security; A-11 |

**Round 2** (fresh passes on the consolidated plan and ledger, in parallel):

- `/codex high` (GPT-6 Astra, session `01a0d502-f1cf-7bd3-a002-71c64b0953c2`): **conditional
  approve, confidence high** (screen-reader speech unverified). Conditions: its findings 1-10
  corrected, 11's tests made behaviour-sensitive, 12-13 carried into the parity and comment
  lists.
- Fable: **conditional approve, confidence high**. Conditions: its findings 1-6 (with 7).

Every finding was checked against the code; none was disproved.

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex, fable | major | Space on a link row never navigates: `.prevent` runs first and vue-router's `guardEvent` refuses a prevented event (`vue-router.cjs:2113`) | `@keydown.space="navigate"` with no `.prevent`; `navigate` prevents the default itself (Fact 19); P3.2 on a real router, P3.9 counts `pushState` |
| 2 | fable | major | `arriving` flips several task boundaries after the row's first paint, so the row shows at rest, vanishes and slides; the coordinator never re-reads on quote or visibility changes, so A-11 cannot pass | In-memory state, synchronous `isArriving` at first paint, claim after render; rows assigned only after `load` (`afterRead`); the coordinator reads on the list's triggers (Ask 18); first-render DOM test; two-document window stated in Security |
| 3 | codex | major | Evicting played ids past 500 replays retained receipts | Eviction raises the account floor to the newest evicted block; 501-receipt test (Ask 19; A-6's second edge for the owner) |
| 4 | codex | major | Device-ms floors against block timestamps in seconds are unsound even without skew | Floors are node block numbers (`getBlockNumber()`, Fact 23), written before the history they cover; clock probe replaced by a tip probe (Disputed 3 settled) |
| 5 | codex | major | The coordinator misses the config, quote and backfill triggers A-11 needs; routes need republication; the newest remaining record could become a second snack; a resetting debounce can starve | Reads on start, reconnect, scope change, Added (250 ms trailing, 1 s max wait), both config keys and quotes; block floors make the backfill irrelevant; lists republish by rendering; snack candidates exclude `known` ids |
| 6 | codex | major | Allow's floor was account-local while `setTrustAllow` flips every account's records (`service.ts:592`) | The floor lives on the per-contract trust row, set inside `setTrustAllow`; two-account test (A-10 reworded, no new UI) |
| 7 | codex | major | A claim can land after the profile purge (the UI Web Lock is not the service's lock; the facade awaits a migration before writing) | The state is a service table under the service lock and epoch; purges bump the epoch; baselines require a live profile, network and account; paused-claim test (Ask 8 reversed) |
| 8 | codex | major | Send's `isCurrent` compares final ids, so A → B → A and lock → unlock pass | `appStore.scopeEpoch`, bumped by lock and every scope change, fences Send and the coordinator; round-trip tests (Ask 20) |
| 9 | codex | major | 32-character symbol does not bound the chip; account names are unbounded; invalid decimals throw | Account name through `sanitizeWireString(x, 32)` (S-11 amended); owner asks A-14 (chip cap, recommended 312px + ellipsis) and A-15 (invalid decimals: no snack, no chip); `isValidDecimals` first; tests |
| 10 | codex | major | Count timing required both values within 10 s, against A-1′; no scope cleanup | Times the rise, not the old value; retarget on overlap; `enterScope` and invalid states cancel and clear; P4.7 cases |
| 11 | codex | minor | A modified click on a contact row loses the selection and mutates the origin tab | `/popup/send?contact=<id>`, resolved against the active profile's contacts like `tokenId`; `before` and `preselectedContactToSend` removed; e2e new-tab check |
| 12 | codex, fable | minor | Tests that cannot fail: mocked `navigate`, one history entry, computed `animation-name` for a rAF count, keyed chip for "read once"; promised bad-decimal and overlap tests missing; purge tests miss the concurrent writer; `Popup.vue`'s invisible tabbable dummy | Real router and `pushState` count; frame sampler and local-name match; always-mounted status; P4 lists the missing cases; paused-claim test; dummy removed and the whole Tab cycle asserted (Ask 21) |
| 13 | fable | minor | The chip's live region is re-created per arrival | One always-mounted `role="status"` (`balance-arrival-status`); only the chip is keyed |
| 14 | fable | minor | A keyed replacement under a default `<Transition>` shows two snacks side by side | `mode="out-in"` on both regions, and both regions in one grid cell so a cross-region replacement does not sit beside the old one (S-13 amended); tick test |
| 15 | fable | minor | `seenKey` in `popup/constants` would be imported by a background service | Absorbed: the state is the service's own table (`repository.ts`), and the popup imports only `arrival-state.ts` |
| 16 | codex, fable | minor | Parity list misses the incoming row's badge, separator and chip colour | Added to P5.1 for the owner; nothing changes |
| 17 | fable, codex | minor | Stale comments left in touched hunks (`TransactionsList`, `RecentActivityView`, `TransactionCardLayout`, `Popup.vue`); keep the slot invariant | The drop list extended; the slot comment keeps its invariant; new invariant comments for eviction and claim fencing |
| 18 | driver | minor | Found while applying row 7: a baseline written after a purge would recreate a deleted scope's row | Baseline only while the profile (tombstone-aware), network and account exist |
| 19 | driver | minor | Found while applying row 4: a chain restarted under the same network would leave floors above the tip | Floors above the tip are lowered at `getArrivalState` (**reversed in round 3**, row 3: floors never move down) |

**Round 3** (fresh passes on the revised plan, in parallel):

- `/codex high` (GPT-6 Astra, session `01a0d502-f1cf-7bd3-a002-71c64b0953c2`): **conditional
  approve, confidence high**. Seven of its 13 round-2 conditions met; conditions: its findings 1-8
  corrected or carried to the owner, plus 9.
- Fable: **conditional approve, confidence high**. All six round-2 conditions met (the first-paint
  one with a rule gap); conditions: its findings 1-8, with 9 and the reorg sentence as wording.

Every finding was checked against the code. One premise was wrong (row 9, fable 7) and one
option was not taken (row 3, codex's chain-reset detector); neither changes a condition's fix.

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | fable | major | The stretched target hides two title tooltips batch 3 keeps: "At today's price" on activity rows (`TransactionCardLayout.vue:138`) and "Registered as sender" on the contact S chip (`ContactRow.vue:40`); UI impact rows 6-7 did not say so | Verified (Fact 32; the awaiting card's root title is unaffected). Owner ask R-7, built as recommended: the two spans raised above the target, a plain click forwarded through `RowTarget.activate()`; stated in rows 6-7 and the sign-off list; P3.5, P3.7 real-router tests and a P3.9 hit test |
| 2 | fable, codex | minor / major | `isArriving`'s OR re-consults eligibility after the window, so a lost claim keeps the row classed and re-arms; `present` set `latest` before the claim, so two documents both show the chip | A judged id answers only from its window, on the route that judged it; eligibility only for ids never judged; `latest` only from claimed ids; the two-document row animation becomes owner ask A-16 (codex: an "accepted window" is not a sign-off); P4.5 cases |
| 3 | codex, fable | major / minor | The 30 s tip cache lets a stale tip set a floor (history in the newest blocks plays), and lowering a stored floor to a lower tip undoes an eviction floor and replays retained receipts | No cache: every floor write, baseline and pending resolution reads the tip fresh; nothing is ever lowered. Codex's alternative, a chain-reset detector, is not built (no reset signal exists, Fact 28; new scope): the restarted local chain is A-6's fourth edge for the owner, and fable's reorg case its third. P4.3 stale-tip, lower-tip and eviction cases |
| 4 | codex | major | Same-scope stale reads: an older visible read finishing after a visibility-off read can still claim and open a snack; an older `load` can replace newer state | A read generation on every coordinator read and `load`, checked before assignment, claim and announcement (the list's `refreshSeq` rule); P4.5 ordering case |
| 5 | codex | minor | The token page inherits the 2.6 s window from Home | `isArriving` is false off Home and History, and a window answers only on its judging route; P4.5 navigation cases |
| 6 | codex | major | A-15's row fallback throws: the incoming row formats invalid `decimals` unchecked (`TransactionIncomingCard.vue:41-44` → `amount.ts:238-240`) | Verified (Fact 31, token `decimals: z.number()`); the row's formatter checks `isValidDecimals` and renders no amount column; the visible fallback is in A-15 for the owner; P3.5 and P4.6 render tests |
| 7 | codex | minor | S-13 says sequential, the design cross-faded across regions; `justify-items: center` shrinks the regions, so the card's percentage width resolves against its wrapper | A cross-kind replacement waits for the leaving region's `after-leave` (Ask 23); regions stretch to full width and are each the drawn flex wrap; P1.3 counts cards across both regions, P1.10 measures the width and samples per frame |
| 8 | codex | major | Epoch checks do not cover a watchdog handoff: the displaced section keeps running and moves no epoch (`lock.ts:79-88`); the paused-claim test described an impossible interleaving | Every arrival write checks the epoch and `isCurrent()`; the epoch test is worded as capture → purge → lock entry (fable 9 too), and a separate watchdog test is added (P4.3) |
| 9 | fable | minor | P1.3's replacement test passes without `out-in` because jsdom resolves the leave at once | **Premise wrong**: Vue waits two animation frames before resolving a leave (Fact 30), so a same-flush sample would see two cards. The fix is adopted anyway, to make the window deterministic: fake rAF and a stubbed 150 ms duration, samples across both regions, plus the browser per-frame sampler |
| 10 | codex | minor | No browser test bounds a hostile snack or chip | P4.8 case in the arrival spec: a spec-deployed token with the longest accepted symbol, 10^38 base units and a 1,000-character account name; rects inside the viewport, hit tests, the chip's ellipsis measured |
| 11 | fable | minor | The `arrivalFloor` carry sat on `_setTrustStateLocked`, but three transitions call `repo.setTrust` directly and it writes a fresh record (Fact 27) | `repo.setTrust` keeps the stored floor unless given one; repository test |
| 12 | fable | minor | The tip method is a PXE service RPC in `packages/aztec-runtime`, not a line beside the incoming reader adapter, and the tests fake the node through `PublicEventReader` | The four package files named (with `descriptors.test.ts`' count and SW-only list); the tip is read through the reader; recon corrected |
| 13 | fable | minor | A rejected `load` leaves the list unassigned (`refresh` has no catch; callers do not await) | `load` never rejects; the list also catches a rejected `afterRead` and assigns the rows; P4.4 and P4.5 cases |
| 14 | fable, codex | minor | Comments this batch makes false: `clipboard.ts:5-8`, `repository.ts:2-9`, `:168`, `:191`, `useIncomingTransfers.ts:10-11`, `TransactionIncomingCard.vue:10-11`; keep `toast.ts:19-22` | All added to the comment list; the singleton sentence kept |

Fixes not applied: none. Visible consequences all went to the owner as asks (R-7, A-6's third and
fourth edges, A-15's row, A-16).

**Round 4** (fresh passes on the revised plan, in parallel; the stack had been rebased onto dev
`9f11de70`):

- `/codex high` (GPT-6 Astra, session `01a0d502-f1cf-7bd3-a002-71c64b0953c2`): **conditional
  approve, confidence high**. Seven of its nine round-3 conditions met; conditions: its findings
  1-4.
- Fable: **conditional approve, confidence high**. All nine round-3 conditions met; conditions:
  its findings 1, 2, 4, 5, 6 and 3, with 7 as wording.

Every finding was checked against the current tree; none was disproved. Fable's finding 1 changes
what the user sees, so it is the owner's: built as recommended and carried as amended A-3.

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | major | A coordinator read invalidates itself: every read and every `load` took a new generation, and a read calls `load` | Verified against the plan text; the list's rule is one number per logical refresh (`useIncomingTransfers.ts:67-80`). One number per read, reused by its nested `load`; a list's `afterRead` takes its own, and only Home's list (no `token`) and History pass one; every completed read adds its ids to `known`; P4.5 uncontended and ordering cases (Ask 24) |
| 2 | codex | major | A failed state read keeps the old state, so records an Allow just un-hid are judged against the pre-Allow floor and animate | Verified: Allow emits Added per un-hidden record (`service.ts:593-605`, Fact 36). A failed `getArrivalState` suppresses the scope until a `load` succeeds; rows shown meanwhile are judged at rest for the document; the visible cost is A-6's fifth edge (owner); P4.5's keep-state case replaced by the Allow case (Ask 25) |
| 3 | codex | major | A pending cross-kind replacement survives `closeToast()`, so a receipt snack could appear on the lock screen | Verified: `closeToast` clears only the shared ref (`toast.ts:38-41`) and the lock keeps the shell mounted (`popup/app.vue:174-186`). The view keeps no pending copy: `after-leave` installs the shared toast as it is then, nothing after a close or an unmount; P1.3 close, newer-open and unmount cases (Ask 26) |
| 4 | codex | minor | The hostile-symbol fixture fails: the default name `` `${symbol} Token` `` exceeds the constructor's 31 characters | Verified (`fixtures/aztec.ts:153`; `str<31>` name and symbol, Fact 34). P4.8 passes the name `"Hostile"` and keeps the 31-character symbol and the bounds assertions |
| 5 | fable | major | A scope's first read announces receipts the page has not shown, on Settings after a reload or on the lock screen after an unlock, and claims them so Home never plays them | Verified (Fact 35; `known` is empty on a first read). **Owner-held**: built as recommended, the first read to complete seeds `known` and opens no snack; amended A-3 with the alternative, **sign-off pending**. Driver addition: the coordinator is also inactive on `popup-auth` and `popup-register` (S-16; **narrowed in round 5**, row 3: it reads there and only announces nothing), and the arrival spec waits for `data-arrivals-seeded`; P4.5 inverted, unlock and reload cases added, P4.8 reload case |
| 6 | fable | major | P2.3's real-trap test cannot pass in jsdom: tabbable finds no node without client rects | Verified (Fact 33). The test stubs `getClientRects` for connected elements; no production option |
| 7 | fable | minor | P1.3 cannot put the card in `:hover` in jsdom | Verified (Fact 33). The case stubs the card's `matches(":hover")` |
| 8 | fable | minor | In button mode a click on a raised titled span activates the row twice | Verified by the event path: the span's click bubbles to the root and the forwarded button click bubbles again. `@click.stop`; P3.4 once-only case |
| 9 | fable | minor | "Never lowered" held only by ordering: an add that read tip N can write after an Allow that read N + k | Verified (Fact 36: both read the tip before their locks). Every numeric floor write is `max(stored, new)`, `"pending"` as absent; a failed tip read still writes `"pending"`; a resolution writes only a still-pending floor; P4.3 cases (Ask 27) |
| 10 | fable | minor | Space on `SettingItem` and `TokenCard` link roots and on external rows cannot work as planned: a plain `router-link` root exposes no `navigate` | Verified (`SettingItem.vue:44-51`, `TokenCard.vue:70`). Both render through `RouterLink custom` with `navigate` on click and Space; external rows answer Space with the anchor's `click()`; P3.6, P3.7 Space and Shift+Space cases. A keyboard rule, not a UI ask |
| 11 | fable | minor | Wording: S-2's 368px arithmetic; P4.8 names no way to set a 1,000-character name; a stale `tabindex` on link roots | S-2 says 400 − 32; P4.8 rewrites the account row in storage and restarts the background (UI caps 25 and 40, Fact 34); `SettingItem.vue:50` goes from every root |
| 12 | driver | minor | Base drift: dev `9f11de70` removed the tools app and the bridge packages (#691) and moved the protocol FPC derivation (#690) | The out-list no longer names removed paths; `Toast.vue` is recorded as the design package's orphaned tools item. Every citation re-checked against the rebased tree: of the cited files dev touched, `ToastManager.vue` and `fixtures/aztec.ts` changed only in comments with no line moved, and `manifest.test.ts`'s Firefox minimum moved to `:138-139` (Fact 7 corrected); separately, `setTrustAllow`'s span is `:578-608`, not `:578-604`, corrected here and in recon |
| 13 | driver | major | Found while applying row 1: on Home the list's `load` and the coordinator's read race on every trigger, and a dropped `load` resolved at once, so the list assigned its rows under the state the newer generation was about to replace (row 2's Allow case again, with no failure) | A dropped `load` resolves only once no newer generation is in flight, and every generation settles; P4.5 Home race case |

Fixes not applied: none. The visible consequences went to the owner: amended A-3 and A-6's fifth
edge.

**Round 5** (fresh passes on the revised plan, in parallel):

- `/codex high` (GPT-6 Astra, session `01a0d502-f1cf-7bd3-a002-71c64b0953c2`): **conditional
  approve, confidence high**. All four round-4 conditions met; conditions: its findings 1-2.
- Fable: **conditional approve, confidence high**. All seven round-4 conditions met; conditions:
  its findings 1, 2 (as an owner ask) and 3, with 4 and 5 as comments and wording.

Every finding was checked against the current tree; none was disproved, and one wording fix was
itself incomplete (row 7). Fable's finding 1 decides when the first receipt after an unlock gets a
snack, so it is carried as amended A-3; finding 2 changes which receipts a snack names, so it is
amended A-11: both built as recommended, **sign-off pending**.

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | major | A failed tip read overwrote a numeric floor with `"pending"` and resolved it to the tip alone, so 200 → pending → 150 lowered a floor, against "never lowered"; Allow keeps the history it un-hid | Verified (`setTrustAllow` keeps every flipped record, `service.ts:592-605`). The trust row stores `arrivalFloor: number` plus `arrivalFloorPending: true`; a failed tip read sets the mark and keeps the number; the resolution writes `max(retained, tip)`; a numeric write takes the max and clears the mark; P4.3 numeric → pending → lower-tip case (Ask 27) |
| 2 | codex | major | A superseding coordinator read whose `getIncomingTransfers` rejects before `load` leaves the old state, and the dropped list `load` then assigns rows an Allow just un-hid under it | Verified: the list's guards are sequence, scope and disposal only (`useIncomingTransfers.ts:71-80`). A read of the newest generation that fails at either step suppresses the scope before a dropped `load` resolves; A-6's fifth edge widened to a failed receipts read (owner); P4.5 failure variant of the Home race (Ask 28) |
| 3 | fable | major | The route gate starved the unlock's seeding read: the unlock completes the scope on `popup-auth`, the advance to Home is a route change (`popup/app.vue:309`, `should-advance-to-general.ts:19-21`), so the first receipt on Settings afterwards seeded instead of announcing, and the drawn `12-incoming` case failed after every unlock | Verified (Fact 35). **Owner-held** as amended A-3, built as recommended: the first read of a scope seeds `known` and opens no snack; reads run on every logged-in route with a complete scope and on the session's return, while the snack, the claim, `isArriving` and `present` stay route-gated (Ask 29); P4.5 unlock cases and a P4.8 lock-unlock-Settings case; the `known` comment gains the route-blind clause. Sign-off pending |
| 4 | fable | minor (owner ask) | A later read that reveals old receipts (visibility turned on, a lowered dust threshold, a quote lifting dust) announced the newest as "Received" though nothing arrived | Verified (Fact 37: `service.ts:455`, `:460`). **Owner-held** as amended A-11, built as recommended: snack candidates must also have `discoveredAt` later than `seededAt`, the start of the seeding read (both device clock; Disputed 3 untouched); the rest join `known` and play on their rows; alternative stated. P4.5 visibility and quote cases. Sign-off pending |
| 5 | fable | minor | A disabled link or click row would become a native Tab stop that Enter opens, since `pointer-events: none` stops only the pointer | Verified (Fact 38). `disabled` decides first: an inert `div` with no target, `href` or handler; no visible change; P3.6 disabled cases (Ask 30) |
| 6 | fable | minor, comments | `activity.vue:53-55` becomes false (the Added merge, "Shared verbatim"), and `:73` carries a phase label | Verified; both added to the drop list |
| 7 | fable | minor, wording | (a) A-3 cited `spec.md:254-255`; (b) the follow-up said nothing removes a `nulo:ui:*` key; (c) `contracts/index.vue:77` lacked its path | (a) corrected to `:255-256`; (b) verified, but fable's replacement ("only `nulo:ui:feePaymentMethods`") is itself incomplete: `reset.vue:87`'s `clearSendSelections` also removes `nulo:ui:sendFeePaymentMethods` (`fee-send-selection.ts:5`, `:96-98`, `storage-keys.ts:5`), so the follow-up says the reset page removes only the two fee-payment keys, as recon fact 16 already did; (c) full path `settings/advanced/account-state/contracts/index.vue:77` |

Base drift: every citation this round's changes lean on was re-read in the rebased tree
(`popup/app.vue:309`, `:411`, `SettingItem.vue:46`, `:50`, `:135-138`, `service.ts:455`, `:460`,
`:585-605`, `spec.ts:76`, `:134`, `:156-172`, `useIncomingTransfers.ts:71-80`, `activity.vue:53-55`,
`:73`); the plan cites no line in `fpc/service.ts`, `fpc/protocol-fpcs.ts` or
`packages/aztec-runtime/src/fee-juice.ts`, and none moved.

Fixes not applied: none. The visible consequences went to the owner: amended A-3, amended A-11
and A-6's widened fifth edge.

Round 6: codex **conditional approve, confidence high** (round-5 conditions 1 and 2 met; one new
minor condition); fable **approve, confidence high**.

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | minor (owner ask) | A-11 promises no snack for any revealed receipt, but the rule excludes only receipts discovered before seeding: seed on Settings with visibility off, a receipt discovered afterwards (persisted, no Added), then visibility on, and `discoveredAt > seededAt` with an id outside `known` opens a snack | Verified (`service.ts:455`, `:1270`: persisted, Added only when trusted and visible; `:603`, `:1956` the same gate). **Owner-held** as A-11 amended again, built as recommended: the ask now names the before-seeding and while-open-but-hidden cases apart, with the while-open reveal as a third alternative; the rule adds `announced` (a candidate's Added reached the page after seeding, and the first read after it returned it eligible), which also covers a receipt first filtered as dust; P4.5 cases for both reveals, an in-flight read and a failed read. Sign-off pending |

Round 7: codex **conditional approve, confidence high** (the round-6 condition met; two new
major conditions).

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | major | "First read after the Added" is not eligibility at discovery: Added applies no dust filter (`service.ts:1270`, `:541`, `:552`), so a quote rise or a lowered threshold between the Added and its first read announces a revealed receipt | Verified. Capturing dust eligibility at the Added would repeat the service's filter in the page. The first-read meaning is kept and stated to the owner instead, as codex allows: **owner-held**, A-11's recommendation now names that edge, sign-off pending; a P4.5 case for a quote rise before the settling read |
| 2 | codex | major | A read started before the Added can return the persisted record and put it in `known` (persist precedes emit, `service.ts:1268-1270`; reads await config first, `:446`), and a superseded read can settle an id, so genuine arrivals are silenced (`useIncomingTransfers.ts:111`) | Verified. Candidates now come only from `announced`, never from `known`; only the first read that started after the Added and completes as the newest generation settles an id; pre-Added and superseded reads leave it unsettled; one comment states that ownership rule. P4.5 cases for both orderings and for the superseded read |

Round 8: codex **conditional approve, confidence high** (round 7's two conditions met; one new
major condition).

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | major | A read superseded while its `claimArrivals` is in flight drops a successful claim: the service has marked the receipt played, the newer read cannot claim it, and neither opens a snack nor can Home slide it (generation fence after every await, `useIncomingTransfers.ts:116` quote reads) | Verified. A sent claim owns its id: only a lock, a scope change or disposal drops its result; the snack opens if the route still allows one and no read completed after the claim left the id out. The residual moment (Home opened, or the receipt hidden, during the claim) is **owner-held** as A-7 amended, sign-off pending. P4.5 cases for the held claim, and for the hidden and Home variants; one comment on the claim |

Round 9: codex **conditional approve, confidence high** (round 8's condition met; one new major
and one minor condition).

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | major | The "a read completed after the claim left the id out" veto neither establishes current visibility (a visibility-off read still in flight when the claim returns lets a hidden receipt's snack open) nor excludes stale snapshots (an older read finishing late vetoes a visible arrival); completion time is not freshness (`useIncomingTransfers.ts:75`, `:111`; `service.ts:455`) | Verified. The newest generation decides: the snack waits for the newest read in flight, a superseded read decides nothing, a failed deciding read opens none (A-6). P4.5 cases for the pending visibility read, the late stale read and a failed deciding read |
| 2 | codex | minor | A-7's "neither the snack nor its row plays" overstates the Home race: Home paints the row as arriving before its own `present` loses the claim, so the row can already have slid | Verified (`isArriving` judges on first paint, before `present`). **Owner-held**: A-7's edge now says Home's row slides once or not at all, and names a lock or account switch during the claim; sign-off pending |

Round 10: codex **conditional approve, confidence high** (round 9's two conditions met; one new
major condition).

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | major | A list `load` advances the shared generation but returns arrival state, not filtered receipts, so "the deciding read returned the id" is undefined when the newest generation is a list load (`service.ts:455` filters in `getIncomingTransfers` only) | Verified. Only a coordinator read's receipts decide a pending snack: the newest coordinator read started after the settling read, which a newer coordinator read replaces; a list `load` neither decides nor makes the snack wait. Codex's liveness note (a wait unbounded only under sustained overlap) is stated with the coalescing and quote cadence. P4.5 held-claim → Home list `load` → Settings cases, visible and visibility-off |

Round 11: codex **conditional approve, confidence high** (round 10's condition met; one new
major condition).

| # | Leg | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | codex | major | Deletion does not invalidate a pending snack: a newer read captures the receipt before its asynchronous dust filter, reconciliation deletes it and emits `onIncomingTransferDeleted`, and the read, still the newest, returns the captured record and opens "Received" for a record already removed (`service.ts:456`, `:1071`) | Verified: `getIncomingTransfers` lists before `applyDustFilter` awaits (`:456-460`); every delete path emits Deleted (`:430`, `:1027`, `:1071`, `:1809`). The coordinator consumes Deleted: the id leaves `announced` and a pending snack for it is vetoed; the persisted claim stays; the listener is removed in `dispose()`. P4.5 case for a delete while the claim waits on a read holding the earlier snapshot; the listener case names it |

Round 12: codex **approve, confidence high** (round 11's condition met; no new material
finding). It checked a delete then re-add of the same id (the veto binds the pending snack, not
later membership in `announced`), reconciliation of a still-stored public receipt (updated in
place, no Deleted, `service.ts:1873`) and a Deleted before the Added (the service lock
serializes persist and emit against deletion, `:1159`).

## Approval

Recorded under the program's standing approval (implementations-plan/ux-feedback/plan.md
§ Standing approval), 2026-09-25.

1. **Met.** Phase 0 is the program's pre-answers (§ Phase 0 above); no clarifying questions were
   asked.
2. **Met.** Codex's final verdict, round 12, session `01a0d502-f1cf-7bd3-a002-71c64b0953c2`:
   "VERDICT: approve — confidence: high". Rounds 1-11 were conditional approves; each round's
   conditions were applied and confirmed by the resumed pass that followed.
3. **Met.** Fable's final verdict, round 6: "approve, confidence high". Its round-5 conditions
   were applied and confirmed by that pass.
4. **Met.** No Ask is open: the technical Asks are decided with codex and logged (§ Asks → codex);
   the UI asks are listed as **sign-off pending** for the PR (§ UI asks for the owner, § Delivery).
5. **Met.** UI impact lists only spec surfaces (items 10, 11, 12 and their undrawn states) and
   owner-held asks built as recommended.
6. **Met.** Nothing outside the batch's scope.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-N.md`.
The Local gates are the program's ([Local gates](../plan.md#local-gates)). A retry-0 smoke run
uses a scratch config that spreads `apps/extension/vitest.e2e.config.ts` with `retry: 0`, as batch 1
does.

### P1 · The snack and every call site, atomically ✓

1. Regenerate the call-site table from the current tree (count, file:line, message, kind, rule),
   check it against recon's 130/56/7, and write it to `lessons/phase-1.md`.
2. `toast.ts` + `toast.test.ts`, rewritten, with fake timers:
   - a success is visible at 5.9 s and gone at 6 s;
   - a hold at 2 s stops it; a release resumes the remaining 4 s; a repeated hold or release
     changes nothing;
   - an error has no timer and stays after any time;
   - a missing kind is an error;
   - a new open replaces the current one, clears its timer and gets a new id;
   - `onSelect` runs after the close (the spy reads `toast.value` as `null`);
   - `closeToast` clears the hold and is a no-op on nothing.
3. `ToastManagerBase.vue` + `ToastManagerBase.test.ts`, `enableAutoUnmount(afterEach)`:
   - both regions exist with no toast; a success renders inside `role="status"` and an error
     inside `role="alert"`; the same text opened twice renders twice (new id); a success replaced
     by an error leaves the status region empty;
   - with transitions running (not stubbed), fake timers that include `requestAnimationFrame`,
     and `getComputedStyle` stubbed to report `transitionDuration: 0.15s` so the leave lasts
     150 ms (jsdom computes no duration, and Vue's leave otherwise ends after two frames, Fact 30):
     after a second open of the same kind, and after a success replaced by an error and the
     reverse, the two regions together hold at most one `[data-testid="snackbar"]` right after
     the open's `nextTick` and after every advanced frame until the new card has entered, and the
     new card is present at the end (a build without `out-in`, or with a cross-region
     cross-fade, shows two at the first sample); both regions share one grid cell;
   - on the same timers, a success replaced by an error, then `closeToast()` before the leave
     ends: after the leave neither region holds a card or any text, and nothing appears on later
     frames; the same with a second open during the wait (only the newest enters) and with the
     component unmounted during the wait (no error, nothing rendered);
   - title, sub and View render; the error has × with `aria-label="Close"`, and × closes it;
   - a click on the card leaves the timer armed (visible at 5.9 s, gone at 6 s);
   - hover then focus, and focus then hover: leaving one keeps the hold while the other holds;
     focus moving between View and × keeps it;
   - a replacement while the card matches `:hover` is held (jsdom matches `:hover` only during a
     dispatched mouse event, Fact 33, so the test stubs the card's `matches` to answer true for
     `":hover"`, restored after the case);
   - `bottomInset` sets `bottom`; unmount while held releases it.
4. Stories rewritten (success, error, long text).
5. `ToastManager.vue` + `ToastManager.test.ts`: the inset is 76 on a `showBottomNav` route and 12
   otherwise.
6. Both shells: `#toast` at the end; `defer`.
7. Every call rewritten with its kind; `utils/clipboard.ts` and the three custom specs; `icon`,
   `color`, the duration argument and `TOAST_DURATION` removed from the composable, the shim and
   the `.d.ts`. The 43 test files re-read and updated; the four `LONG: 5_000` mocks deleted.
   Send keeps its current label and gains `kind`; its sub line and View come in P2.
8. `toast-call-sites.test.ts` (above), non-vacuous.
9. `waitForToast` (`helpers.ts:1366-1377`) reads `[data-testid="snackbar"]`'s title and sub, takes
   an optional `{ kind }`, and returns the element; its doc says "success 6 s, error until
   closed". Each caller keeps its string. `helpers.ts:1895-1898` loses its first sentence and keeps
   its diagnostics. `contacts.test.ts:116` is re-enabled.
10. Smoke spec `tests/e2e/snackbar.test.ts` (new), in the 360×600 popup page:
    - a copy success on Home: rect bottom = window height − 76 and rect width = window width − 32
      (the region spans the viewport); present at 5.5 s, gone by 6.5 s;
    - two copies 50 ms apart, and a copy success followed at once by the error this spec raises
      below: a sampler installed in the page before the first press counts
      `[data-testid="snackbar"]` on every animation frame for 1 s and never sees two;
    - the real pointer on the snack for 8 s keeps it; after leaving, it is gone within 6.5 s;
    - an error reachable in smoke (the P1 table names it): it stays past 10 s, its bottom is 12px
      on a page without the nav, Tab from the last page control reaches `snackbar-close`, and Enter
      closes it.

Gate: `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`,
`bun run --cwd apps/extension build-storybook`, and the smoke suite on each browser `<b>` of Chrome
and Firefox — `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet
VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension
build:<b>`, then `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` — all exit 0.

### P2 · Send's result, K-1 and the lock ✓

1. `send-submit.ts`, `send.vue`: the snapshot fields, `isCurrent`, `viewTransaction`, the success
   and failure snacks. `send-submit.test.ts` with a wire-shaped hash (`0x` + 64 hex) and a real
   18-decimal amount: the sub reads "{amount} {symbol} to 0x…"; a 9-digit whole amount keeps every
   whole digit; View pushes `/popup/tx/<hash>`; a malformed hash gets no View; a failure is
   `kind: "error"` with the failure sentence; a cancel opens nothing; a lock or a scope change
   during the await opens nothing, and so do the round trips A → B → A and lock → unlock, which
   end on the same ids but a new `scopeEpoch`.
2. Check that `/popup/tx/<hash>` finds the fresh transaction in `appStore.transactions`
   (`tx/[id].vue:62`; `addTransaction` runs first, `transfer-executor.ts:171`, `:206`); if not, log
   it and take it to codex.
3. `Popup.vue` + a component test on the real focus-trap (only `@/utils/core` mocked;
   `Element.prototype.getClientRects` stubbed to return one rect for connected elements and
   restored in `afterEach`, since tabbable otherwise finds nothing in jsdom, Fact 33; no
   production `tabbableOptions` is added): with a
   snack open, Tab from the first control visits exactly the popup's controls in order, then
   `snackbar-close`, then the first control again (the whole cycle, so the removed dummy button
   cannot hide in it); with two popups stacked, only the top one's controls and the snack cycle;
   × by keyboard closes the snack and focus returns to the recorded element; Esc on × closes the
   popup and leaves the snack; a popup with no tabbable control focuses its wrapper; with no
   `#toast`, the trap has one container.
4. `popup/app.vue` (S-16): lock closes any snack; a profile, network or account change closes a
   snack with an action and keeps one without; lock and every scope change bump
   `appStore.scopeEpoch`; tested through the shell's existing test harness or a small extracted
   helper.
5. Smoke: extend `snackbar.test.ts`: an error raised by a popup form (the P1 table names one), then
   Tab reaches `snackbar-close` and Enter closes it with the popup still open.

Gate: as P1.

### P3 · One interactive row ✓

1. The inventory table of every list (file:line, before, after, link or button) in
   `lessons/phase-3.md`, including each click-mode `SettingItem` whose handler only navigates.
2. `RowTarget.vue` + test (L2, at least 5 cases), mounted with a real router
   (`createRouter({ history: createMemoryHistory() })`, never a stubbed `RouterLink`): link mode
   has an `href`; a click, and a Space `keydown`, each change `router.currentRoute` exactly once
   (a spy on `router.push` sees one call), and Space's default is prevented; Shift+Space and a
   Ctrl-click do not navigate; `activate()` navigates once in link mode and reaches the root
   listener once in button mode; button mode's click bubbles to a root listener on Enter and Space;
   `aria-labelledby`; the target renders `data-row-target`.
3. `RowAction.vue` in `@nulo/design` + test (at least 5): 24×24 box class, `aria-label` required, a
   click does not reach the row, the `href` form has `rel="noopener noreferrer"`, the testid passes
   through; the resolver entry.
4. `TransactionCardLayout.vue` + its test: `to` renders a link target, `opens` a button, neither is
   inert (no `tabindex`, no pointer class); the root keeps its testid and data attributes; the
   reservations for 24px actions; with `opens` and an `amountFiat`, a click on the fiat span
   emits `activate` exactly once.
5. The four cards, `TransactionsList`, `RecentActivityView` and their tests: each row kind routes to
   its path; a queued awaiting row is a button and other stages are inert; Home and History render
   the same element for the same row; `TransactionAwaitingCard.test.ts:168-176` asserts that no
   `button`, `a` or `[tabindex]` contains another; `RecentActivityView.test.ts`'s `useRouter` mock
   becomes `href` assertions. The incoming card mounted with a real router: `activity-fiat` keeps
   its `title`, is not a descendant of `[data-row-target]`, carries the raised class, and a click
   on it changes `router.currentRoute` exactly once; with `tokenDecimals` of `-1`, `1.5` and
   `1000` the card renders without throwing and with no amount column (A-15).
6. `SettingItem.vue` + `Settings.test.ts`, on a real router: link, click and inert modes;
   a disabled row with `to` and a disabled row with `@click` each contain no `a`, `button` or
   `[data-row-target]` and have no `tabindex`, and Enter on them neither navigates nor calls the
   handler; Space on an internal link navigates once and Shift+Space not at all; Space on an
   external row calls its anchor's `click()` once and prevents the scroll; no root has a
   `tabindex`; in a click row with a nested `RowAction` (the `AccountsPopup`
   shape), the action fires and the row handler does not.
7. The other lists, each with its test updated: `TokenCard` (real router: Space navigates once,
   Shift+Space not at all), `ContactRow` (a link to
   `/popup/send?contact=<id>`; Space and Enter; `contact-sender-chip` keeps its `title`, sits
   outside the target and opens the row once on a click), connected apps, `AuthwitCard`, notes, `FpcRow`
   (the `Icon` stub replaced by `RowAction`), accounts, tokens, senders, endpoints, contracts.
   `send.test.ts`: `?contact=<id>` of the active profile preselects that contact; an unknown or
   another profile's id selects nothing; no store write is involved.
8. e2e audit: every programmatic root `click()` in `tests/e2e` listed in `lessons/phase-3.md` and
   shown to hit a click-mode row.
9. Smoke spec `tests/e2e/rows.test.ts` (new), with real key presses and measured boxes:
   - Tab to the first activity row on Home: the focused element is a link and its row shows the
     ring (computed `outline-width` 2px); Enter opens it with exactly one `history.pushState` call
     (counted by a wrapper installed in the page before the key press) and one new history entry;
     Space opens a link row the same way, and the page does not scroll;
   - a Ctrl/Cmd-click on a contact row opens Send in a new tab with that contact selected, and
     the original tab stays on Contacts;
   - a button row (a click-mode Settings row) opens with Enter and Space;
   - an inner action's box is at least 24×24, and a real pointer press on it runs the action and
     does not navigate;
   - a `RowAction` inside a batch-3 `Tooltip` (an endpoint row): Enter and Space each run the
     action once, and the row does not activate;
   - an inert Settings row is not a Tab stop;
   - on a contact row with its S chip or a priced activity row, whichever the smoke fixtures can
     render (recorded in `lessons/phase-3.md`; if neither, the check runs on the P5.1 capture), the
     element at the titled span's center (`document.elementFromPoint`) is that span, so its title
     can show, and a real pointer press on it opens the row with one `history.pushState`;
   - History's list leaves room for the −8px row box (no horizontal overflow).

Gate: lint, `typecheck:all`, `test:all`, and the smoke suite on Chrome and Firefox, all exit 0.

### P4 · Arrivals and the elsewhere-snackbar ✓

1. Tip probe first: in the network sandbox, log the tip `getLatestBlockNumber` returns and the
   `l2BlockNumber` of a receipt sent after it, on each browser, into `lessons/phase-4.md`. The
   receipt's block must be above the tip; if it is not, the phase stops and goes to codex.
2. `arrival-state.ts` + test: `isArrivalEligible` (played, `sinceBlock: null`, a pending floor, a
   block equal to the account floor, equal to the token floor, one above both); `claimPlayed`
   (claims 501 receipts in blocks 1..501: the row keeps 500 entries and `sinceBlock` becomes the
   evicted block, and none of the 501 is eligible afterwards; an unplayed receipt under the
   raised floor is not eligible); the row schema (a string, `NaN`, a negative, a fraction, an
   oversized `played`, a 201-character id, valid).
3. `incoming-transfer/service.ts` + its tests, with the tip faked through the injected
   `PublicEventReader`:
   - the PXE method in `packages/aztec-runtime`: `descriptors.test.ts` with 26 methods and
     `getLatestBlockNumber` in `SW_ONLY`; the service method returns the fake node's
     `getBlockNumber()`;
   - `getArrivalState`: a missing row baselines to the tip and a record at the tip is not
     eligible; a stored `sinceBlock` and a stored floor above a lower tip both stay, and so does
     a `sinceBlock` raised by eviction when the tip later reads lower; a row with no pending
     floor reads no tip; a failed tip read returns `sinceBlock: null` and writes nothing; with the
     profile tombstoned, or the network or account gone, nothing is written;
   - a floor written by `onTokenAdded` at tip N + 1 after an earlier read saw N stays N + 1
     through the next `getArrivalState` (every write reads the tip fresh);
   - two writers for one contract in the other order: `onTokenAdded` reads tip N and is held at
     the lock while `setTrustAllow` reads N + k and writes; the add then enters and the floor stays
     N + k; a floor at 200, then a failed tip read (the floor reads `"pending"` and keeps 200),
     then a `getArrivalState` whose tip reads 150: the floor resolves to 200 and a record at block
     180 is not eligible; a failed tip read with no stored floor, then a tip of 150, resolves to
     150; a pending floor that a successful write replaced before the resolution entered the lock
     is not overwritten, and that write cleared the mark;
   - `claimArrivals`: claims once, and a second call for the same id returns nothing; ignores ids
     of another profile, network or account, played ids and unknown ids; the epoch fence: the
     claim captures its epoch, `clearProfile` completes, then the claim enters the lock and writes
     nothing, and the row is absent; the ownership fence, separately: a claim held inside the lock
     past the watchdog (fake timers beyond five minutes) while a successor enters writes nothing
     after it resumes;
   - the repository: a trust state change through `repo.setTrust` (to `unknown`, to `pending`)
     keeps the stored `arrivalFloor`;
   - floors: `onTokenAdded` writes the token's floor before `hydrateSchedulers` runs, so the
     token's history committed by the next scan is not eligible; `onAccountAdded` writes the new
     account's `sinceBlock` before the cursor reset; `setTrustAllow` with two accounts that both
     hold rows and hidden records: after Allow in A, neither A's nor B's flipped records are
     eligible, and a later receipt in a higher block is eligible for both; a failed tip read
     leaves the floor pending, and the next `getArrivalState` with a tip resolves it;
   - purges: `clearProfile`, `clearChain` and the account purge delete the arrival rows of their
     scope and no other profile's, network's or account's.
4. `useIncomingTransfers.ts`: `useIncomingTransfers.test.ts:96` inverts (Added triggers a refresh;
   a dust record never appears); three Added in one tick make one refresh; Added every 100 ms for
   3 s still refreshes within 1 s of the first; `afterRead` resolves before the rows are assigned,
   and a scope change during it drops the rows; a rejecting `afterRead` still assigns the rows.
5. `useArrivals.ts` + test (C1, at least 10), with the service client faked:
   - a list mounted with an eligible record and a loaded state renders `data-arriving="true"` in
     its first rendered DOM, before any claim promise resolves; after 2,600 ms it is gone;
   - on Home, `present` claims only the rendered records and sets `latest` to the newest claimed
     one; a record the claim does not return (another document won) sets no `latest`, keeps
     animating for its 2.6 s, has no `data-arriving` at 2,600 ms and after any later re-render
     while still eligible in the in-memory state, and is not claimed again;
   - Home to the token page inside the window: the token page's row has no `data-arriving`; Home
     to History inside the window: History's row has none either;
   - an uncontended read after the seeding read, returning one new eligible record discovered
     after the seeding read started, on Settings, opens its snack (its nested `load` does not drop
     it);
   - same-scope ordering: a read that returns a visible record is held, a visibility-off read
     starts and completes, then the held read resumes: no snack opens, nothing is claimed and the
     state is the newer read's, and the held read's ids are still in `known`; the same with two
     `load`s; the token page's list passes no `afterRead`; on Home, a list `load` dropped by a
     coordinator read started after it resolves only after that read's state is held, and rows
     an Allow un-hid in between then have no `data-arriving`; the same race with the coordinator
     read's `getIncomingTransfers` rejecting: the dropped `load` resolves only after that read
     fails, the scope is suppressed, the Allow's rows have no `data-arriving` and nothing is
     claimed;
   - a failed state read after an Allow: `load` holds a state, then Allow un-hides two historical
     records, the records read returns them, `getArrivalState` rejects: `load` resolves, neither
     row has `data-arriving`, nothing is claimed; after a later successful `load` the two rows
     still have none, and a new receipt in a higher block plays; with no earlier state, a
     rejection plays nothing either;
   - one play per receipt; a fresh composable over the same fake service state (a remount)
     replays nothing;
   - two receipts with the same `discoveredAt` delivered separately both play;
   - on the token page and on Settings, a start read with three eligible records opens no snack
     and claims nothing, and `seeded` is set; a later read that returns those three and a new one
     opens one snack, for the new one; the three then play on Home; after a lock and an unlock
     (a new `scopeEpoch`), the seeding read runs and completes while the route is still
     `popup-auth`, opens nothing, and `seeded` is set before the route reaches Home; a receipt
     that then arrives while the route is Settings opens its snack; on `popup-auth`,
     `popup-register` and any `windows-*` route, a later read with a new eligible record opens
     nothing and claims nothing, the record joins `known`, and it then plays on Home;
   - a record that reappears after `onQuotesUpdated` or a visibility config change, and was never
     shown, plays once on Home if eligible; on Settings, visibility off at start (the seeding read
     returns nothing), then turned on: the next read returns an old eligible record, opens no
     snack, claims nothing and adds it to `known`, and it then plays on Home; the same on the
     token page for a record a quote lifts over the dust threshold;
   - after seeding on Settings:
     - visibility turned off, a receipt discovered (no Added), visibility turned on: the next read
       returns it, opens no snack, claims nothing, and it then plays on Home;
     - an Added for a dust receipt, whose settling read filters it, then a quote lifts it: no
       snack, it plays on Home;
     - an Added for a dust receipt, then a quote lifts it before the settling read starts: that
       read shows it, and its snack opens (A-11's stated edge);
     - a read that started before an Added completes after it and returns the new record: no
       snack from that read, and the next read opens its snack;
     - a read that started before an Added completes before the Added arrives and returns the new
       record: the next read, after the Added, opens its snack;
     - after an Added, a quote-triggered read starts, then the coalesced Added read supersedes
       it: the superseded read settles nothing, and the newer read opens the snack once;
     - a settling read that fails: no snack, and a later read opens none for that id;
     - a settling read sends its claim, the response is held, a quote-triggered read starts and
       completes with the record unchanged, then the claim returns it: exactly one snack;
     - the same, with that read completing after visibility was turned off, or after navigating
       to Home: no snack, and the id stays claimed;
     - the claim returns while a read started by turning visibility off is still in flight: the
       snack waits, that read leaves the id out, no snack;
     - a read that started before the settling read completes after the claim was sent and leaves
       the id out: it decides nothing, and exactly one snack opens;
     - the claim returns while a newer read is in flight and that read fails: no snack (A-6);
     - a claim is held, Home's list `load` runs, the route returns to Settings, the claim
       returns: exactly one snack; the same with visibility turned off after Home's `load`, whose
       coordinator read leaves the id out even though a later list `load` supersedes its state:
       no snack;
     - a claim is held while a newer read has returned the receipt from storage and waits in the
       dust filter; `onIncomingTransferDeleted` fires for it; the read then returns it and the
       claim returns: no snack; a Deleted for another id changes nothing, and one after
       `dispose` runs nothing;
   - the reads run on start, `onConnected`, a scope change, Added (coalesced), both config keys
     and `onQuotesUpdated`; a Deleted starts none; `dispose` removes each listener, Deleted's
     included (a later emit runs nothing);
   - a scope change, a lock, or A → B → A during a read drops the result and claims nothing;
   - the snack's title, sub and View for a note ("Private") and a public event ("Public"); a
     sentinel `from` is absent from every argument and changing it changes nothing; a symbol and
     an account name with HTML-like text, bidi controls and 1,000 characters arrive stripped and
     cut; a token with `decimals` of `-1`, `1.5` or `1000` opens no snack and claims nothing;
   - after the seeding read, three Added in one tick open one snack; `dispose` clears timers and
     a callback after disposal does nothing.
6. `TransactionIncomingCard`, `TransactionCardLayout`, `RecentActivityView`, `activity.vue`,
   `TransactionsList`: `data-arriving` on exactly the eligible rendered rows, from the first
   render, and on the amount span's class; cleared after 2.6 s; the token page's list never sets
   it; an incoming row whose token has invalid `decimals` renders, with no amount, and can play.
7. `BalanceView` + test:
   - `balance-arrival-status` exists with no arrival and is empty; an arrival's text lands inside
     it, in `balance-arrival-chip`, keyed per arrival; a second arrival replaces the chip inside
     the same status node; an arrival with invalid decimals shows no chip;
   - on fake rAF, with the pre-rise value established a minute earlier: a rise 3 s after the
     arrival counts from that value, and a rise 3 s before it counts too; a rise 11 s after it
     does not count; a second arrival mid-count retargets from the value on screen; the last
     frame equals the aggregate's own string for a large value;
   - no count when the aggregate falls, is loading or unknown, or fiat is off; `enterScope`
     cancels a running count and a rise right after the switch does not count from the old
     scope's value; reduced motion and `.noanimations` show the final value with no frames;
     unmount cancels the frame.
8. Network spec `tests/e2e/network/incoming-arrival.test.ts` (new, `@requires-proverless`), using
   `fixtures/incoming-poll-gate.ts` to release the discovery:
   - on Home, the new `tx-incoming-card` has `data-arriving="true"` and `balance-arrival-chip`
     shows; after closing and reopening the popup, no row has `data-arriving`;
   - on Settings, once the shell root carries `data-arrivals-seeded="true"`, the spec releases a
     second receipt: a success snack opens whose title starts "Received" and whose sub starts
     "Private · " or "Public · "; View opens `/popup/received/`; Home then plays nothing; the
     same after a lock, an unlock and a move to Settings, with no other trigger in between (the
     unlock's seeding read, not a quote refresh, is what arms the snack);
   - a receipt discovered while no popup page is open, then a popup page opened straight on
     Settings (the tab page's Settings URL): no snack once `data-arrivals-seeded` is set; Home
     then plays it;
   - with "Disable animations" on, a third receipt's row runs the calm animation: its computed
     `animation-name` contains the local name `n-row-glow` and not `n-row-in` (module keyframes
     are renamed, so the check matches the local name inside the scoped one), the chip's contains
     `n-plus-calm`, and a sampler installed in the page before the aggregate updates reads the
     hero on every animation frame for 1.2 s and sees only the old and the final string; on
     Chrome the same under emulated `prefers-reduced-motion: reduce`;
   - importing an account with receipt history plays nothing on its first Home;
   - hostile bounds: a token deployed by the spec with a 31-character symbol, the constructor's
     limit, and an explicit short name through the helper's fifth parameter
     (`deployTestToken(…, symbol, "Hostile")`, `fixtures/aztec.ts:148-167`; the default name,
     `` `${symbol} Token` ``, would exceed the name's own 31, Fact 34), 10^38 base units received,
     and the account's name set to 1,000 characters with a bidi control by rewriting its
     `nulo:core:accounts@…` row's `name` in `chrome.storage.local` from an extension page, then
     restarting the background (`stopBackground`) and reloading the popup (no UI path accepts
     that length, Fact 34; a restored backup is the real one). After the seeding read, on
     Settings the snack's rect lies inside the 360px
     viewport and the elements at View's and the snack's centers (`elementFromPoint`) are the
     snack's own; on Home the chip is at most 312px wide and inside the viewport, its computed
     `text-overflow` is `ellipsis` and its `scrollWidth` exceeds its `clientWidth` (the string
     really is cut).

Gate: lint, `typecheck:all`, `test:all`, the smoke suite on Chrome and Firefox, and the arrival spec
on both browsers, proverless:
`NULO_E2E_BROWSER=<b> NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0
NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent
tests/e2e/network/incoming-arrival.test.ts`; and, since the incoming service's trust, token-add and
account-add paths change, `network/incoming-transfers`, `network/incoming-public-transfers` and
`network/account-switch-isolation` on both browsers in each browser's gate mode (P5.3's), all exit 0.

### P5 · Parity and arc gate ✓

1. Parity: rebuild the mocks and render the batch's shots; capture each surface at the mock's size
   (popup 360×600, dApp window 400×800):
   - History with a success snack, and with an error (`10-snackbar`);
   - History with the nav and the snack in place (`10-round1`);
   - Home rows at rest, hovered and focused, and a History row hovered (`11-rows`);
   - Home mid-arrival, and the same with reduced motion emulated (`12-arrival`);
   - Settings with the arrival snack (`12-incoming`);
   - also, undrawn: Send with an error (S-1), the execute window with an error (S-1), the
     onboarding tab with a snack (S-2), a popup with an error and × focused (K-1).
   Publish one private Artifact placing each capture beside its shot. The driver and the fable leg
   list every difference, pre-existing ones included: Home's aggregate hero against the drawn token
   hero; the incoming row's title (the token symbol against "Receive"), its label ("Received
   privately" against "Private"), its hash against "Just now", its arrow icon against
   `south_west`, its green `check-circle` badge against none, its `·` separator against `/`, and
   its green kind chip against the drawn `--nulo-secondary` chip
   (`TransactionIncomingCard.vue:53-60`, `:62-64`, `:67`, `:92`; `parts/12-incoming.html:36`,
   `nulo.css:233`). None of them changes in this batch; each is listed for the owner.
2. Every Local gates row: `bun run lint`, `bun run typecheck:all`, `bun run test:all`,
   `bun run test:ci-gating`, `bun run build`, `bun run --cwd apps/extension build-storybook`; the
   full smoke suite on Chrome and on Firefox.
3. Network e2e, retry 0, in each browser's gate mode (Chrome prover on, Firefox proverless;
   `@requires-proverless` files proverless on both): `network/fee-methods`,
   `network/senders-advanced`, `network/token-management`, `network/incoming-transfers`,
   `network/incoming-public-transfers`, `network/incoming-arrival`,
   `network/account-switch-isolation`, `connect-dapp`, `tx-sendTx-selfPay` (the execute window's
   error path). The list is re-checked against every `waitForToast(` and `tx-incoming-card` reader
   and recorded in `lessons/phase-5.md`.
4. Flake bar: three consecutive retry-0 runs per browser of each new or changed e2e file:
   `snackbar.test.ts`, `rows.test.ts`, `contacts.test.ts`, `network/incoming-arrival.test.ts`, and
   the spec that calls the `helpers.ts:1895` helper (smoke through the scratch retry-0 config).
5. `bun run e2e:reap`.

Gate: all of the above exit 0 and the parity Artifact URL printed.

### P6 · The owner's parity answers

The owner, 2026-09-25, on the parity page's thirteen calls:

> "for batch 4: 1. c, 2. b, 3. a. 4. b? 5. b, 6. (a), 7. follow-up. 8. I don't quite see what you
> are saying. 9. (a), 10. (b), 11. (a), 12. I don't get this. Go with (a) then. 13. (a) follow-up
> maybe?"

Built for 1, 2, 5, 10, 11 and 12. Nothing is built for the rest: 3 (no ring on × and View), 4
("b?" is unconfirmed, so a receipt with fiat values off still gets no chip), 6 (the start-up rule
stays), 7 (a follow-up), 8 (the received row stays as it is), 9 (A-1′ signed off) and 13 (the
older layout differences stay). The log is `lessons/phase-6.md`.

1. **Above the footer (1c).** On every page or window without the nav that has a bottom action
   row, the snack sits 12px above the row's top edge and never covers its buttons; with neither
   the nav nor a row, 12px from the bottom. The row can grow (a wrapping error line) and the snack
   follows it. A `v-snack-footer` directive marks each row and the host `ToastManager` computes
   the inset (`composables/snackInset.ts`); `ToastManagerBase` still takes a number. The inventory
   is in the log. A row counts at the highest point its top edge reaches on screen, now or once the
   page is scrolled to its end, so in a window shorter than the page the snack is already clear of
   a row that a scroll brings up (the batch's `window-placement.test.ts` regression, found by arc
   5a's full run and bisected to `6fbfdeb5`). e2e on both browsers: Send with an estimate error and
   the execute window with one, each 12px above its footer, and the execute window at 400×500 with
   Reject and Confirm clear after a scroll, with and without an error line
   (`network/snack-placement.test.ts`); `network/window-placement.test.ts` passes unchanged.
2. **The first open's timer (2b).** A success's 6 s starts when it opens, even under a resting
   pointer. The hold engages only on a pointer move onto the snack after it opened, or keyboard
   focus entering it; leaving resumes the remaining time (S-12). The hover and pointer-over events
   a browser synthesises when content appears under a still cursor do not count. e2e on both
   browsers: a copy whose snack opens under the cursor, the mouse still, is gone within 6 s plus a
   small tolerance.
3. **Details on a failed send (10b).** "Send failed" gets "Details", drawn like View (i10 A′),
   which opens that send's journal page `/popup/journal/<id>`. Only a failed send gets it, and only
   when that send has a journal entry the wallet confirms (a failed, terminal transfer in the
   submitted scope); every other error keeps no action. The id travels beside the error, not in
   it: see § Architecture, A failed send's journal id.
4. **Width in dApp windows (11a).** In the execute, discover, permission, verify and passkey
   windows the snack spans the 360px content column less 16px a side (328px), centred on it. The
   json and logger windows fill their window, so they keep the popup's rule. The popup and the
   onboarding tab are unchanged.
5. **Over a sheet (12a).** While a sheet that covers the nav is open, the snack sits 12px from the
   bottom, or 12px above the sheet's own footer row if it has one; when the sheet closes it goes
   back to 76px. `v-snack-sheet` on `components/Popup/Popup.vue` tells the host a sheet is open.
6. **Two more rows (5b).** Settings → Advanced's Logs row becomes one button with its list's hover
   tint and the 2px accent ring, opened by Enter and Space (R-1, R-2, R-7). The Revoke
   authorizations popup's expand icon becomes a 24×24 named button (R-3). The Advanced page's
   rows have no tint; they fade to 0.8 on hover, so the Logs row keeps that fade and its focus draws
   the ring at full opacity (**pending**). The sheet revokes on any Enter that reaches the
   document, so Enter on the new button stops there and only opens the content.

Gate: `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`,
`bun run build`; the full smoke suite on Chrome and on Firefox (the gate's flags); every changed or
added network e2e file at retry 0, Chrome prover on and Firefox `NULO_E2E_PROVERLESS=1`
(`@requires-proverless` files proverless on both), plus `network/window-placement.test.ts` three
times per browser at retry 0, the one spec that drives the approval footer under a persistent
error; `bun run e2e:reap` after each e2e run. Then the parity captures for the new states, outside
the repo.

### P7 · Arc gate on the final source

The driver's. It reruns P6's gate on the stack's final source; its network list keeps
`network/window-placement.test.ts`, three runs per browser at retry 0.

## Arc boundary

1. The codex fix loop (below) until a round has nothing material, three rounds at most.
2. Parity evidence re-captured if the loop changed a surface.
3. `gh stack push`, then `gh stack add feat/ux-5a-authorization-confirm`.

## Post-implementation (read by the implementing session)

The review loop is `/codex high` (GPT-6 Astra) on the arc diff (`feat/ux-3-tooltips-glossary
...HEAD`), resumed until a round reports nothing material, three rounds at most; `/code-review` is
off. Every codex prompt, initial and resumed, carries:

- *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
  extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
  problem. If code works and is clear, leave it alone."*
- *"Audit the comments for value per character. Flag any comment that narrates what the code
  visibly does, restates its line, references implementation plans / phases / reviews, or spends
  a paragraph where a sentence works — and flag places where a non-obvious invariant or
  constraint deserves a comment it doesn't have. Comments are permanent context every future
  reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
- The arc map: "this is arc 4 of 6; arcs 1 (first run and wording), 2 (window placement) and 3
  (tooltips and glossary) are below it; arcs 5a (the per-app authorization flag and its
  confirmation window) and 5b (the redesigned permission window) build on top of it, so seams
  reserved for later arcs are not flagged as dead code".
- The adversarial ask and the parity rule: "flag any UI that differs from the spec or invents a
  state it does not draw", "flag any path by which a sender, dust or an untrusted record reaches
  a row, chip or snack", and "flag any path by which a snack, an arrival or a seen-state write
  outlives a lock or a scope change, or plays a receipt twice".

Each finding is fixed in its own commit or rejected with a reason in `lessons/phase-5.md`. Codex
is advisory: it cannot override the spec, the owner's picks, CLAUDE.md or this scope.

## Delivery

- Arc 4 of 6 on `feat/ux-4-snackbar-rows-arrivals`, stacked on `feat/ux-3-tooltips-glossary`.
- Commits: conventional, lower-case, signed; one per phase at least, fixes separate.
- `gh stack push` as checkpoints; no PR until the program's final pass (program Delivery). Never
  merge.
- PR body (at submit): summary; the UI impact table; the owner's quotes (i10 "The timer bar on the
  snackbar looks weird.", i11 A, i12 B); the per-call-site table (P1) and the list inventory (P3);
  the **sign-off pending** list (S-1 to S-16, K-1, R-1 to R-7, A-1′, A-2 to A-16); the parity
  Artifact link with its difference list; screenshots of the snack, a focused row and the arrival;
  test evidence.
- Follow-ups, into `implementations-plan/follow-ups.md` at close: the incoming row's 8-character
  amount drops whole-number digits (`utils/amount.ts:111-113`, a visible change for the owner);
  `nulo:ui:pinnedTokens@<profileId>` outlives profile deletion (the reset page removes only the
  two fee-payment keys, `settings/security/reset.vue:85-87`, and the deletion coordinator none);
  `setTrustAllow` and `setTrustReject` write trust with no ownership fence after their awaits
  (`incoming-transfer/service.ts`), the pattern the token add's fence closed, and older than it.

## Seeds

The program's `/goal` drives this batch. To resume this batch alone:

```
/goal Deliver implementations-plan/ux-feedback/b4-snackbar-rows-arrivals/plan.md. Done when the transcript shows every phase ✓ with its gate reported passing and LESSONS_FILE printed per phase, a quoted codex re-review with no new material findings, the parity Artifact URL, and gh stack view with feat/ux-5a-authorization-confirm on top. Never merge; UI questions the spec does not answer go to the owner.
```

```
/loop 15m Drive implementations-plan/ux-feedback/b4-snackbar-rows-arrivals/plan.md forward: read it and its lessons, git status, gh stack view; take the next unchecked step; run its gate; commit; on a decision use the spec, else /codex high for technical asks; hard limits stay hard.
```
