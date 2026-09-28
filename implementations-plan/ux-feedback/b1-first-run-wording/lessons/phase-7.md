# Phase 7 · Arc gate on the final source

## First run, on `ad470e6c` (the owner's answers, before the sponsor order)

Every step exit 0:

| Step | Result |
|---|---|
| lint, `typecheck:all`, `test:all`, `test:ci-gating`, `build` | exit 0 |
| smoke, Chrome | exit 0 (997 s) |
| smoke, Firefox | exit 0 (1,241 s) |
| network, Chrome, prover on | 11 files, 25 tests passed |
| network, Chrome, the two proverless-marked files | 2 files, 4 tests passed |
| network, Firefox, proverless | 12 files passed, 1 skipped; 26 tests passed, 3 skipped |

The Firefox skip is `backup-restore-sw-restart`, whole-file, by design: it kills the background
under an open extension page, which Firefox does not allow (`CHROME_ONLY` in
`fixtures/browser/index.ts`).

## The parity recapture found a menu-order difference

The first two recaptures timed out after 150 s waiting for the sponsored card to read "Nothing".
The capture's dump showed why: the card read "Dev sponsor … Nulo can't tell what this fee
contract charges you." The capture clicked the menu's first sponsor row, and the menu listed
sponsors in storage order, so the contract added by hand sat above "Sponsored". The U16 drawing
lists Nulo's sponsor first. A capture that picks a row by its words, not its position, passed
(1 file, 2 tests), and the difference became a fix rather than a capture workaround.

1. `2987c46d` sorted `buildFeeMethods`: Nulo's sponsor first, hand-added ones after it in their
   existing order.
2. Codex round 8 (major): that list is also the default payer's source. With no saved choice,
   Send's walk (`fee-privacy.ts` `payersOf`) and the execute card's `settledSelection` take the
   first sponsor in it, so the sort silently moved the default from a hand-added contract to
   Nulo's sponsor. That is a behaviour change no pick asked for.
3. `13a2ef6a` put the list back in storage order and sorts only the rendered menu (`menuOrder` in
   `fee-helpers.ts`, used by `FeeMethodSelector`). The selector's new render-order test was
   probed: with the rows iterating `methods` instead of `menu`, it fails. The helper test pins the
   payer list's storage order, which the round-8 sort breaks.

No committed e2e adds a fee contract by hand, so no e2e clicks a different row after the change.

## Gate on `13a2ef6a`

| Step | Result |
|---|---|
| `bun run lint` | exit 0 (29 warnings, 3 infos, as before; none in changed lines) |
| `bun run typecheck:all` | exit 0 |
| `bun run test:all` | exit 0 (extension 7,136 passed, 4 skipped, 7 todo) |
| `bun run test:ci-gating` | exit 0 (138 passed, 2 skipped) |
| `bun run build` | exit 0 |
| smoke, Chrome | exit 0 (901 s) |
| smoke, Firefox | exit 0 (1,085 s) |
| network, Chrome, prover on | 11 files, 25 tests passed |
| network, Chrome, the two proverless-marked files | 2 files, 4 tests passed |
| network, Firefox, proverless | 12 files passed, 1 skipped (`backup-restore-sw-restart`, as above); 26 tests passed, 3 skipped |
| `bun run e2e:reap` | exit 0, nothing left |

HEAD was `13a2ef6a` at the start and at the end of the run. P6 and this phase change no e2e
file, so P5's flake bars stand.

## Parity

Rows 5, 9, 10 and 14 recaptured on `13a2ef6a` (1 file, 2 tests, exit 0; the temporary spec was
removed afterwards) and republished at https://claude.ai/artifact/3bsU92KDV4gfrqFGPBoy1m, with
every network capture now from the final source:

- Row 5: the app-set row reads "Fee · Public Fee Juice · set by the app". The embedded banner has
  no live capture (the dApp window draws its own badge for an embedded fee), so
  `FeeSettingsCard.test.ts` proves its words.
- Row 9: the sheet's fee line carries the card's dollars. Sponsored, it fits on one line; when the
  account pays, at 360 px the dollars wrap under the amount and "paid by your address" takes two
  lines. Without the dollars it fit. Left for the owner as a question on the page.
- Row 10: "Fee · —" with no payer, spoken as U16's sentence.
- Row 14: the menu lists "Sponsored" above "Dev sponsor", as drawn.

## Review

Codex rounds 8 and 9 (the sponsor order) are in [phase 5's fix-loop table](phase-5.md): round 8
found the default-payer regression, round 9 approved `13a2ef6a` with no new material findings.
