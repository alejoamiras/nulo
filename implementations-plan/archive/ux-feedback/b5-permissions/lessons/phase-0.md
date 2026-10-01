# Phase 0 · The permission window's undrawn states, drawn

The plan's undrawn owner asks drawn into the proposal page as a round-5 addendum under item 6:
an intro block `i6-r5-add` ("Round 5 addendum"), then one block per ask, after the existing
round-5 blocks. Every drawn option is built from the existing helpers; every visible string is
the plan's, or today's product string with its `file:line` in a `gen_r5.py` comment.

## Asks drawn

Shots are in `design/mocks/dist/shots/` (gitignored). Every picker is new and page-unique
(`i6aN`: the letter ids run out after `i6k`), listed in `page.js` `ITEMS` (`ids` and `latest`)
so the `picks` db sync accepts them.

| Ask | Block | Shots | Picker | Options |
|---|---|---|---|---|
| A-1 | `i6-a1` | `06-interim-window-A1`, `06-interim-auth-off-A1`, `06-interim-auth-broad-A1`, `06-interim-auth-broad-on-A1`, `06-interim-data-A1`, `06-interim-data-off-A1`, `06-interim-unknown-A1`, `06-interim-held-A1` | `i6a1` | As drawn · Held half hidden · Groups in 5a · 5a with 5b · Other |
| A-2 | `i6-a2` | `06-no-scope-A2` | `i6a2` | As drawn · Other |
| A-4 | `i6-a4` | `06-denied-A4`, `06-denied-data-A4` | `i6a4` | As drawn · Drop it · Other |
| A-5 | `i6-a5` | `06-widen-any-A5`, `06-widen-listed-A5` | `i6a5` | As drawn · Row on every widening · Other |
| A-6 | `i6-a6` | `06-flags-broad-A6`, `06-flags-listed-A6` | `i6a6` | As drawn · Never flagged · Other |
| A-7 | `i6-a7` | `06-details-any-A7`, `06-details-mixed-A7` | `i6a7` | As drawn · Other |
| A-8 | `i6-a8` | `06-any-function-A8` | `i6a8` | As drawn · Other |
| A-10 | `i6-a10` | `06-counts-A10`, `06-fold-count-A10` | `i6a10` | As drawn · Other |
| A-11 | `i6-a11` | `06-address-one-A11`, `06-address-renaming-A11`, `06-address-two-A11` | `i6a11` | As drawn · Other |
| A-12 | `i6-a12` | `06-fold-open-A12` | `i6a12` | As drawn · Other |
| A-13 | `i6-a13` | `06-banner-more-A13` | `i6a13` | As drawn · Keep Connect as is · Other |
| A-14 | `i6-a14` | `06-chain-fallback-A14`, `06-chain-none-A14`, `06-chain-more-A14` | `i6a14` | As drawn · Other |
| A-15 | `i6-a15` | `06-settings-broad-A15`, `06-settings-no-scope-A15` | `i6a15` | As drawn · Other |
| A-17 | `i6-a17` | `06-icons-A17` | `i6a17` | As drawn · Other |
| A-18 | `i6-a18` | `06-dotted-count-A18` | `i6a18` | Two distinct terms · Two per screen · Other |
| A-23 | `i6-a23` | `06-copy-tab-A23` | `i6a23` | As drawn · Tab stop · Other |
| A-24 | `i6-a24` | `06-utilities-any-A24` | `i6a24` | As drawn · Other |
| A-25 | `i6-a25` | `06-none-selected-A25` | `i6a25` | As drawn · Other |
| A-26 | `i6-a26` | `06-shared-row-A26` | `i6a26` | As drawn · Other |
| A-27 | `i6-a27` | `06-spoken-rows-A27` | `i6a27` | As drawn · Other |
| A-28 | `i6-a28` | `06-settings-error-A28` | `i6a28` | As drawn · Other |
| A-29 | `i6-a29` | `06-any-flag-A29` | `i6a29` | Flag and chip · Chip alone · Other |
| A-30 | `i6-a30` | `06-declined-A30`, `06-declined-both-A30`, `06-declined-table-A30` | `i6a30` | As drawn · Off revokes · Other |
| A-31 | `i6-a31` | `06-adding-A31`, `06-adding-interim-A31` | `i6a31` | As drawn · Row with switch · Keep Add accounts label · Other |
| A-32 | `i6-a32` | `06-asked-again-A32`, `06-no-window-A32` | `i6a32` | As drawn · Today's rule · Other |

