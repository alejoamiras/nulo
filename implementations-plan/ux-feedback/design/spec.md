# UX feedback: design spec

The build contract for every batch of this program. The owner decided each item on the proposal
artifact, <https://claude.ai/artifact/SgFiFtDsLtsku8CFre4CsF> (picks in its `picks` store), and
this file quotes what was decided. Where this file and the artifact disagree, the artifact wins
and this file gets fixed.

## How to use it

- **The mocks are the design.** `design/mocks/` holds the artifact's own source and rebuilds it
  byte for byte: `python3 implementations-plan/ux-feedback/design/mocks/build.py`, then
  `node implementations-plan/ux-feedback/design/shots.mjs <out-dir>` renders every decided mock
  listed in `design/targets.mjs` to `<name>.png` plus `text.json` (its visible text). The page
  also holds rejected and superseded options; only the shots named below are decided.
- **Strings are exact.** Every quoted string below ships as written, in the case written. Section
  labels render uppercase through the design system (`SectionLabel`, `n-seclabel`), so they are
  written here in sentence case. Numbers and names in the mocks are sample data.
- **Layout follows the shot.** Same components, same order, same icons, same groups. The mocks
  were drawn from `@nulo/design` tokens and the extension's real component CSS, so a faithful
  build looks like the shot at 1×.
