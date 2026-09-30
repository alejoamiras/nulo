# P12 · A-4 and Max, as delegated

LESSONS_FILE=implementations-plan/send-amount-exact/lessons/phase-12.md

## The A-4 captures (all three options, before the decision)

Each option was built on a local capture-only branch off `eb297329`, never pushed:
`capture/send-amount-exact-a4-2` (`4833145e`, `align-items: baseline` on the row) and
`capture/send-amount-exact-a4-3` (`da361f06`, `vertical-align: top` on the field); option 1 is
`eb297329` itself. A throwaway spec (never staged) shot five states per option on Chrome 152 and
Firefox 153, light theme, 360×600 at DPR 1, in the priced set's seeded state: 12.5 at rest,
18 decimals with focus, then at rest, the million-plus Max, the paste.

- The first take centred each frame on the field, which option 3 moves; all three were shot
  again centred on the row, which never moves. The offsets were the same to the pixel both times.
- Each frame was measured in the page: baselines from a zero-size marker (the field's read with it
  baseline-aligned, since `vertical-align` moves the box and never the text in it), ink tops from
  `measureText`. A pure-Python PNG decode checked every frame against its pixels: the first ink
  row is the measured top in all 30, the last one meets the measured baseline.
- Option 1's first-take frames 2 to 4 match `shots-priced-*` pixel for pixel over the amount row.

| State | Option 1 | Option 2 | Option 3 |
|---|---|---|---|
| 12.5 at rest | −28 / −6 | 0 / +22 | −28 / −6 |
| 18 decimals, focused | −28 / −6 | 0 / +22 | −28 / −6 |
| 18 decimals at rest (57%) | −28 / −20 | 0 / +8 | −11 / −3 |
| million-plus Max (42%) | −28 / −24 | 0 / +4 | −6 / −2 |
| the paste (56%) | −28 / −20 | 0 / +8 | −11 / −3 |

The switch's label less the amount, baseline / top, in px; negative is higher. Chrome and Firefox
agree in every frame. Also measured: option 2's switch box is 16 px tall instead of 53 (a
baseline-aligned flex item does not stretch); option 3 opens 34 px, then 39 px, between a shrunk
amount's baseline and the line under it, against 17; nothing below the row moves in any option.

## The decisions

Delegated by the owner and decided by the driver from a panel's verdicts (plan.md § Phase 0): A-4
option 2 with a full-height press area for the switch; Max leaves the field at rest.

## Build

- **Max.** Red, `AmountCard.test.ts`: a press on Max (the field blurred first, as a pointer press on
  a span blurs it) left the field focused: the card's `handleFocus` took it back. Fixed with
  `@click.stop` on Max and the resting form written in `handleMax`, a two-line handler change; 128
  of the send composite tests green.
- **The switch.** Red, Chrome, retry 0, with a4-2's `align-items: baseline` and no full height:
  `fiat-send` timed out waiting for the USD field after a press 1 px inside the row's top edge over
  the switch, which landed on the row and focused the token field instead. Fixed without the
  alignment: the switch holds the field's own strut, so its label sits on the amount's baseline and
  the row still stretches its box to 53 px. No second press element exists.
- **send-amount-exact's Max step** now presses Max as a pointer does. Its first red run failed for
  another reason, reproduced by a throwaway probe: while the destination holds the focus, its
  suggestion list open, the press's `mousedown` blurs it into the account card, Max moves 22 px
  down before the button comes up, `mouseup` lands on the amount field and the `click` on their
  common ancestor, so Max never runs; a second press works. It is dev's behaviour, found here and
  moved to `follow-ups.md`. The spec leaves the destination through the amount field first. Red
  again, as expected: the field read "1235567.123456789012345678", focused, not grouped.
- **Max, second red, from the e2e.** With the fix, the page read the typed amount after Max. The
  first fix wrote the model twice, plain then rested, reading `model.value` between; the page owns
  the model (`v-model`), so that read returned the page's old value until it re-rendered, and Max
  rewrote the typed amount. The unit test mounted with no `onUpdate:modelValue`, so `defineModel`
  kept local state and read back at once. Given a page-owned model (each update `setProps` back) it
  went red the same way, emitting the plain balance and then `""`; one write of the resting form
  fixed both. The repo already had the hazard's test, for a keystroke.

| Run | Browser | Result |
|---|---|---|
| red: `fiat-send` + `send-amount-exact` | Chrome | 2 failed: the switch press; Max's press lost (the probe's case) |
| red: `send-amount-exact` + the probe | Chrome | 1 failed (Max left focused, plain), the probe passed |
| green: `fiat-send` + `send-amount-exact` | Chrome | fiat-send passed; Max rewrote the typed amount (the double write) |
| green, one write: the same two | Chrome | 2 passed: `send-amount-exact` 35.7 s, `fiat-send` 29.9 s |
| the same two + `send-amount-clamp` | Firefox | 3 passed: 48.7 s, 37.3 s, 34.0 s |

Unit, after both fixes: 128 tests in `src/components/composite/send/`. Both commits signed:
`612b52df` (Max) and `8b7b68aa` (the switch), split from one working tree through a scratch copy
of the final file, the Max commit green on its own.
