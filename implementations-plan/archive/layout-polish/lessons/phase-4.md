# Phase 4 · Apply the answers and close

## Answers

Decided on 2026-09-29 by the panel the owner delegated to while away (the quote, the votes and
the dissent are in `plan.md` § P4): O1 (b), two to one; O2 (a), O3 (a), O4 (a), O5 (b) and the
blanket for B1 and B2, unanimous. Delegated decisions, overturnable by the owner.

## Step 1 · O1 (b)

- Red first: P1's header case now expects "View history". On the branch before the change,
  `bun --bun vitest run src/popup/components/modules/general/RecentActivityView.test.ts -t "its
  header"` exited 1: `expected 'View all' to be 'View history'`.
- `RecentActivityView.vue`'s link reads "View history" (`1ec3747a`); its testid stays
  `activity-view-all`, an identifier P1's record names. The whole file: 34 passed.
- No story, e2e or other string names the link's words. The other answers are P2's build.

## Step 2 · follow-ups

`implementations-plan/follow-ups.md`: the "Layout around batch 4's surfaces" entry is gone. A
`## Layout` section holds this plan's two open items (the mouse-only view links, Fact 14; Home's
section header against the drawing, Fact 13) and three of the panel's: History filtered to a
token's page, the view links' contrast (both links 2.1:1 dark and 1.6:1 light on
`--nulo-outline`, computed from `packages/design/src/base.css`), and the compact bar's title
read twice by screen readers, which predates this plan. The panel's fourth, a failed first price
fetch ending in "$0.00" on a funded wallet, sits in § Amounts, sends and fees as the owner's call.

`implementations-plan/lessons.md` gains one line in § E2E (`navigateByHash` returns before the
router swaps the page) and shrinks from 7934 to 7917 bytes: the held-key and the timed-tests
entries say the same in fewer words.

## Step 3 · the flake bar

`NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e --retry=0
tests/e2e/rows.test.ts tests/e2e/navigation.test.ts`, three consecutive runs per browser:

- at `311e750f`, before the codex loop: Chrome 3 of 3, Firefox 3 of 3, 11 passed in each run;
- at `c349e82f`, after the merge of `dev`: the same;
- at `6e880e8c`, the final gate, with O1 (b) built: the same, 11 passed in each run, every row
  59.0px and 10.0 apart. Settings' Tab lap is byte-identical to P1's on each browser.

## Dev moved

`4387b112` (keyboard guards) landed on `dev` during the build. Merged with a signed merge commit,
`c349e82f`. `implementations-plan/index.md` conflicted on adjacent lines: both kept.
`follow-ups.md` merged cleanly; read after the merge, dev's four new entries and its two removals
stand beside this plan's change, with nothing contradicting.

## The final gate, at `6e880e8c`

O1 (b) built and the closing record in the tree; `c349e82f` gave the same results and counts.

| Command | Result |
|---|---|
| `bun run lint` | exit 0 |
| `bun run typecheck:all` | exit 0 |
| `bun run test:all` | exit 0: extension 8049 passed, 4 skipped, 8 todo; wallet-bridge 481; design 402; aztec-runtime 250 passed, 2 skipped; wallet-core 247; extension-messaging 239; wallet-crypto 120; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 5 passed, 6 skipped |
| `bun run test:ci-gating` | exit 0: 244 passed, 2 skipped |
| `bun run --cwd apps/extension build-storybook` | exit 0 |
| `bun run build` | exit 0 |
| smoke, Chrome, three shards | exit 0 ×3: 39 files passed, 3 skipped; 161 tests passed, 7 skipped; no retry |
| smoke, Firefox, three shards | exit 0 ×3: 40 files passed, 2 skipped; 157 tests passed, 11 skipped; no retry |
| the flake bar | 3 of 3 per browser, 11 passed each |
| `e2e:agent` incoming-arrival + fiat-send, Chrome (`NULO_E2E_PROVERLESS=1`) | exit 0: 2 files, 8 tests passed |
| `bun run e2e:reap` | exit 0: nothing left to reap |

The counts rise from P2's with `4387b112`'s tests (its `keyboard-guards.test.ts` in the smoke
suite, 21 unit cases in the extension, one in design). The later commit touches only
`implementations-plan/`; the plans gate and lint ran again on it.

## Captures of O1 (b) as built

From the final gate's armed builds, with the phase-3 spec: Home and the token page, Chrome dark
and light and Firefox dark, each reading "RECENT ACTIVITY" and "VIEW HISTORY" on screen
(`o1-b-built-{home,token}-{chrome-dark,chrome-light,firefox-dark}.png` in the scratch dir's
`captures/`, listed in its `index.md`). The decision page is the driver's to update.
