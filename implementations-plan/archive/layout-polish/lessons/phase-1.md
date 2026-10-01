# Phase 1 · Red tests that measure today

Run on `85c4d20f`'s code plus the new testids (the phase's only markup change), smoke builds with
the gate's flags, retry 0.

## Unit (`bun run --cwd apps/extension test <the three files>`)

Exit 1: 5 failed, 88 passed, each red carrying today's value.

- `RecentActivityView.test.ts`, the header case: `expected 'RECENT TRANSACTIONSView Archives' to
  contain 'Recent activity'`.
- `usePrices.test.ts`, `settled`: `undefined is not an object (evaluating 'api.settled.value')`
  (the API does not exist yet).
- `BalanceView.test.ts`, a price-mapped holding with the first answer held, the failed first answer,
  and the 12 s cap with no answer: each `expected '$0.00' to be ''` (today the hero prints
  "$0.00" while the quotes are out).
- Pin, green: an empty wallet (no rows, and a zero-balance price-mapped row, which is what a fresh
  wallet with the testnet USDC seed holds) and an unpriced-only wallet never wait.

## E2E (`NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e --retry=0
tests/e2e/rows.test.ts tests/e2e/navigation.test.ts`)

Chrome and Firefox alike: exit 1, 2 failed, 9 passed (the 9 old cases). The numbers are the same
in both browsers to the pixel.

- **Rows** (Home, the token page, History; dark and light): every row 59.0px tall (all four are
  priced, so the "≈ $" line sets the height); gaps 4.0, 4.0, 4.0 on each surface → red against
  10 ± 0.5. History's date label to its first row: 12.0 (pin, green). Containment (pin, green on
  every surface, theme and browser): no descendant leaves its row, nothing outside the amount
  column enters it, no amount's text is wider than its box.
- **Which seeded field reaches the title line**: the title span is the token symbol ("USDC"); a
  dApp's name (`origin.name`, "Shielded Payroll Portal") is the line's second chip. At 360px the
  chips wrap inside themselves and the row stays 59px, as the amount column is taller.
- **Titles and the bar** (History and Settings): title top less its page's top 41 → red against
  10 ± 1 (Inference 1 confirmed: the bar's in-flow box is 12 + 17 + 12 = 41px, so the title sits
  31px below the drawn 10px); hero `padding-bottom` 32px → red against 28px.
- **Pins, green**: at the top and back at the top, none of the bar's five points (centre, 1px
  inside each edge) meets the bar: they pass through. Scrolled to the end, the bar's shown
  opacity (the product along its ancestors) is 1 and all five points meet it. One Tab lap from
  Settings' first row visits every `setting-nav-*` row in DOM order and never a `page-*` element:
  `setting-nav-profile → … → setting-nav-advanced → settings-page (the About link) → nav-general →
  nav-holdings → nav-activity → nav-settings → BODY → account-avatar-btn → account-selector →
  account-address-copy → network-button → header-lock`, Firefox adding its focusable scroller
  (`settings-page`) at the lap's end. P2 must print the same laps.
- **Today's painted bar** is the label's parent: `[top 0 from the page, 41 tall, 360 wide]`, the
  label inside it a text box 12px down (`62.6 × 17` on History, `71.5 × 17` on Settings). This is
  the box the label must take after P2.

## Where the red run departs from the plan's expected list, and why

- P1.4 names three checks as preservation pins, green today: "at the top the five points land on
  the hero", "scrolled to the end the label's top is the wrapper's top ± 1px and its width the
  wrapper's client width ± 1px", and "a click 2px below its bottom edge opens the row under it".
  With the testid on the painted child, as P1.4 says, none can be green today: the hero starts
  below today's in-flow bar (the points meet the page wrapper), and today's label is a text box
  inside the painted parent (top +12, 62-72px wide; 2px below it is still the bar's padding, so
  the click meets the bar and the hash stays `#/popup/settings`). They run as soft checks that
  fail today with those values; the preservation evidence is today's parent box beside P2's
  label box. What is green today is kept as the hard pins above (pass-through while hidden, all
  points owned while shown, the Tab lap).
- P1.4 reads "the label's computed opacity"; opacity is not inherited, so the label's own value is
  1 while its wrapper hides it. The case reads the product along the ancestors: what shows.
- Two testids beyond P1.4's four, by the testid rule: `activity-date-label` (History's heading,
  `TransactionsList.vue`) and `activity-amount-col` (the row's amount column,
  `TransactionCardLayout.vue`), which the clearance and containment probes read.
- The seeders moved from `rows.test.ts` to `tests/e2e/helpers/activity-seeds.ts`: History needs
  ten rows in `navigation.test.ts` to scroll its hero away. Both new cases take a fresh browser
  (`registeredExtensionPerTest`) because they seed a token row and a receipt.
- Inference 6 holds: a note receipt written to `nulo:core:incoming-transfers` with a token row
  under `nulo:core:tokens@1` reaches Home, the token page and History in the smoke build, priced.

## Attempts

1. First e2e run: the rows case timed out at `clickNavTab` from Appearance, which has no bottom
   nav; the surfaces are now opened by hash. The navigation case's Tab walk counted a wrapped
   second pass; the walk is now cut to one lap from the first row. Second run as above.

## Found, not fixed here

- The wide transfer (123,456,789.123456 USDC) renders "123,456," in its row: `TransactionCard`
  cuts the full string to 8 characters (`balanceFormatted(…, 8)`, not compact). A cut amount is a
  wrong-amount display, and `amount-honesty` owns it (its UI impact row 7, the compact form
  "123.45M"). Logged in the Decision ledger; no change here.
