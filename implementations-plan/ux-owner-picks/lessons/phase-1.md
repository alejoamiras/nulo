# Phase 1 · Compact amounts (D1)

Built under O1 (b), the incoming row only (O1 unanswered).

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
