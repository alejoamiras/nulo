# P1 lessons — fees.vue copy (A1–A4)

## Outcome

`fix(onboarding-fees): copy corrections per QA` — em-dashes stripped,
private fee juice reframed as a separate asset, fee juice noted as
L2-only (burning $AZTEC on L1), both flavors marked non-transferable.

## What shipped

`packages/extension/src/onboarding/pages/fees.vue` — three card bodies
rewritten:

- **Card 01 (Fee juice)**: now reads "the L2 gas asset. The only way
  to get fee juice today is to burn $AZTEC on L1, which transforms
  into L2 fee juice on bridging. Fee juice is not transferable."
  (A3 + A4.)
- **Card 02 (Private fee juice)**: reframed as "a separate asset from
  regular (public) fee juice" — not "held privately". Adds the same
  non-transferable note. (A2 + A4.)
- **Card 03 (Sponsored fees)**: unchanged (no em-dashes; copy
  already correct).

Plus em-dash substitution in the two CSS / code comments at lines
~28 and ~100 (substituted with regular punctuation; not user-visible
but the plan said "strip em-dashes throughout").

## A1 strategy applied

In-place substitution (em-dash → comma / period / semicolon as fit).
No sentence rewrites needed; the cadence reads fine with regular
punctuation.

## Tests

None — pure copy. The existing onboarding e2e covers route
navigation. Manual QA in P13 covers visual review.

## Files

- `packages/extension/src/onboarding/pages/fees.vue` (3 card bodies +
  2 code comments).

## Open items

- A1 final sign-off: user reviews the rendered copy in P13 manual QA.
