# Phase 3 · The snack over the Terms sheet (T)

## Red

`components/LegalAcceptanceSheet.test.ts` gains three cases, and `enableAutoUnmount(afterEach)`
with an `afterEach` that restores spies, closes the toast singleton and removes `#toast`: the sheet
now registers with `snackInset.ts`'s module-level registry, so a sheet left mounted by one case
would still be registered in the next.

- **The inset**: on a route whose meta shows the nav, with `ToastManager` and the sheet attached to
  the document, the viewport stubbed at 600 px and the "Not now" footer's box at top 560, height 40
  (the geometry stub of `ToastManager.test.ts`), the snack's host sits 52 px up (600 - 560 + 12).
- **The emit**: the sheet emits `visibility` `[true]` once it shows and `[true], [false]` once an
  accept lands.
- **The refused accept**: a rejected `accept` opens the error toast "Could not record your
  acceptance. Try again." and the sheet stays (green today; it holds the path the layer is for).

From `apps/extension`, `bun --bun vitest run src/components/LegalAcceptanceSheet.test.ts` → exit 1,
2 failed, 8 passed: the inset read `76px` (the nav route's base, as the plan predicted) and
`emitted("visibility")` was `undefined`.

## Change

- `LegalAcceptanceSheet.vue`: the backdrop takes `v-snack-sheet` with `Number.MAX_SAFE_INTEGER`
  (a named constant, above any Popup's `displaceIdx`), the "Not now" footer takes
  `v-snack-footer`, and a watcher emits `visibility` on every change of `visible`.
- `popup/app.vue`: `legalSheetShown` follows the emit, and `#toast` takes `toast_over_sheet`
  (`position: relative; z-index: 9500`, one comment) while it is true.

## Each directive is load-bearing

A probe on a copy of the file (restored by copying back, `cmp` clean), each run
`bun --bun vitest run src/components/LegalAcceptanceSheet.test.ts -t "own footer places"`:

- without `v-snack-footer` → exit 1, received `12px` (the sheet's base, no footer placing);
- without `v-snack-sheet` → exit 1, received `76px` (no sheet on top, the nav's base wins).

## Gate

- From `apps/extension`,
  `bun --bun vitest run src/components/LegalAcceptanceSheet.test.ts src/composables/snackInset.test.ts src/components/ui/ToastManager.test.ts`
  → exit 0, 3 files, 49 passed.
- `bun run lint` → exit 0 (28 warnings, 3 infos, the base's; complexity-baseline OK). ✓
