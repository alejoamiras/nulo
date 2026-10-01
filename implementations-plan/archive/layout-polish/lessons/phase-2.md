# Phase 2 · Build the recommended layout

## What was built

- **L1**: Home's and the token page's list gap 4px → 10px (`RecentActivityView.vue` `.list`);
  History's per-date `Flex` gap 4 → 10 and the date row's `padding-bottom` 8px → 2px
  (`TransactionsList.vue`), so the heading keeps its 12px; the two narrating comments are gone.
- **L2**: `apps/extension/src/popup/pages/tab-hero.module.css` holds the bar, the label and the
  hero; `activity.vue` and `settings/index.vue` compose each class from it and keep their
  `.wrapper`, `.content` and observer. The wrapper is a zero-height sticky block with the plan's
  one comment; the label is a full-width block that carries the `12px 24px` padding and the page
  background; the hero is `10px 24px 28px`.
- **L3 as O1 (a)**: both header branches render `SectionLabel` "Recent activity" (imported from
  `@nulo/design`, as `TokensView.vue` does), the link reads "View all" with
  `data-testid="activity-view-all"`, `.header_title` is gone, the `TokensView.vue` comment that
  quoted the old label is gone, and `ARCHITECTURE.md` says "Home's Recent activity".
- **L7 as O5 (b)**: `usePrices` exposes `settled` (read-only), set by the first refresh result or
  rejection or by a broadcast. `BalanceView.vue`'s pending condition adds `awaitingQuotes`: fiat
  on, not settled, and an in-scope holding with a string contract, a non-zero balance and a
  price-map entry, all under the existing 12 s cap. `getPriceMapEntry` is imported from
  `price-map.ts`, as `usePrices` does: `BalanceView.test.ts` mocks the price client module whole,
  so the client's re-export would be undefined there.

## The measured result (both browsers, to the pixel)

- Rows: every row 59.0px; gaps 10.0 on Home, the token page and History, dark and light;
  History's date label to its first row 12.0; containment green everywhere. P1 read 4.0.
- Titles: the hero title 10px below its page's top on History and Settings (P1: 41); hero
  `padding-bottom` 28px (P1: 32px). The painted bar is the label's box `[top 0 from the page,
  41 × 360]`, the same box P1 recorded for today's painted parent, and its parent is 0 tall. At the
  top and back at the top all five points meet the hero; scrolled to the end the bar's shown
  opacity is 1 and all five points meet it.
- A click 2px under the shown bar now meets `setting-nav-networks` and opens
  `#/popup/settings/networks` (P1: it met the bar's own bottom padding and stayed on Settings).
- The Tab lap from Settings' first row is the same list as P1's on each browser: the logged lap
  lines are byte-identical to P1's (Chrome's 23 stops, Firefox's 24, which ends back on
  `settings-page`).

## A flake in P1's new rows case, root-caused and fixed

The first full Chrome smoke (at `f030f9a3`, retries on) passed the rows case on its second try.
The first try logged "History: date label to first row undefined", and the retry's first History
read three rows while `settledRows(page, 4)` had just returned.

Cause: `navigateByHash` returns when the hash changes, and the router swaps the page later (after
its guards). `settledRows` counts every row on screen, so the old page's four rows, holding still
for two 100 ms polls, passed for the new page's. A scratch probe (not committed) with the popup's
CPU throttled 6x: after the hash, two polls saw "4 rows, 4 old", the next "3 rows, 0 old" (History
before its receipt row), and the old rows were gone 850 to 1,050 ms after the hash.

Fix (`3f433fb6`): the rows case opens each surface through `openSurface`, which waits for the rows
it saw to leave the page; the titles case waits for the hero title inside the destination's own
wrapper (History's `activity-feed-root` also exists on Home). Both cases then ran green at retry 0
on both browsers, with the same numbers.

## Gate

| Command | Result |
|---|---|
| `bun run --cwd apps/extension test` (the three P1 files) | exit 0: 93 passed (P1: 5 failed, 88 passed) |
| `bun run lint` | exit 0 |
| `bun run typecheck:all` | exit 0 |
| `bun run test:all` | exit 0: extension 8028 passed, 4 skipped, 8 todo; aztec-runtime 250 passed, 2 skipped; wallet-bridge 481; design 401; wallet-core 247; extension-messaging 239; wallet-crypto 120; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 5 passed, 6 skipped |
| `bun run test:ci-gating` | exit 0: 244 passed, 2 skipped |
| smoke, Chrome, three shards, at `f030f9a3` | exit 0 ×3: 38 files passed, 3 skipped; 159 tests passed, 7 skipped; one retry, the rows case above |
| rows + navigation, retry 0, at `3f433fb6` | Chrome 11/11, Firefox 11/11 |
| smoke, Firefox, three shards, at `3f433fb6` | exit 0 ×3: 39 files passed, 2 skipped; 155 tests passed, 11 skipped; no retry |
| `bun run --cwd apps/extension build-storybook` | exit 0 |
| `e2e:agent` incoming-arrival + fiat-send, Chrome (`NULO_E2E_PROVERLESS=1`) | exit 0: 2 files, 8 tests passed, no retry |
| `bun run build` | exit 0 |
| `bun run e2e:reap` | exit 0: nothing left to reap |

`fiat-display.test.ts` (its empty-wallet case included) passed in both smoke runs.

The first `e2e:agent` call exited 2 before building: `incoming-arrival.test.ts` is gated on the
proverless build, and the runner asks for `NULO_E2E_PROVERLESS=1`. The run above sets it.

## Harness notes

- This agent's harness refuses any git or install command aimed at another worktree, so the extra
  worktrees the build protocol allows for sharding could not be used: every run here shares the
  one worktree, one at a time where the rules require it (never a smoke and a network run
  together).
