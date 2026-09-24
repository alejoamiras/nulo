# Phase 6 · The owner's parity answers

The parity page left three differences for the owner. Asked in chat on 2026-09-24:

| Parity row | Question | Owner's answer |
|---|---|---|
| 5 | The dApp window's app-set row keeps "Pay fee with" | "Rename to "Fee" (Recommended)" |
| — | The embedded banner says "Pay fee with" too | "Rename both to "Fee" (Recommended)" |
| 9 | The review sheet's fee line has no dollars | "Add dollars" |
| 10 | A hand-added contract reads "paid by the sponsor" in the sheet | "Align with U16 (Recommended)" |

## Decisions

1. **One formatter for the card and the sheet.** `feeDisplay` (amount and dollars from the
   estimate and the live Fee Juice quote) moved out of `FeeSettingsCard` into `fee-helpers.ts`;
   `feeLine` joins it into the sheet's string. The owner asked for the card's formatting, so the
   sheet cannot compute its own.
2. **The sheet's hand-added line reuses U16's sentence**, now `UNVOUCHED_FEE_SENTENCE` in
   `publish-facts.ts`, which `FeeCostReadout` also reads, so the card and the sheet cannot say
   different things. `.visually_hidden` moved to `fee-shared.module.css` for the same reason.
3. **Row 17 follows U16.** The owner aligned the sheet with U16, which is still sign-off pending;
   a different U16 pick changes both.
4. **No page-level test for the dollars.** The page's line is one call to the two tested helpers
   the card uses. Driving it through `send.integration.test.ts` would need a debounced estimate
   and a fresh quote through the mocked price client; P7's parity capture of row 9 shows the
   result on the built extension instead.

## Gate

On the arc rebased onto dev `9f11de70`, with the two P6 code commits:

- `bun run lint` exit 0 (29 warnings, 3 infos, as before; none in changed lines).
- `bun run typecheck:all` exit 0.
- `bun run test:all` exit 0 (extension 7,133 passed, 4 skipped, 7 todo; two more than before:
  the helper's two cases, and the sheet's hand-added case in place of its table row).
