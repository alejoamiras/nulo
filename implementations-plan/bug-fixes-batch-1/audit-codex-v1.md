# Review — bug-fixes batch #1

## Verdict
`APPROVE-WITH-FIXES`

The batch is directionally right, but B1, B2, and B3 rely on incorrect assumptions about current code, and the test/build plan undercovers landing and network-detail fallout. Fix those gaps before implementation.

## Per-bug findings
**B1.** The plan found the right call sites: `useFeeEstimation` is only used by `send.vue`, and `useFeeEstimationMap` is only used by `popup/windows/execute/index.vue`, so there are no missing estimator consumers. But the plan’s “toast replaces, so repeated failures are fine” claim is false: `packages/extension/src/composables/toast.js` overwrites `toast.value` but does not clear the previous timeout, so a later toast can disappear early, and the idle copy in `FeeCostReadout.vue` still lies after failure. Fix `useToast` timer replacement and add a toast-timer test, or add an explicit failed readout state instead of deferring it.

**B2.** Routing the header button directly to Manage Networks matches the user’s stated intent, and deleting `NetworksPopup.vue` is mechanically safe because only `Header.vue` and `PopupManager.vue` reference it. The under-scoped part is the replacement UX: `SettingItem` currently makes the whole row one click target, the chevron in `settings/networks/index.vue` is not an interactive control, and there is no `data-testid` for a detail affordance, so “row switches + chevron manages” needs extra component work and broader e2e rewrites than listed. Add a dedicated chevron/button with `@click.stop` and a `data-testid`, update detail helpers/tests, and explicitly accept the “leave current page / lose unsaved send state” tradeoff.

**B3.** Brand-alignment is reasonable, but `packages/extension/public/logo.svg` is not optional cleanup: `/logo.svg` is referenced by `src/popup/index.html`, `src/onboarding/index.html`, and `src/setup/index.html`, so leaving it old would keep stale favicons in extension surfaces. The stroke reasoning is also weak: `1.5` on a `32` viewBox and `3` on a `64` viewBox are the same proportion, so that does not actually improve 16px toolbar visibility. Treat `public/logo.svg` as required, choose the circle weight from exported 16/24/32 rasters, and use a reproducible local conversion path rather than an online fallback.

**B4.** This one is mostly correct: the plan found all `.nav__logo-o` references, and the HTML change is exactly what the user asked for. After removing the span, `@keyframes breathe` becomes dead code, so leaving it “if shared” is unnecessary here. Remove the orphaned keyframes in the same change.

**B5.** Deleting the two footer nodes and `.footer__version` is safe; there is only one source consumer. The incomplete part is layout: on desktop, the current `.footer` uses `justify-content: space-between`, so with one remaining child group the footer will pin left unless you decide otherwise. Make the desktop footer alignment explicit, preferably centered, in the same patch.

## Cross-cutting findings
1. The local gate section is inaccurate for landing work: `bun run audit:vue` builds only `packages/extension`, not `packages/landing`, so B4/B5 can still break the landing build while “passing” the stated gate. Add `bun run --cwd packages/landing build` to the required local verification.

2. The B2 test surface is undercounted. Besides `openNetworkPopup`/`switchToNetwork` and `check-derivation-parity.ts`, the detail-path helpers `openNetworkDetail` and `deleteNetworkRow` plus `tests/e2e/endpoints.test.ts` depend on row-click drilling and will need selector changes. Expand the plan to include those helpers/tests up front.

3. The plan repeatedly states repo facts incorrectly: `TOAST_DURATION.LONG` is `4000`, not `5000`; there is no typed `"networks"` key to remove from `popup.store.ts`; and `public/logo.svg` is separately referenced today. Correct the plan to match observed code before implementation.