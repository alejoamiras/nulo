# Phase 2 · The row table, the popup's grant, the interim window

Built on `3248a3db` (P1 done). This phase changes the capabilities window (A-1).

Round-5 picks for item 6 signed off by the owner in chat, 2026-09-25: "Regarding 6: Recommended." (the picks store is unreadable from this account, so the chat answer is the record).

## What was built, per commit

| Commit | Step | What |
|---|---|---|
| `eadcda57` | P2.1 | `permission-rows.ts`: every U4 row (group, icon, title, the line or the on and off lines, the switch name, the "Any contract" chip, the flag rule), plus the defaults read through the wallet-bridge predicates. 22 tests, each row pinned cell by cell to the design's row list. |
| `5dd139f7` | P2.2–P2.4 | `build-items.ts` rewritten around `buildCapabilityItems(params)` and `buildGrant(input)`. `CapabilityCard.vue` gets the switch control and `data-cap-row`. `index.vue` builds from the dispatch snapshot and sends the switch's value. `AUTHWIT_RIDER_INFO` and its doc are removed, and the workflow comments in `capability-meta.ts` and `index.vue` are rewritten (§ Comments). 29 builder tests, 7 new card tests, 10 new window tests. |

## Red first

| Commit | Red run | Then |
|---|---|---|
| `eadcda57` | The module did not exist | 22 passed |
| `5dd139f7` | `build-items.test.ts` against `HEAD`'s builder: 29 failed of 29. The WIP was copied to the scratchpad, `HEAD`'s file was written in its place, the run made, and the WIP copied back. `cmp` confirmed it was identical | 29 passed |

The new window and card tests have no separate red run. They look for `data-cap-row`, the
switch's `role` and the new strings, and none of those exist before this commit.

## Failed attempts and why

- **The worktree guard refused commands.** It refused a Python heredoc containing backticks, lines with shell
  variables, a `git show … && cp … && bun …` chain, and a `cat >> file <<EOF`. Source edits
  went through Edit, and each command ran as one plain command with literal paths.
- **`toMatchObject({ switchLabel: undefined })` fails when the key is absent.** Fixed with a
  separate `toBeUndefined()`.
- **One window test expected the row key `accounts`.** The held accounts card's key is
  `account-address`, the U4 row it becomes in 5b. Fixed in the test.
- **Biome formatting**, fixed with `biome check --write`.

## Decisions

- **The row strings are literals in the tests.** The design's `text.json` is gitignored build
  output (`design/mocks/dist/`), so a test cannot read it. A script checked every row-list
  string in the tests against it; all matched.
- **`buildGrant` never echoes an existing grant of a type the request asks for.** An echo counts
  as approving (`dispatcher.ts`, `deltaApprovedTypes`), so a rejected `data` row would not register.
  The echo list is `existingGrants` minus the delta's types.
- **`data` is rebuilt field by field.** A new row that is On takes the requested field. A row that is Off,
  or a field the held record already gives, keeps the held field. With every new row Off, the type
  is left out, which rejects it. That enforces P1's note (8), the rule that the window never
  sends a `data` cap with neither field. The builder test "a first data grant with both rows
  Off is rejected" and the window test "data: both rows Off never sends a data grant" cover it.
- **`authorizationsWithoutAsking` is sent only when the switch was shown.** It is never sent on
  a membership-only widening (A-31) or with no transaction or simulation scope (A-2).
- **A-5's card comes first among the new cards,** Off, with the broad lines. Its detail panel shows
  the held accounts grant. It sends the switch's value although accounts are not in the delta,
  which P1's `requiredGrants` expects.
- **A-2 in 5a:** the authorizations card sits among the new cards, with no switch and the off
  line. No drawing shows 5a's A-2 state. This follows A-1's rule: every card without a switch
  keeps its place.
- **The 5a switch has no custom focus ring.** A-19's ring belongs to `PermissionRow` and
  Settings. The browser default applies.
- **Each data card's detail panel is today's panel over its half.** The address-book half still
  lists "Register senders", as today's panel does for any `data` cap.
- `isBroadRequest` is exported for 5b's flags: `coversAnyContract`, or a simulation sub-scope
  that reaches any contract. P6 decides whether that is the S3 trigger (see below).

## Plan text and drawings that proved wrong, ambiguous or undrawn

- **Owner question: two or more unknown types in 5a.** A-10 and the plan
  (`plan.md:268-269,1476-1477`, "the unknown switch all or none") make every unknown type one card with one
  switch, and the testid table (`plan.md:816`) gives that card `data-cap-row="unknown"` and no
  `data-cap-id`. The 5a drawing (`gen_r5.py:722`, "Unknown: today's card, unchanged") shows only
  one type. So with two or more types, 5a shows one card with today's singular words: "Unknown permission" and "This wallet
  doesn't recognize this permission." (`build-items.ts`, `unknownItem`). Its detail panel lists
  each type. No drawing or plan text gives the plural words for 5a. U4's "Use N permissions
  Nulo doesn't recognize" arrives in 5b.
- **Discrepancy: A-31's 5a drawing leaves out "Account access".** The drawing
  (`gen_r5.py:1237-1240`) lists the authorizations card, Contracts, Simulation and Transactions
  under "Already granted". Its caption (`:1244`) says "Arc 5a keeps today's window here", and
  A-1 says "every other type's 'Already granted' card still comes from `existingGrants`, as
  today" (`plan.md:205-207`). Today's window draws the held accounts grant too. Built per the
  plan text, so 5a draws "Account access" in that list. A-1H's drawing (`gen_r5.py:733-735`) draws
  it too.
- **An unknown card with no `data-cap-id`.** Following the testid table, the single-type
  unknown card now has no `data-cap-id`, where today's card carried the type. P4 greps the e2e
  tree for any spec that selects an unknown card by id.
- **`contractsRow` with neither `canRegister` nor `canGetMetadata` returns `undefined`.** U4 draws
  no row for that shape. In 5a the card is today's "Contract registration" card. 5b must decide.

## Gate

All three were run from the worktree root on `5dd139f7`.

| Command | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | 29 warnings and 3 infos, all pre-existing (the same count as P1). `complexity-baseline check OK`, and no suppression was added |
| `bun run typecheck:all` | 0 | 15 workspaces exited 0 |
| `bun run test:all` | 0 | First run, with no reruns. extension: 7620 passed, 4 skipped, 7 todo. wallet-bridge: 406 passed. Every other workspace green |
