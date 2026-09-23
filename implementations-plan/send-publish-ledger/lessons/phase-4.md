# Phase 4 — notice row → tag

Date: 2026-09-21. Gate: `bun run --cwd apps/extension test src/popup/components/modules/send src/popup/pages` → 27 files, 397 tests green · `bun run audit:vue` → exit 0 (typecheck:all ∥ test ∥ lint, then build; lint's 30 warnings are dev's).

## What moved

- `FeeMethodSelector` draws the tag on the "Fee Source" label row (`Flex justify="between"` around the label, so the tag adds no height) from a `payerNoticeShape` prop; `FeeSettingsCard` only forwards the page's `facts.noticeShape`. The card's `payerNotice` computed, `feePayerNotice`, `FeePayerNotice`, `NOTICE_TITLE`, the 118px row and its two styles are gone — the row's remedy link already lived in the sheet since phase 2. `fee-privacy.ts` now imports only `TransferSide` from the facts module.
- The tag composes `publish-mark.module.css` (`mark.exposed` for the ink, `mark.mark mark.filled` for the square) — one vocabulary with the strip and the sheet, no colour literal on the selector.
- T11's invariant grew its third leg: `settled()` asserts tag present ⇔ `data-action="review"` ⇔ `data-you="exposed"` on every settled state, and the exposed rows check the tag's `data-notice-shape` against the destination. "No token → no tag" and "pending → no tag" are explicit.

## Carried to phase 5 — known red until then

`tests/e2e/network/fee-methods.test.ts` still reads the remedy link off the card (`remedyHref` in `feeView`, asserted at its "defaulted" step): the link now renders inside the review sheet, so that assertion is red at this commit. Phase 5 rewrites the walks with `sendTransfer(…, { expect })` and the sheet, and re-points the reader; the network suite is not a phase-4 gate and the two commits ship in one PR. Everything else that suite reads (`send-fee-privacy-notice`, its `data-notice-shape`, the `waitForFunction`s on it) keeps working against the tag, which is why the testid was kept verbatim. The smoke `send-fee-privacy.test.ts` asserts the tag's *absence* under a dead RPC — unchanged.

## Notes

- `src/types/components.d.ts` gained the `PublishStrip` registration on this run (the resolver regenerates it whenever vitest or the dev server runs); committed with this phase rather than left to drift.
- The card test's `FeeMethodSelector` stub renders the tag from the prop, so the card-level tests prove forwarding, and the selector's own test proves the markup — neither pretends to be the other.
