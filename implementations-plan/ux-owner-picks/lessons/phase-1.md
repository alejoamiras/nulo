# Phase 1 · Compact amounts (D1)

Built first under O1 (b), the incoming row only, while O1 was unanswered. The owner then picked
O1 (a) (2026-09-28); its build is § O1 (a) at the end.

## Red first

The boundary table (`amount.test.ts`, 18 rows at length 8) and the two row cases
(`TransactionIncomingCard.test.ts`) ran on the unfixed code:

- 14 table rows red, every one receiving today's cut: `expected '123,456,' to be '123.45M'`.
- The four rows marked "passes today" green: whole part fits exactly, zero, the hint, one base unit
  at decimals 0.
- Both row cases red: `+123,456,` for `+123.45M`, `+999,999.` for `+999,999`.
- The dApp-mint guard (`TransactionCard.test.ts`, the amount `0x` plus 64 hex digits) green, as the
  plan expects: it holds today and only proves something under O1 (a).

## Built

- `balanceFormatted` takes `opts: { compact?: boolean } = {}`; past the cap it calls `compactCut`
  when `compact` is set, otherwise slices as before. Its TSDoc went from 17 lines to 8.
- `compactCut` is the plan's `compactWhole` plus the fits-and-trim branch, in one private helper,
  so `balanceFormatted` gains a ternary instead of two branches. It trims only the decimal
  separator: while the whole part fits, the cut contains all of it, so the one separator it can end
  on is the decimal one. The plan's "decimal or thousands" has no reachable thousands case.
- Only `TransactionIncomingCard.vue` passes `{ compact: true }`; its `receivedLabel` doc lost the
  "(D5-D)" tag.
- The table pins every row's locale (en-US by default) by stubbing the two probes the separators
  are read from, `(1.1)` and `(1111)`, so it does not depend on the runner's locale; each row also
  asserts today's plain cut and that `slashed` is set exactly when the value shown is not the full
  one.

## Gotchas

- A ` ` typed into a tool's JSON parameter lands in the file as the literal character, which
  reads as a space. Restored as the escape with `perl -CSD -pi -e 's/\x{202f}/\\u202f/g'`.
- `satisfies` on a `test.each` array literal does not carry the `Locale` union into the callback
  (`TS2345` under `typecheck:all`); a typed `Row[]` constant does.
- `agent-worktree status` fails for this worktree (no manifest row, see phase 0).

## Gate

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 29 warnings, 3 infos, all pre-existing (none in the touched files) |
| `bun run typecheck:all` | 0 | |
| `bun --bun vitest run` the four P1 files (from `apps/extension`) | 0 | 4 files, 126 passed |
| `bun run test:all` | 0 | extension 7805 passed, 4 skipped, 8 todo; every workspace exit 0 |

## O1 (a)

The owner picked O1 (a) on the decision page (2026-09-28): the option at the eleven other
known-token calls, none at the six that guess decimals.

### Red first

- The call sites, before the option was added (3 failed, 128 passed):
  - `amount.callers.test.ts` (new) found every one of the eleven calls plain;
  - the snack: `expected '123,456.' to be '123,456'`;
  - Home's token row (`TokenCard.test.ts`, 123,456,789.12 private and 1,234.5 public):
    `'…123,458,02 123,45  1,234.'` for `123.45M`, `123.4M` and `1,234`.
- The width table (lengths 6, 10 and 20) already runs against P1's `compactCut`, so its red run
  used the base commit's `amount.ts`, copied in from `git show` and copied back after: 12 red,
  each receiving today's cut (`expected '100,00' to be '100K'`,
  `expected '1,000,000,000,000,00' to be '>999T'`); the two rows marked "passes today" green
  (99,999 at 6, one base unit at 6).

### Built

- `{ compact: true }` at `journal-state.ts:327`, `RecentActivityView.vue:191` and `:376`,
  `journal/[id].vue:98`, `snack-amount.ts:10`, `BalanceView.vue:73`, `:78` and `:82`,
  `TokenCard.vue:38`, `:51` and `:52`. The six guessing calls (`TransactionCard.vue` twice,
  `tx/[id].vue` twice, `received/[id].vue`, `IncomingTrustPopup.vue`) are unchanged.
- `formatSnackAmount`'s doc says what it prints now: the 8-character form while it spells every
  whole digit, otherwise the full amount, never the K/M/B/T form (its `startsWith(whole)` test is
  false for that form, so it falls through to the full amount unchanged).
- `amount.callers.test.ts` pins each file's count of compact and plain calls, so a new call fails
  until someone picks its kind. It reads each call's arguments up to the closing parenthesis: the
  first draft read line by line, which counts a call Biome splits over lines as plain
  (`[0,1]` for a split compact call), so a guessing call given the option on its own line would
  have passed. A mention on a comment line is not a call.
- `amount.test.ts`: the plan's 6, 10 and 20 table, 14 rows, each also asserting today's plain cut
  and that `slashed` is set exactly when the value shown is not the full one.
- No existing test pinned the old cut at these callers; none changed.

### Gotchas

- `test:all` failed once on `content-message-relay.test.ts` (2 tests: a 5 s timeout on its dynamic
  import, then the next test seeing the timed-out import's listener), a file this branch does not
  touch, at load average 148. Alone it passed 7 of 7; the rerun of `test:all` exited 0.

### Gate

| Command | Exit | Counts |
|---|---|---|
| `bun run lint` | 0 | 29 warnings, 3 infos, the same as before (none in the touched files) |
| `bun run typecheck:all` | 0 | |
| `bun --bun vitest run` the four P1 files and the touched callers' tests (from `apps/extension`) | 0 | 9 files, 309 passed |
| `bun run test:all` | 1, then 0 | the relay flake above; then extension 7878 passed, 4 skipped, 8 todo, every workspace exit 0 (run on the line-by-line scan; the 9-file run above is on the final one, and P5 reruns `test:all`) |