- **A deviation is the owner's call, never an auditor's.** If a shot cannot be built as drawn, or
  a state has no shot, the batch stops for that surface and asks the owner (see
  [Undrawn states](#undrawn-states-round-5)). A codex or fable `approve` is not a sign-off
  (CLAUDE.md, "UI changes need explicit owner sign-off").

## Item 1 · Default account names

- Decided: A. "New accounts are named "Account 1", "Account 2"…" Shot `01-account-names`.
- Surface: `DEFAULT_ACCOUNT_NAME` in `apps/extension/src/wallet/services/account/spec.ts`
  (today `"Account"`); the New Account popup's numbering already continues from there.
- Strings: first account "Account 1"; avatar initials read "A1", "A2".
- No migration (pre-production).

## Item 2 · Tooltip placement

- Decided: A only. "Fix the tooltip itself (placement, width, flip) and skip the helper line.
  Every tooltip in the tooltip map uses this fixed version." Shot `02-tooltip`.
- Surface: `packages/design/src/ui/Tooltip.vue` (one primitive, no new dependency).
- Behaviour: after measuring, the bubble stays 8px inside both window edges, flips above/below
  when it doesn't fit, and is at most **272px** wide (the tooltip map's rule 4, the later round;
  round 1's text said 280, the drawings and rule say 272), and never wider than the window
  minus 16px. Opens on hover and on keyboard focus, Esc closes it, the pointer can move onto it,
  nothing clickable inside.

## Item 3 · Fee wording (V4)

- Decided: V4. "3 => V4". Shots `03-fee-matrix` (column V4, all four states) and `03-fee-round1`
  (the card and menu around the line).
- Surfaces: `FeeMethodSelector.vue`, `FeeCostReadout.vue`, `FeeSettingsCard` and its menu, the
  seeded FPC name in `apps/extension/src/wallet/services/fpc/service.ts`, the Home fee labels.
  The dApp execute window reuses the same card.
- Strings: label "Fee Source" → "Fee"; "Sponsored Fee Juice" → "Sponsored" (and the unnamed-FPC
  fallback "Sponsored FPC" in `fee-helpers.ts` / `fee-privacy.ts` with it); "Fee Juice" →
  "Public Fee Juice" (paired with "Private Fee Juice"); "Estimated Network Fee" → "You pay"; "FJ"
  is the unit everywhere. The menu's right column shows what each option can spend (the balance,
  or "free") instead of repeating public/private.
- The "You pay" line, per state:
  - paying yourself: `~3.577824 FJ ($0.215)`
  - sponsored: `Nothing` then, struck through, `~3.577824 FJ ($0.215)`
  - sponsored, no live price: `Nothing` then, struck through, `~3.577824 FJ`
  - always one line. "Nothing" is not green (owner note on i3).
- Accessibility: screen readers skip strikethrough, so the sponsored row carries its own spoken
  text: "You pay nothing. The sponsor covers about $0.215." (no-price form, derived: "You pay
  nothing. The sponsor covers about 3.577824 FJ.").
- Amount formatting: the existing fee formatter, unchanged; only the layout and words change.
- Undrawn: the menu's right column before the balances arrive or when one is unreadable (U14), and
  the spoken sentence when the fee is under a tenth of a cent (U15), and a sponsor added by hand
  (U16).
- Out of scope: tx detail and receipt fee rows ("Estimated fee", "Network fee").

## Item 4 · Where dApp windows open (A now)

- Decided: A now, B later. "All four windows open at the browser's top-right." B (one connect
  window) is a separate follow-up, not this program. Shot `04-window-placement`.
- Surfaces: `apps/extension/src/wallet/services/window-manager/window-manager.ts` (a second
  placement beside `centerOn`, used by execute, capabilities and discover) and
  `apps/extension/src/wallet/services/wallet-sdk/session-established.ts` (`openVerifyWindow`, the
  emoji window, which today calls `windows.create` itself with no position): both get the same
  placement.
- Behaviour: right edge and top of the last-focused browser window; height
  `min(800, browser window height)`; nothing inside the windows changes. If Chrome rejects the
  position (it refuses windows less than half on-screen), retry with size only. Applies to all
  four dApp windows: connect/permissions, execute, sign, emoji check.

## Item 5 · First run

- Decided: A. "No name field at setup; the profile is created as "Main" and can be renamed later
  in Settings → Profile → Name." Shot `05-onboarding`.
- Surfaces: `apps/extension/src/onboarding/pages/create.vue`,
  `OnboardingProfileNameField.vue`, `useProfileCreateFlow` (takes a default name when the shell
  hides the field).
- Strings: hero "Create" / "Wallet" (was "Create" / "Profile"); method label "How you'll unlock
  Nulo"; CTA "Create wallet" (password) and "Create with passkey" (passkey); fields "Password"
  ("Strong password"), "Confirm password" ("Repeat password") as today.
- Behaviour: first-run profile named "Main"; focus starts on the password field (or the passkey
  button). Adding a second profile later (popup) keeps the name field, prefilled "Profile 2".
- The rule behind it: the first profile, on whichever page creates it, has no name field and is
  named "Main"; every later profile shows the field prefilled "Profile N" (N = profiles + 1).
  `popup/pages/profile/new.vue` can create a first profile too (the e2e `registerProfile()`
  fixture does). First-run import is undrawn: U11.

## Item 6 · The permission window

- Decided: round 3's window with round 4's authorizations row. "6 => B, Off = ask, unknown Off.
  That's freaking awesome." Earlier: "I love it, but the rectangles look like checkboxes. But I
  love the idea of the table." Shots `06-window-S1` (the tools app's real testnet request, the
  Details table open, the broad-request row), `06-window-S2` (Nulo recognizes nothing),
  `06-window-S3` (a broad request), `06-auth-row-B` (the row on and off), `06-off-means-ask`.
- **S2 and S3 predate round 4**: their authorizations row still reads "Get authorizations without
  asking". Build them with round 4's B row below; nothing else in them changes.
- Surfaces: `apps/extension/src/popup/windows/capabilities/` (`index.vue`, `build-items.ts`),
  `apps/extension/src/wallet/services/dapp-session/capability-meta.ts`, the dispatcher's authwit
  path in `packages/wallet-bridge`, the dApp session store (one new per-app flag).

Window, top to bottom (S1):

1. Status strip as today ("Account 1 / Testnet", "NULO").
2. Identity block: host, app name, then "wants to connect on Testnet" (was "is requesting
   permissions on …").
3. Group "Account to share" with a count; the account row shows name, network chip, address and
   a dotted button "Rename for this app" whose tooltip is "A private name for this account
   visible only to this app." It replaces the Alias ⓘ.
4. Group "Without asking, it can", rows with no switch:
   - "See Account 1's address"
   - "Run simulations and read the results", sub "Results can include your private balances."
   - "Add contracts to your wallet"
5. Group "If you allow, it can", every switch in the window lives here and nowhere else:
   - Authorizations (icon `signature`): title "Act for you in transactions you approve"; on:
     "Nulo signs its authorizations without asking."; off: "You confirm each authorization
     first."; "authorization(s)" is a dotted term, tooltip "Lets a contract do one specific
     thing for you, once." Switch label "Authorizations without asking".
   - Address book (icon `contacts`, when requested): "See your address book"; on: "Every name
     and address you saved."; off: "Not shared. The app may ask again later."
   - Unknown (icon `help`, when present): "Use 1 permission Nulo doesn't recognize" (plural
     "permissions"), sub "Nulo can't tell you what it allows.", switch label "Unknown
     permission".
6. Group "Always asks you first": "Every transaction", no sub-line.
7. S2 only: note "Nulo doesn't recognize any of its contracts." (one line, not orange).
8. "Details · 12 contracts": a table, columns "Contract", "Simulate", "Add", "Transact", check
   marks (not squares) for membership, a dash for none; sub-headers "Nulo knows" (contracts the
   wallet already has a name for, shown by name) and "Nulo doesn't know" (shown as a short
   address with a copy icon). Tapping a row lists its functions under "Simulate" and "Transact",
   as the app sent them. Footnote: "Function names come from the app. Anything it didn't list is
   refused instantly; you won't be asked."
9. Footer: "Reject" and "Connect".

Broad request (S3): "Run simulations on any contract" flagged "Any contract"; "Every
transaction, on any contract"; "Details · any contract"; the authorizations row flagged, Off,
off-line "You confirm each authorization first. Off because it listed any contract."

Behaviour:

- **Off = ask.** Off does not remove authorizations: each one the app asks for opens Nulo's
  existing confirmation window (the one that opens today for requests Nulo never signs
  silently) instead of being signed on the spot. One stored flag per app. On keeps today's
  silent signing inside the app's listed scope.
- Defaults: authorizations On, except Off when the list is "any contract"; unknown permissions Off
  (the `build-items.ts` invariant stays); address book as today.
- Rows in "Without asking" and "Always asks you first" have no switch, so Connect grants them as
  requested. Today each card can be unticked; the drawings remove that for simulation,
  contracts and transactions.
- The window fits 800px with no scrolling for S1 and S2; S3 may scroll a little to Details.

## Item 7 · Lock button

- Decided: A1. "Let's keep A1 for now." Padlock plus "Lock", bordered, matching the network chip.
  Shot `07-lock-chip`. Fallback if testers still read the padlock as "private": A2, the word
  alone (not in this program).

## Item 8 · Send privacy strip

- Decided: B. "Takes the least height." The strip keeps its height and swaps its squares for the
  padlock (private) and globe (public) that Home and token rows use. Words unchanged ("You",
  "To", "Amount", "Hidden", "Public", "Sender", "Fee payer"). Shot `08-privacy-strip`.
- The strip's marks come from `publish-mark.module.css`, which the review sheet's rows and the fee
  menu's "names your address" tag share ("one vocabulary"). Only the strip is drawn: U12.
- The strip has a fourth state the decision does not cover: `unknown` ("—", payer not known yet
  or a hand-added fee contract). Undrawn: U13.

## Item 9 · Dotted terms and the glossary

- Decided: dotted terms plus a glossary, word "Authorizations". "9 => Authorizations." Shots
  `09-home-dotted`, `09-glossary`, `09-definitions`, `09-claude-md-rule`.
- Glossary page: Settings → App → Glossary, back arrow, four sections, nine entries (term,
  definition, where it appears):
  - Balances: "Private balance": "Only you can see it. Marked with a padlock." (Home · tokens ·
    send); "Public balance": "Anyone can see it, like a balance on Ethereum. Marked with a
    globe." (Home · tokens · send)
  - Fees: "Fee Juice": "The token that pays network fees on Aztec. Shown as FJ." (Home · fee
    card); "Public Fee Juice": "Paying a fee with it shows your address." (Home · fee menu);
    "Private Fee Juice": "Paying a fee with it keeps your address hidden." (Home · fee menu);
    "Sponsored": "Someone else pays the network fee for you." (Fee menu)
  - Apps: "Authorization": "Lets a contract do one specific thing for you, once." (Permission
    window · approval window); "Name for this app": "A private name for this account visible
    only to this app." (Permission window)
  - Transactions: "Proving": "Your device builds a proof that the transaction is valid without
    revealing what's in it. It's the slow step before sending." (History · Settings)
- One module holds every definition (proposed `apps/extension/src/utils/glossary.ts`); a dotted
  term takes a glossary key, never its own text; a test fails on a key with no entry.
- The CLAUDE.md rule in shot `09-claude-md-rule` lands in the PR that adds the glossary.

## Tooltip map (T)

- Decided: "All of it" ("Everything else sounds pretty good"), without a "sponsor" tooltip. Shots
  `tips-map`, `tips-icon-labels`.
- Rules: two kinds only (an icon-only button's label, or a dotted term's definition); never the
  only copy (definitions are in the glossary, icon labels are the aria-label); nothing clickable
  inside; opens on hover and focus, Esc closes, the pointer can move onto it; one sentence, at
  most 100 characters, at most 272px wide; at most two dotted terms per screen; never a warning
  or a choice.
- Changes: +4 dotted definitions (Home "Public Fee Juice", Home "Private Fee Juice", permission
  window "Rename for this app", permission window "authorizations"); +2 icon labels on the Home
  balance split, no underline: padlock "Private balance: only you can see it", globe "Public
  balance: anyone can see it"; −1 the Alias ⓘ; −2 rule-6 fixes: the suspicious-hostname warning
  (`DappIdentityBlock.vue`) and the recovery-phrase ⓘ (`ImportSecretForm.vue`) become visible
  text. 33 `<Tooltip>`s today, 36 after. The map's "Explanations · 3 … as today" row predates
  the rule-6 decision; the two become visible text.
- Kept: the other 30 `<Tooltip>`s, with item 2's placement fix; the 15 browser `title`
  tooltips untouched. Deliberately not a tooltip: the lock label, permission rows, the
  authorizations consequence, the privacy strip, history stages, the network chip, fee amounts,
  the sponsored fee.

## Item 10 · Snackbar (A′)

- Decided: A′. "The timer bar on the snackbar looks weird." Shots `10-snackbar` (success and
  error), `10-round1` (placement and behaviour notes).
- Surfaces: the toast primitive in `@nulo/design` (`ToastManagerBase`) and the extension wrapper,
  the toast composable, every call site's duration.
- Behaviour: rises from just above the bottom nav; no timer bar. Success: one action ("View",
  opens that transaction), hides after 6 s, waits while hovered or focused, announced politely.
  Error: stays until closed, has a "×" (and "Details" where there is one), announced assertively.
  Transaction messages say what happened and to whom ("Transaction submitted", "250 USDC to
  0x8c02…41fa"; "Send failed", "Not enough Fee Juice for the fee").
- Every success follows the 6 s rule, copy confirmations included: the decision names no
  exception. Which of today's 57 `openToast` call sites are errors (6 pass `color: "red"`) is
  decided per call site and listed in the PR body.

## Item 11 · One interactive row

- Decided: A. "One interactive row: hover and pointer on every row that opens something, none on
  rows that don't." Shot `11-rows`.
- Rules for every list in the wallet: a row that opens something is the target (pointer, full-row
  hover tint, a focus ring matching the hover), a link when it navigates and a button when it
  opens a window, Enter and Space work; rows that do nothing get no hover and no pointer; buttons
  inside a row (copy, cancel) are their own targets, at least 24×24, and don't trigger the row;
  a pending row that can be opened looks exactly like a settled one; the same row behaves the
  same on Home and in History.

## Item 12 · Incoming transfers (B)

- Decided: B. "On Home and History the new row plays its arrival once, and that's the whole
  message. Anywhere else, one snackbar says what arrived, with View to open the receipt. No
  toolbar count." Shots `12-arrival` (A, which B includes) and `12-incoming`.
- Arrival: the new row slides in and glows green for about two seconds; the balance counts up;
  "+1,000 USDC" rises above it and fades. It plays the first time the receipt is seen (live if
  Home or History is open, otherwise the next popup open), once per receipt, via a "seen" marker
  per account. Reduced motion: no sliding or counting; the glow and the chip fade in place.
- Elsewhere: one snackbar, "Received 1,000 USDC", "Private · Account 1", "View". It names
  "Private" or "Public" and the account, never a sender.

## Undrawn states (round 5)

These states exist in the code and have no decided drawing. No batch builds them from its own
judgement: the program draws them into the artifact as round 5 for the owner, and the batch that
owns each builds the owner's pick. The recommended option is what gets drawn first.

| # | Surface | State | Recommended |
|---|---|---|---|
| U1 | Permission window | A connected app asks for more (today "New permissions requested" / "Already granted") | Same groups holding only the new rows; a folded "Already allowed · N" row styled like Details; action "wants more permissions on <network>"; button "Allow" |
| U2 | Permission window | Several accounts to share | "Accounts to share" with today's selectable rows, each with "Rename for this app"; "See the addresses of the accounts you share" |
| U3 | Permission window | Network mismatch / switched banners | Today's banner and button, unchanged, above "Account to share" |
| U4 | Permission window | `data` private events; `contractClasses` | Private events in "If you allow", switch, "See your private events" / "Messages and events sent to your accounts."; contract classes in "Without asking", "Look up contract code on <network>" |
| U5 | Permission window | Rename clicked | Today's alias field appears in place, prefilled |
| U6 | Authorization window (Off = ask) | The existing confirmation window, in the new vocabulary | Title "Authorization", the "Authorizes:" block as today |
| U7 | Settings → Connected apps → app | Permission names and the new authorizations switch after connecting | The window's row titles, with the authorizations switch editable there |
| U8 | dApp identity block | The suspicious-hostname warning as visible text | One orange line under the host, today's sentence with its dash made a full stop (owner, 2026-09-25) |
| U9 | Import | The recovery-phrase note as visible text | One line between the label and the field, today's sentence with its dash made a full stop (owner, 2026-09-25) |
| U10 | Permission window | Cancelled / error overlays | Unchanged |
| U11 | Onboarding import | First-run import (recovery phrase, backup) still shows the name field | Same as create: no field, profile "Main" |
| U12 | Send review sheet, fee menu tag | They share the strip's marks | The same padlock and globe, so the vocabulary stays one |
| U13 | Send strip, review sheet | Nulo can't tell who pays (`unknown`) | No mark; the dash says it; the review sheet keeps the mark's space so the words align |
| U14 | Fee menu, right column | Balances not known yet (loading, or retrying a failed read), or one that came back unreadable | Not known yet: "— FJ", rows selectable as today; unreadable: that row disabled with "couldn't check balance", public and private alike |
| U15 | "You pay", spoken text | The sponsored fee is under a tenth of a cent (`<$0.001`) | "You pay nothing. The sponsor covers less than $0.001." |
| U16 | Fee menu and "You pay" | The sponsor is a fee contract added by hand, which Nulo cannot vouch for | "free" and "Nothing" only for Nulo's own sponsor; a hand-added one shows "—" in both, spoken "Nulo can't tell what this fee contract charges you." |
| A-1 | Permission window (arc 5a) | The interim window before arc 5b's groups; "Already granted" after a declined `data` widening | Today's window; ticks only on authorizations, address book, private events, unknown, each a switch; `data` as two cards; "Already granted" draws the held data half. Block `i6-a1`; shots `06-interim-window-A1`, `06-interim-auth-off-A1`, `06-interim-auth-broad-A1`, `06-interim-auth-broad-on-A1`, `06-interim-data-A1`, `06-interim-data-off-A1`, `06-interim-unknown-A1`, `06-interim-held-A1` |
| A-2 | Permission window | Authorizations with no transaction or simulation scope | The row under "Always asks you first", no switch, "You confirm each authorization first." Block `i6-a2`; shot `06-no-scope-A2` |
| A-4 | Permission window (arc 5b) | "Previously denied" on a re-request | Kept on the title line, grey, `.n-flag` without its icon; on `data`, the new rows only. Block `i6-a4`; shots `06-denied-A4`, `06-denied-data-A4` |
| A-5 | Permission window | A connected app widens its scope later | Widened to any contract: the authorizations row returns new, flagged, Off; more listed contracts: it stays folded. Block `i6-a5`; shots `06-widen-any-A5`, `06-widen-listed-A5` |
| A-6 | Permission window | Flags on the address-book and unknown rows | Flagged in a broad request only, as S3. Block `i6-a6`; shots `06-flags-broad-A6`, `06-flags-listed-A6` |
| A-7 | Permission window, Details | "Details · any contract" opened; listed and any-contract scopes mixed | One "Any contract" row, marked in each column its scope feeds; the label reads "any contract" whenever it exists. Block `i6-a7`; shots `06-details-any-A7`, `06-details-mixed-A7` |
| A-8 | Permission window, Details | A scope listing every function | "Any function". Block `i6-a8`; shot `06-any-function-A8` |
| A-10 | Permission window | Counts and plurals | "Details · 1 contract"; one unknown row for N types; "Already allowed · N" counts rows. Block `i6-a10`; shots `06-counts-A10`, `06-fold-count-A10` |
| A-11 | Permission window | The address row as the selection or the alias changes | Names the one shared account by its wallet name, never the alias typed; U2's sentence for two or more. Block `i6-a11`; shots `06-address-one-A11`, `06-address-renaming-A11`, `06-address-two-A11` |
| A-12 | Permission window | The "Already allowed" fold opened | Every held grant in its groups, read-only, each switch row on its stored line. Block `i6-a12`; shot `06-fold-open-A12` |
| A-13 | Permission window | The network banner when asking for more | "Allow as is, or switch to see X balances."; button unchanged. Block `i6-a13`; shot `06-banner-more-A13` |
| A-14 | Permission window | A chain with no name | Today's fallback, "Aztec:" and the chain id; "wants to connect on this network" when nothing resolves; asking for more with no name is "[string not decided]". Block `i6-a14`; shots `06-chain-fallback-A14`, `06-chain-none-A14`, `06-chain-more-A14` |
| A-15 | Settings → Connected apps → app | A broad app; an app with no transaction or simulation scope | Broad: flag and S3 lines, still a switch; no scope: no switch, the off line (A-2). Block `i6-a15`; shots `06-settings-broad-A15`, `06-settings-no-scope-A15` |
| A-17 | Permission window | Icons for the row list's new rows | `add_circle`, `info`, `mail_lock`. Block `i6-a17`; shot `06-icons-A17` |
| A-18 | Permission window | Dotted terms with two shared accounts | One rename link per shared account; the rule read as two distinct terms. Block `i6-a18`; shot `06-dotted-count-A18` |
| A-23 | Permission window, Details | The copy glyph's behaviour | A "Copy address" button off the Tab path; it never opens the row; snackbar "Address is copied". Block `i6-a23`; shot `06-copy-tab-A23` |
| A-24 | Permission window | Utilities alone on any contract | "Run simulations on any contract" with its chip; authorizations follow transactions and simulated transactions. Block `i6-a24`; shot `06-utilities-any-A24` |
| A-25 | Permission window | Several accounts, none selected | U2's sentence. Block `i6-a25`; shot `06-none-selected-A25` |
| A-26 | Permission window | A locked SHARED account row | No rename link. Block `i6-a26`; shot `06-shared-row-A26` |
| A-27 | Permission window, Details | Rows spoken by a screen reader | "{name or address}: {columns}"; the spoken address form is "[string not decided]". Block `i6-a27`; shot `06-spoken-rows-A27` |
| A-28 | Settings → Connected apps → app | A failed switch write | The switch reverts; error snackbar "Couldn't save this setting". Block `i6-a28`; shot `06-settings-error-A28` |
| A-29 | Permission window | The two new "any contract" rows | Chip and orange icon, as S3's simulation row. Block `i6-a29`; shot `06-any-flag-A29` |
| A-30 | Permission window | A declined widening of a held permission | Off keeps the held grant; data rows decide one by one, per the block's two tables. Block `i6-a30`; shots `06-declined-A30`, `06-declined-both-A30`, `06-declined-table-A30` |
| A-31 | Permission window | Adding accounts to an app that holds authorizations | Only the accounts rows are new; authorizations fold; label "Accounts to share"; arc 5a keeps today's window. Block `i6-a31`; shots `06-adding-A31`, `06-adding-interim-A31` |
| A-32 | Permission window | A `data` re-request after a declined widening | The badge on the new rows only; a covered request opens no window; contract classes still reopen it. Block `i6-a32`; shots `06-asked-again-A32`, `06-no-window-A32` |
