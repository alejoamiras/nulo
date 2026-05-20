# Final review — bug-fixes batch #1 v2

## Verdict
APPROVE-WITH-FIXES

## v1 → v2 fidelity
- B1 timer-race/test follow-up: N. The timer fix is covered, but the testing note is still inaccurate: `useToast` already has coverage in [ToastManager.test.ts](/Users/alejoamiras/Projects/nulo/nulo-3/packages/extension/src/components/ui/ToastManager.test.ts). The only missing regression is “re-open resets the timer.” The `CLAUDE.md` line claiming the composable coverage rule “doesn’t apply” is also wrong as written.
- B2 UX/test-surface follow-up: N. Option B does preserve the “save one click for edit” goal, but the plan still omits a required new `data-testid` for the proposed “Set as active network” control, which the e2e/helper rewrite will need to stay compliant.
- B3 icon follow-up: N. The missed consumers and stroke-math fix are addressed, but the consolidation path is still not technically sound.

## New issues introduced by v2
1. B2 Option A is framed on a false premise. `SettingItem` does not need a contract change to give the `#right` slot its own action; the repo already uses `@click.stop` inside that slot in [settings/networks/[id].vue](/Users/alejoamiras/Projects/nulo/nulo-3/packages/extension/src/popup/pages/settings/networks/[id].vue). Q1 currently overstates Option A’s blast radius.
2. B3 step order is internally inconsistent. Step 2 deletes `src/assets/logo.svg`, then step 3 tells implementation to rasterize `src/assets/logo.svg` into `logo.png`.
3. B3’s “one source” proposal likely targets an invalid import contract. [popup/app.vue](/Users/alejoamiras/Projects/nulo/nulo-3/packages/extension/src/popup/app.vue) raw-imports from `src`, and there is no Vite override here showing `/logo.svg?raw` from `public` is supported. Q4 should not ask the user to choose between a safe path and a likely-invalid one.

## Implementation greenlight
No-go until these are fixed:

1. Reframe Q1/B2 accurately: Option A can be done without a `SettingItem` contract change. If Option B remains default, add a stable testid for the new “Set as active network” row and call out the helper/test updates that will use it.
2. Rewrite B3 so it uses a real source of truth and a valid raw-import path. Safest version: keep `src/assets/logo.svg`, replace both SVG contents, regenerate `logo.png` from `src/assets/logo.svg`.
3. Correct the B1 test/compliance note to reflect existing `ToastManager.test.ts` coverage and add only the missing timer-reset regression there, or provide equivalent coverage elsewhere.