Alternatives drawn beside their recommendation (not shot): A-1 held half hidden, A-4 dropped,
A-5 row on every widening, A-6 never flagged, A-23 Tab stop (its Tab path), A-29 chip alone,
A-31 row with switch and today's label, A-32 today's rule. Named in notes only: A-1 "groups in
5a" and "5a with 5b", A-18 "two per screen", A-30 "Off revokes".

## Strings not decided

Drawn as a visible "[string not decided]":

- A-14: the action when asking for more on a chain with no name (the plan gives only "wants to
  connect on this network").
- A-27: the spoken form of an address in a Details row's name ("{name or address}: …").

## CSS additions

All in `mocks/src/nulo.css`, at the end:

- `.n-cap-labels`, `.n-cap-label.mono`: today's CapabilityCard badge row and unknown label
  (`CapabilityCard.vue:97-98`), which the round-1 replica never drew.
- `.n-cap.granted` and its head/label/desc rules: today's granted card (`CapabilityCard.vue:128-157,
  193-195`), for "Already granted".
- `.n-tline`, `.n-flag.quiet`: "previously denied" on a row's title line, wrapping with no indent
  (A-4). The first shot wrapped the badge 6px in; the flex-wrap line fixes it.

Tooling: `shots.mjs` moves the pointer to (0, 0) before each screenshot. The last unfold click
left it over the page and its hover tint landed in two shots.

## Commands

From the repo root:

- `python3 implementations-plan/ux-feedback/design/mocks/gen_r5.py` → exit 0. `src/r5/i3`, `i5`,
  `i8` and `tips` are byte-identical; the old `i6.html` is an exact prefix of the new one.
- `python3 implementations-plan/ux-feedback/design/mocks/build.py` → exit 0 (1716 KiB page).
- `node implementations-plan/ux-feedback/design/shots.mjs` → exit 0, "86/86 shots".

## Page checks

A throwaway Puppeteer probe, at 1400px and at 400px:

- 0 page errors, 0 console errors, 0 failed requests;
- `scrollWidth` 1400 at 1400 and 400 at 400: no horizontal scroll, and no addendum element past
  the viewport outside a `.scroll-x` wrapper;
- all 25 new pickers render once each, with legend, radios matching their options (64 radios in
  all) and the note field.

## Plan ambiguities, drawn one way

- A-1: the risk tags on the authorizations and data cards are drawn as today's (▲ HIGH); the
  data cards' detail panels are drawn closed; the held data card sits last in "Already granted",
  with its on line as its description.
- A-5, A-30: whether a held row that is also new (widened) also folds. Drawn per A-12, "every
  grant the app holds": the fold counts every held row, so A-30's second window reads 6.
- A-7: the plan does not place the "Any contract" row; drawn last, under no sub-header.
- A-15: the no-scope row is drawn under U7A's "If you allow, it can"; the window puts it under
  "Always asks you first".
- A-30: "shows in Details" — `data` feeds no Details column, so nothing changes there.
- A-23: the snackbar "Address is copied" is named, not drawn.
- Sample values: chain id 1337 (A-14), the alias "Trading" (A-11), `swap.example` (A-15).

## Publish

Republished to the proposal artifact as version 9, 2026-09-25. The first publish was refused
until the live version was read; the live page was the old build plus the page skeleton, and the
new build differs from it only by the addendum, its CSS and the `I6_ADD` pickers. The `picks`
db declaration was carried forward unchanged.
