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

## The owner's O1 note: both heroes shrink to fit

The sign-off page's O1 answer (2026-09-29) was "change", about the two heroes' CSS ellipsis
(`124,458,788....` on the token page, `$124,458,78…` on Home). Asked which fix, the owner picked
"Shrink to fit (Recommended)": the type shrinks until every digit fits, down to about 60%, and only
past that does D1's rule shorten the figure. The rest of O1 stays as built.

### Red first

- `hero-fit.test.ts` (12 cases) failed to import: the module did not exist.
- Four new cases in `BalanceView.test.ts` ran on the unfixed component: 4 failed, 38 passed. The
  figure was a bare text node with no scaled span (`expected 'AAA' to be '1,250 AAA'`) and carried
  no scale (`expected '' to be '0.74'`).
- A first run also failed two existing arrival cases: the new first case's spy on
  `requestAnimationFrame` outlived it and stood in for the fake timers' frame. The describe now
  restores its spies after each case.
- Probe (the component copied aside and restored from the copy): with the hold disabled, the count
  case reads the scales `0.82, 0.9, 0.8, 0.85, …` against `0.8`. The case proves the hold.

### Built

- `hero-fit.ts`, pure:
  - `fitHero` takes the first form that fits at 60% or more, at the largest hundredth. The ruler
    checks the width at that size, because glyph advances need not scale linearly.
  - When no form fits at 60%, the shortest form takes whatever size fits. Only a symbol too long
    for the line can cause that (symbols run to 32 characters).
  - `tokenHeroCandidates` applies D1's compact rule at each shorter length. It stops at three
    characters when the whole part is under a thousand, where a shorter cut would read "0K" or "0".
  - `fiatHeroCandidates` gives the figure, its whole dollars, then those dollars in K/M/B/T,
    truncated. The dollars come from the rounded cents shown ($999.995 shows as $1,000.00, so its
    dollars read $1,000).
- `hero-ruler.ts`: the two layout reads, which the component test mocks with a stand-in font.
- `BalanceView.vue`:
  - A hidden ruler holds every form at the full size, in a 0×0 clipped box, so it never widens the
    page.
  - The figure is a span at `calc(1em * var(--hero-scale))` inside the 48 px line, which keeps
    today's height, so nothing below the hero moves.
  - The symbol is `0.5em`, 24 px at the full size. `text-overflow: ellipsis` is gone.
  - It fits on mount, after each render that changes the forms or the symbol (`flush: "post"`, so
    before the paint), on a resize of the section and on a font load.
- The count hold. Space Grotesk's default figures are proportional: at weight 700 "1" is 452 units
  and "0" 648. A counting figure's width therefore changes every frame. While Home counts, and on
  the figure it lands on, the fit may shrink but not grow. The next figure fits afresh.
- `convert.ts` exports `usdMicroToCents`, the half-up rule `formatUsdMicro` already applied.

### Measured from the font file

- Widths at 48 px, weight 700, letter-spacing −0.04em, before kerning, against the popup's 312 px
  line:
  - "$124,458,788.90" is 356.6 px, so about 87.5%;
  - "124,458,788.9 TST" is 350.4 px, so about 89%.
- `line-height: normal` is (984 + 292) / 1000 = 1.276em, 61.2 px at 48 px.
- The file (`packages/design/src/fonts/SpaceGrotesk-latin.woff2`) carries `pnum` and `tnum` in
  GSUB and `kern` in GPOS. Tabular digits would hold a counting figure's width steady, but they
  change how every figure looks, which is the owner's call; the hold keeps today's digits.

### The owner's realism rule

The owner, 2026-09-29, relayed by the driver: "Don't even care with a balance of 10 trillion
tokens my friend. let's cover realistic scenarios lol." Applied here:

- The fiat hero's `>$999T` branch and its test are gone. Only a total past a thousand trillion
  dollars reached them.
- The component case for the 60% floor is a long 18-decimal fraction, 1,234.567890123456789, at the
  popup's 312 px, where the fraction cut kicks in (`1,234.56789012345 AAA` at 61% in the stand-in
  font). It replaced two cases that squeezed the line to 150 and 200 px. Red on the unfixed
  component like its siblings: the figure was a bare text node.
- Measured from the font file, the popup's 312 px line holds these at 60% or more, so realistic
  balances only ever shrink or lose fraction digits:
  - the full fiat figure up to about a trillion dollars (`$1,000,000,000,000.00` is 516.7 px, the
    widest digits);
  - a token's whole part plus " TST" past ten trillion tokens (`10,000,000,000,000` is 447.9 px).
  The compact forms stay in the lists as the rule's tail.
- The capture's fraction in the real font: the 20-character cut plus " TST" is about 547 px (57%)
  and the 19-character one about 520 px (59.9%, just under the floor), so the hero draws the
  18-character cut at about 63%.
- That estimate was wrong by a character. Both browsers drew the 19-character cut at 60%, 309.8 px
  of 312 on Chrome and 309.9 on Firefox (`phase-5.md` § The rebuilt heroes' gates). The drawn
  width is narrower than the estimate, which counts no kerning. Widths near the floor are read in
  a browser, not from the font file.
