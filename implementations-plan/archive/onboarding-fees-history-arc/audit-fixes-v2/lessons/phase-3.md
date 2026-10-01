# P3 lessons — aria-controls conditional + v-show

## Outcome

`fix(incoming-trust): conditional aria-controls + v-show on full address` —
6/6 tests pass in `IncomingTrustPopup.test.ts`. Closes codex Low #1 +
opus H-5 (APG SC 4.1.2 + ARIA 1.2 dangling-controls reference).

## What shipped

`packages/extension/src/popup/components/popups/IncomingTrustPopup.vue`:

- **`aria-controls` conditional emission**: bound to
  `expanded ? 'incoming-trust-contract-full' : undefined`. When the
  toggle is collapsed, `aria-controls` is absent (no dangling reference).
- **`v-show` instead of `v-if`** on the full-address row. The node
  stays mounted; the toggle just flips `display: none`. This keeps
  `aria-controls`'s target always resolvable when present, AND keeps
  the focus-reset on close (existing watcher at the bottom of
  `<script setup>`) working without re-creation churn.

## Tests

`packages/extension/src/popup/components/popups/IncomingTrustPopup.test.ts`:

- All 6 cases updated:
  - default state: `aria-controls` is **undefined** + container has
    `display: none` (collapsed).
  - expanded: `aria-controls` resolves to the id + container's
    `style` doesn't contain `display: none`.
  - collapse: container regains `display: none` + `aria-controls`
    absent.
  - reopen: state-reset behavior preserved via the existing watcher.

## What I tried that didn't work

`@vue/test-utils` `isVisible()` did not correctly detect v-show's
`display: none` under our stubbed Popup/PopupCard tree. Fell back to
checking the container's inline `style` attribute directly via
`w.find("#incoming-trust-contract-full").attributes("style")`. Robust
to both v-show's behavior AND any future Vue-version changes to how
the directive sets the style.

## Files

- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue` (template).
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.test.ts` (4 cases updated).

## Open items

None.
