# Review — bug-fixes batch #1 (Opus 4.7)

## Verdict
APPROVE-WITH-FIXES — five fixes are correctly scoped, but B1 has a real toast-timer race, B2's UX split is incompatible with `SettingItem` as-is, and B3's stroke math is wrong.

## Per-bug findings

### B1 — Fee estimation silent failure
- `useFeeEstimation.ts:71-74`, `send.vue:226`, `execute/index.vue:97` all match the plan; `onError` is the right surface and only 2 callers exist (verified — plan caught both). Keep the shape.
- **Toast bug the plan would aggravate**: `toast.js:18` never clears the previous `closeTm` before scheduling. A rapid-fire 2nd `openToast` overwrites `toast.value`, but the FIRST timer keeps running and nulls the new toast early. "openToast replaces" is half-true; visually replaces, but the dangling timer kills the replacement. Recommend a one-line `clearTimeout(closeTm)` at the top of `openToast` plus a `toast.test.ts` case.
- **Wrong number**: plan says `TOAST_DURATION.LONG` is "5s"; `toast.js:8` shows 4s. Fix the plan's reasoning copy.
- `useFeeEstimation.test.ts:128` already pins the `onError` path — no new unit needed. Skipping e2e is sound (PXE failures are flaky to induce).

### B2 — Skip the networks popup
- Header.vue:229 confirmed, but the button is a **network chip** (network name + status dot), not a globe — `helpers.ts:131` comment is wrong and the plan inherits the wording. Fix the helper comment too.
- **Critical UX gap**: `SettingItem.vue` has exactly one click target (the wrapper `<component>` at lines 44-104). Slot `right` does not get its own click — a button-in-slot would propagate to the row. The plan's "tap-row-to-switch + chevron-to-manage" cannot be built without modifying `SettingItem`'s contract (adding an `@onRightClick` emit + a `<button>` wrapper around the right slot with `stopPropagation`), which is an L2 change affecting every consumer. Recommend either (a) widen B2 to modify `SettingItem`, (b) drop the chevron-split and make tap-row open a per-row action sheet, or (c) keep tap-row as drill-into-detail and add an explicit "set active" row inside the detail page (smallest change — my pick).
- Plan misses `tests/e2e/fixtures/extension.ts` (7 callsites of `switchToLocalNetwork`). If the helper signature stays the same, they keep passing — but name the file in §5 to set reviewer expectations.
- `popup.store.ts:3` has NO type enum (verified — bare-string keys). Plan's "remove the networks key from popup-store types" is a non-op; strike it.
- `SelectNetworksPopup` (PopupManager.vue:51) is a separate file and correctly stays.

### B3 — Extension icon ≡ landing favicon
- `src/assets/logo.svg` ≡ `public/logo.svg` (byte-identical, verified). Recommend consolidate to one source and resolve the duplicate.
- **Stroke math is wrong**: 1.5/32 viewBox and 3/64 viewBox both yield relative weight 0.0469, so the on-screen 16-px raster stroke is identical. The plan claims this is a "bump to preserve visual weight" — it isn't. To actually thicken the line, use ~2 on 32-viewBox (or 4 on 64-viewBox).
- **Missing consumer surfaces**: plan lists `manifest.config.ts`, `app.vue?raw`, `src/assets`, `public`. Missed: `popup/index.html:5`, `setup/index.html:5`, `onboarding/index.html:5`, `wallet-sdk/background.ts:107` (`walletIcon` is exposed to dApps via wallet-discovery — third-party-visible). All pick up new content automatically, but the plan should name them so the blast radius is documented.
- No storybook embeddings (verified).

### B4 — Landing wordmark
- All four file references match exactly. Verified `@keyframes breathe` (animations.css:103) has only ONE consumer (`.nav__logo-o:114`) — safe to delete the keyframes block too; plan's "check usage" answers itself.
- `aria-label="NULO home"` matches the new visible text. Fine.

### B5 — Landing footer
- `index.html:266` + `271` confirmed; `.footer__version` (layout.css:105-108) has no other consumer (verified) — safe to delete.
- Plan's worry about `space-between` collapsing is unfounded: `space-between` with one child renders as `flex-start` automatically. The `@media (min-width: 768px)` block at layout.css:86-89 stays unchanged. Recommend just delete the two `<div>`s + the `.footer__version` rule and stop.

## Cross-cutting findings
1. **Commit ordering**: plan ships B1 first then B2 (which rewires e2e helpers). Smallest-risk-first is safer for diagnosis. Recommend reorder B5 → B4 → B3 → B1 → B2; PR-review density is preserved.
2. **Commit subjects**: lower-case, conventional — plan complies. `fix(send): ...` for B1 and `feat(networks): ...` for B2 are correct (B2 changes user-visible flow, so `feat` not `fix`).
3. **Layer rules (CLAUDE.md L0-L6)**: no new components; only deletes (NetworksPopup is L5) and edits to Header.vue (service-bound flat) + `settings/networks/index.vue` (L6 page). Biome `noRestrictedImports` won't trigger.
4. **Comments policy**: the existing `settings/networks/index.vue:30-34` comment mentions "header globe → NetworksPopup" — rewrite to describe new live behavior without milestone/PR tags. Plan + commit messages contain no banned `M*/A*/phase N` markers.
5. **Test budgets**: nothing crosses an L1/L2≥5, L3≥10, composable≥10 threshold (deletes + edits only). E2E helper rewrite is the only test surface; plan correctly skips component tests for B2 (NetworksPopup had none).
6. **Manual-QA addition**: induce 3 back-to-back B1 failures and verify only ONE toast is visible at the end. Catches the `closeTm` regression at the user-facing layer.
