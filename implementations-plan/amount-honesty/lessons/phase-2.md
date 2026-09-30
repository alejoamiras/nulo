# Phase 2 · The field never changes a magnitude unseen

## Red run on the unfixed code (`bd37f0ba`, the P1 head, whose field code is the base's)

`bun --bun vitest run src/utils/amount.test.ts src/popup/pages/send-amount.test.ts
src/components/composite/send/amount-field.test.ts src/components/composite/send/AmountCard.test.ts`:
exit 1. The first run's card file failed to collect (a `%j` title over a bigint); with the title
fixed, the card file alone: exit 1, 19 failed, 53 passed.

`readAmountText` (40 rows) and `nextAmountText` (15 rows) are new: every row fails as "not a
function", and the surface cases below are their red proof.

| Case | Label | Base shows |
|---|---|---|
| Validator "1,5" at 6 decimals | red | 15 (15000000n) |
| Validator "1,000", no rest | red | 1000 |
| Validator "1,234" | red | 1234 |
| Validator "12,34.5" | red | 1234.5 |
| Validator "1,000" at rest "1,000"; "1,000,000"; "123,456,789.5"; "1.234,5,"; "1.234" | pin | as expected |
| Harness "1.234,5678901" at 6 rests "1,234.56789", sends 1234.567890 | red | "1.234567" |
| Harness "1.234,5,678901" at 6 stays, sends nothing | red | "1.234567", sends 1.234567 |
| Harness, the seven other rows | pin | as expected |
| Page-bound: typed "1,234.56" shows "1.", "1.234", "1234.", "1234.56" | red | "1" after "1," |
| Page-bound: typed "1,234" reads 1.234 | red | "1234" |
| Page-bound: "12" left, ",5" typed → "12.5" | red | "125" |
| Page-bound: rest "1,234" + "," → "1234." | red | "1234" |
| Page-bound: rest "1,234" + "5" → "12345" | pin | as expected |
| Page-bound: rest "1,234", "1,234" pasted → held | red | no hint, sends 1234 |
| Page-bound: Max at 1,234 tokens sends 1234 with no blur | pin | as expected |
| Page-bound: Max, Backspace to empty, "1,234" pasted → held | red | no hint, sends 1234 |
| Page-bound: the three comma-point lifecycles | red | "1234" where "1.234" is typed |
| Card: F-1 paste "1.234,5678901" at 6 → "1234.567890" + clamp hint | red | "1.234567" |
| Card: typed "1,234,567" → "1.234567"; typed "1,234" → "1.234" | red | "1234567", "1234" |
| Card: one-event "1.234,5,678901" hints only once left | red | purged to "1.2345678901" |
| Card: paste "1.234,56" kept, rests "1,234.56" with the rest set | red | "1.23456" |
| Card: paste "1e5" unreadable hint, unit rate only | red | no hint |
| Card: paste "1,234" ambiguous hint naming 1234 and 1.234 | red | no hint |
| Card: paste then a 2-decimal token, "1e5" / "1.234,567" / "1.234,56" | red ×3 | "15" / "1.23" / "1.23" |
| Card: Max marks the rest; a paste clears it; a page write of null clears it | red ×3 | no `update:rested` |
| Card, USD: "1e5", "1,234" pasted write no token amount; "1.234,56" converts | red ×3 | 15, 1234, 1.23456 |
| Card, USD: "$12.50" and ".5" pasted convert | pin ×2 | as expected |
| Card, USD: "12,5" typed; "1,234" then "."; a replacing edit ends the comma point | red ×3 | "125"; "1234."; "1234" |
| Card: every existing case, the grouped re-clamp and the typed ".5" included | pin | as expected |

Two labels in the plan did not hold on the base, recorded as run rather than as written:

- The USD ".5" paste (plan: red) is a pin: the base's `purgeNumber` passes ".5" and its leading-dot
  fix makes it "0.5". The case stays as the guard G1 asked for: the new reader must not lose that
  fix.
- "1.234,56" at a 2-decimal token (plan: pin) is red: the base purges the paste to "1.23456" at
  once, so the token change clamps it to "1.23"; there is no kept text on the base to keep.

The e2e addition (step 6) ran red too: `NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_RETRY=0
bun run e2e:agent tests/e2e/network/send-amount-exact.test.ts` on Chrome, exit 1, 1 failed: every
earlier step passed, then `the amount field reads "15", not "1e5"` at the synthesized paste.
`bun run e2e:reap` after it: nothing left to reap.

## Build notes

- The keystroke path gives `normalizeAmount` only a text that stays plain (digits and one point).
  A kept text that reads with commas or point grouping would otherwise lose a character to its
  two-point rule, or be capped through `purgeNumber`'s comma-blind parse: "123456789012,5" plus a
  digit would have become "9999999999999". Plain text keeps the cap exactly as before.
- A second point is dropped as the inserted character (the text is the part before the edit and
  the part after it). At the end of the text that is today's last-character drop; mid-text it
  drops the point, not the text's last character.
- A read hint that already shows follows the current reason on a keystroke, so its copy always
  names the text in the field; otherwise a keystroke shows none until the blur. The clamp hint
  keeps its old lifecycle in `wasClamped`; the read hints render first in the slot, because the
  clamp hint can outlive a switch to USD while a read hint never outlives its text. Max, the USD
  Max, a mode switch and a page write clear the read hint.
- `rested` is read from `defineModel` itself: the page's copy once it re-renders, and each edit,
  blur and press is its own task, so no handler reads it stale.
- The comma-point lifecycle case types the first "." where the deleted point was and the second
  at the end: a flag that outlived its point would then re-read "1.234" into "1234.", while two
  points typed at the end cannot tell the designs apart.
- The e2e case joins the file's one test, which mints into a file-scoped fixture, and the title
  names it.
- Beyond the plan's cases: the card's one-event text that reads no way hints only once the field
  is left (§ A2's hint rule), and the reader's thin-space row (U+2009, the fourth listed space).
- The tool-call layer turns `\u` escapes in edit parameters into the literal characters. The
  reader's space class is written by a script with the escapes spelled out; the plan's hostile
  symbol line and the phase 1 note, which had carried a literal bidi override, now name the
  characters instead.
- `bun run build` regenerated `src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json` for
  `readAmountText` and `AmountRead`; they are committed with the phase.

## Gate

- `bun --bun vitest run src/utils/amount.test.ts src/popup/pages/send-amount.test.ts
  src/components/composite/send/amount-field.test.ts src/components/composite/send/AmountCard.test.ts
  src/popup/pages/send.test.ts src/popup/pages/send.integration.test.ts`: exit 0, 6 files, 397 passed.
- `bun run lint`: exit 0, 28 warnings and 3 infos (the base's own), complexity-baseline check OK.
- `bun run typecheck:all`: exit 0, every workspace.
- `bun run build`: exit 0.
- `git status --porcelain apps/extension/src/types` after the commit: empty.
