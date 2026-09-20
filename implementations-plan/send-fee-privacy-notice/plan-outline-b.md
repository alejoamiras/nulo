# Competing outline B — cheapest-first, patch in place

Same product scope and the same owner decisions as `plan.md`. The angle is the smallest possible
diff: no new storage shape, no new files beyond one test, no edit outside the card and `send.vue`.

## Shape

- **No `fee-privacy.ts`, no `fee-saved-selection.ts`, no `FeePrivacyNotice.vue`.** Everything lives in
  `FeeSettingsCard.vue` and `fee-helpers.ts`.
- **One prop**, `originPrivacy`, plus `destinationPrivacy` for the wording.
- **Default walk** added to `fee-helpers.ts` as `resolveDefaultMethod(origin, methods, balances)` next
  to `resolveSavedSelection`, tested in the existing `fee-helpers.test.ts`. Same order and the same
  hold rule as outline A.
- **Storage stays `{ [address]: method }`.** Instead of two slots, the saved record is simply *not
  honored* when honoring it would leak: under a private origin a saved `fj` is ignored and the default
  walk runs. `settings/fpcs/index.vue` is not touched.
- **The row is inline** in the card's template — a third `.detail_row` block beside `send-fee-nudge`
  and `fee-init-degraded`, with a `leakNotice` computed in the SFC. Copy strings in `fee-helpers.ts`.
- **Takeover** narrowed the same way as outline A.
- **Tests**: `fee-helpers.test.ts` for the walk; `FeeSettingsCard.test.ts` for the rest. E2E as in
  outline A.

## What it buys

- Three fewer source files and two fewer test files.
- No change to a persisted shape, so no second consumer to update and nothing for a future reader to
  wonder about.
- The card's template stays the single place to read what the fee card can show.

## What it costs

- **A deliberate public-payer pick does not stick.** The user who chooses public Fee Juice for a
  private send — warned, and proceeding anyway — has the pick saved and then ignored the next time
  Send opens. Under warn-and-allow that is a regression in respect for a stated choice, and it makes
  the "a chosen leak still warns" e2e assertion about persistence impossible.
- **A public-send preference still bleeds the other way**: a saved `private_fpc` governs public sends
  and spends private gas for nothing. Harmless to privacy, but the "match both directions" decision is
  only half-implemented.
- **Complexity budget.** `FeeSettingsCard.vue`'s `<script setup>` is already ~590 lines with no
  suppression; the walk is fine in `fee-helpers.ts`, but the origin watcher, the hold re-read and the
  notice computed all land in the SFC.
- **The matrix is not pinned in one place.** The notice condition is a computed inside an SFC, so the
  "exactly two cells produce a notice" property can only be asserted through mounts.

## Hybrid worth considering

Outline A's pure `fee-privacy.ts` (the matrix deserves one pinned home) with outline B's inline row
(one fewer component), and outline A's two-slot storage. The auditors are asked to weigh this.
