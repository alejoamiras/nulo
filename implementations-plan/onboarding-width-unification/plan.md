# Onboarding width unification

Unify the visual width of the six onboarding pages (welcome → create / import → learn → accelerator → done) behind a single `<OnboardingPage>` layout component, eliminating the four-different-max-width churn that makes the flow feel "toy-shaped" on first use.

## Status tracker

```
[✓] 0. Clarifying questions
[✓] 1. Main plan (this file) + dual audit (codex + opus subagent)
[✓] 2. Audit reconciliation — this file revised in place (see "Audit reconciliation")
[✓] 3. Final codex review of consolidated plan — yellow, 4 doc fixes applied
[▶] 4. Approval gate
[ ] 5. Implementation
[ ] 6. Post-impl codex review
[ ] 7. Fix loop
```

Tier: **B** (medium / contained feature work — one main plan + dual audit). Single package (`packages/extension`), single domain (onboarding UI), no schema / protocol / cross-package surface.

## Context

The onboarding tab is a Vue app at `chrome-extension://<id>/src/onboarding/index.html`, mounted from [`packages/extension/src/onboarding/`](../../packages/extension/src/onboarding/). It is the first surface a new user sees. Six pages share an outer shell (`app.vue`) that renders the brand header + teleport anchors + `<RouterView>`. Each page owns its own `.page` CSS module class with a per-page `max-width`.

### Current `.page` max-width map

| File | StepIndicator? | `.page` max-width | Top margin |
|---|---|---|---|
| `pages/welcome.vue` | no (pre-step) | **480px** | `32px auto 0` |
| `pages/create.vue` | step 1 (Setup) | **480px** | `16px auto 0` |
| `pages/import.vue` | step 1 (Setup) | **560px** | `16px auto 0` |
| `pages/learn.vue` | step 2 (Aztec) | **880px** | `16px auto 0` |
| `pages/accelerator.vue` | step 3 (Speed) | **560px** | `16px auto 0` |
| `pages/done.vue` | step 4 (Done) | **440px** | `48px auto 0` |
| `components/StepIndicator.vue` (`.row`) | — | **560px** | `0 auto 16px` |

Visible cycle: **480 → (480 / 560) → 880 → 560 → 440**.

- Step 1 alone has *two* widths (create=480, import=560).
- The widest-to-narrowest delta is 880 − 440 = 440 px.
- The `StepIndicator`'s own `max-width: 560px` is *capped by the parent* on every page where the parent is narrower (welcome/create at 480, done at 440) — so the indicator visually changes width across steps too.

### Why this is the symptom of "popup-inherited"

The user reported the flow feels "popup-inherited". The actual mechanism isn't inheritance — there is no `Popup` / `PopupCard` import in any onboarding page. The visual association is that 440–480 px is *close to* the wallet popup's `--base-width` (360 px); the brain reads the narrow centered card on `create` / `done` as popup-shaped, then sees `learn` blow out to nearly 2× and reads it as a different surface entirely.

## Decision summary (from clarifying questions)

| Question | Decision |
|---|---|
| Target unified width | **640 px** (middle ground) |
| Welcome page treatment | **Match the steps** (640 px, same as steps 1–4) |
| Fix approach | **Shared `<OnboardingPage>` layout component** (architectural single source of truth) |

Rationale — 640 px sits above the StepIndicator's natural 560 cap (so the indicator stops shrinking) and below `learn.vue`'s current grid-stack breakpoint (720 px). It is the smallest width that lets the four-cell indicator breathe; it is the largest width at which the create / done form heroes don't feel marooned in whitespace.

Trade-off — `learn.vue`'s 3-card grid is narrower than today (inside the 640 px container the cards render at 212 px outer, 164 px usable text width after each card's 24 px side padding). At its current `@media (max-width: 720px)` viewport breakpoint the grid would *always* be single-column inside a 640 px container, which kills the "three things to know" punch. The plan switches the grid to a **CSS container query** (`@container onboarding-page (max-width: 540px)`) anchored to `<OnboardingPage>` — that lets the layout respond to the actual container width rather than the viewport, sidestepping the shell's `24 + 24 = 48 px` horizontal padding offset. See "Architecture → `pages/learn.vue`" for the container-query threshold rationale and the per-card `padding: 16px` fallback if 164 px proves visually too cramped.

## Architecture

### New component: `<OnboardingPage>`

**Location** — `packages/extension/src/onboarding/components/OnboardingPage.vue`.

Not under `src/components/` because it is onboarding-shell-specific (knows about the brand header padding in `app.vue` and the per-page top margin); not reused by the popup. The L0–L6 layer model in [`CLAUDE.md`](../../CLAUDE.md) governs `src/components/`, not `src/onboarding/components/` (the onboarding tab is a separate Vue mount).

**API:**

```vue
<script setup lang="ts">
const props = defineProps<{
  /** Centers the inner content + hero block. Used by welcome + done.
   *  Defaults to "start" — left-aligned (create / import / learn / accelerator). */
  align?: "start" | "center"
  /** Inter-child gap, in px. Omit for the 32 px default. `learn` passes 40,
   *  `welcome` passes 56, `done` passes 40. `import` passes 24 (preserves
   *  its current tighter rhythm — see import.vue diff below). */
  gap?: number
}>()

// IMPORTANT — the check is `!== undefined`, not a truthy check. A truthy check
// would silently collapse `gap=0` to the 32 px default; the explicit-undefined
// form lets a caller intentionally render with no inter-child gap.
const gapVar = computed(() =>
  props.gap !== undefined ? { "--onboarding-page-gap": `${props.gap}px` } : undefined,
)
</script>

<template>
  <!-- `<div>` (not `<main>`): app.vue#shell at app.vue:75 is already the
       page's `<main>` landmark. Nesting `<main>` inside `<main>` violates
       HTML5 + WAI-ARIA-1.2 §5.3 (one main landmark per document). -->
  <div :class="[$style.page, align === 'center' && $style.center]" :style="gapVar">
    <slot />
  </div>
</template>

<style module>
.page {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 640px;
  margin: 24px auto 0;
  gap: var(--onboarding-page-gap, 32px);

  /* welcome.vue's legal footer pins to the bottom via `.footer { margin-top: auto }`
   * (welcome.vue:97-103). That only works while the page is a flex column that
   * grows inside the shell — the shell is `display: flex; flex-direction: column;
   * min-height: 100vh` (app.vue:104-113). Drop `flex: 1` and the welcome footer
   * collapses up against the action buttons. Universal `flex: 1` is benign for
   * the other 5 pages — they don't pin anything to the bottom; short pages just
   * keep whitespace below the slot content, same as today. */
  flex: 1;

  /* Container query anchor for learn.vue's 3-card grid (and any future per-page
   * container-relative layouts). See learn.vue change below. */
  container-type: inline-size;
  container-name: onboarding-page;
}
.center {
  align-items: center;
}
</style>
```

The exposed `--onboarding-page-gap` CSS var (set per-page via `:style`) lets `welcome` / `done` / `learn` / `import` keep their looser or tighter rhythm without exporting an enum of gap values. Pages that want the default 32 px simply omit the prop.

**Root tag is `<div>`** — `app.vue#shell` (`packages/extension/src/onboarding/app.vue:75`) is already the page's `<main>` landmark. The test plan below pins this decision via a `tagName === 'DIV'` assertion so a future refactor can't silently re-introduce nested-`<main>`.

**Container queries** — `container-type: inline-size` lets `learn.vue`'s 3-card grid switch layouts based on the actual width of `<OnboardingPage>`, not the viewport. A viewport-based `@media` query at the grid would need to account for `app.vue#shell`'s `24+24=48 px` horizontal padding (which constrains the page below 688 px viewport) — easy to get wrong. Container queries are supported in Chrome 105+ and Firefox 110+; the extension targets latest Chrome (Manifest V3 minimum is Chrome 88, but the user base is on much newer).

### Changes to `StepIndicator.vue`

Drop the indicator's own `max-width: 560px` and let the parent constrain it. This is the one place where the existing component "fights back" against the parent — we want the indicator to be exactly as wide as the new 640 px shell.

```diff
 .row {
   display: grid;
   grid-template-columns: repeat(4, 1fr);
   gap: 8px;
   width: 100%;
-  max-width: 560px;
-  margin: 0 auto 16px;
+  margin: 0 0 16px;
 }
```

The `margin: 0 auto` was a relic of the indicator being narrower than its container; with the parent now constraining width, centering happens at the page level. Pages that center their content (welcome / done) flow the indicator with the rest of the content via `align-items: center` on the page wrapper.

### Per-page diffs

Each page replaces its outer `<Flex>` with `<OnboardingPage>` and deletes its local `.page` style block. The internal hero / form / grid markup is unchanged.

**`pages/welcome.vue`**

```diff
-<Flex direction="column" align="center" :class="$style.page">
-  <Flex direction="column" align="center" gap="16" :class="$style.hero">
+<OnboardingPage align="center" :gap="56">
+  <Flex direction="column" align="center" gap="16" :class="$style.hero">
    ...
   </Flex>
-</Flex>
+</OnboardingPage>
```

Delete `.page { max-width: 480px; ... }`. Keep `.hero`, `.hero_bar`, `.subhead`, `.tagline`, `.actions`, `.footer`, `.link`. The hero's own `padding: 24px 0` stays.

**`pages/create.vue`** — same pattern, `align` default (`start`), `gap` default (32). Delete `.page` style. StepIndicator + hero + form become slot children.

**`pages/import.vue`** — same as create, BUT **pass `:gap="24"`** explicitly. The current outer `<Flex>` uses `gap="24"`; standardizing to 32 grows the page height by ~40–50 px (8 px × 5+ siblings: back button, indicator, hero, name input, method picker, submit buttons), which can push the submit button below the fold at 1080 × 720 viewport. Preserving 24 keeps today's vertical rhythm. Delete `.page`.

**`pages/learn.vue`** — `gap` stays at 40 via `:gap="40"`. Delete `.page`. Replace the viewport-based grid breakpoint with a **container query** anchored to `<OnboardingPage>`:

```diff
-@media (max-width: 720px) {
-  .grid {
-    grid-template-columns: 1fr;
-  }
-}
+@container onboarding-page (max-width: 540px) {
+  .grid {
+    grid-template-columns: 1fr;
+  }
+}
```

Why `540 px` — inside the 640 px container the 3-card grid renders three ~213 px cells (640 − 1 px border each side − 2 × 1 px gaps = 636 / 3 ≈ 212 px); each card's `padding: 24px` (`learn.vue:105-111`) leaves ~164 px of usable text width per card. That's snug but legible: title "Public and private state" (16 px / 700 weight) wraps to 2 lines; body text (13 px / 150% line-height) flows ~14–16 chars/line × ~5–6 lines per card. At a 540 px container, that drops to ~132 px usable per card — too cramped — so we stack to single-column.

**Pre-merge visual verification gate** — open `learn.vue` in dev mode and confirm:

- 3-column at 640 px container: titles wrap to ≤ 3 lines, body text to ≤ 8 lines. No horizontal overflow, no awkward single-word orphans.
- If the 3-col layout *is* too cramped for the existing copy, the fallback is to **reduce per-card padding from `24px` to `16px`** (gains 16 px usable per card → ~180 px). The `container-type: inline-size` infrastructure is already in place; only the padding value changes. Bumping the container to 680 px is a less-preferred fallback because it cascades width changes to every other page.

**`pages/accelerator.vue`** — same as create. Was 560; widens to 640. Delete `.page`.

**`pages/done.vue`** — `align="center"`, `:gap="40"`. Was 440; widens to 640. Top margin was `48px auto 0` (vs other pages' 16 px); the unified `OnboardingPage` default is `24px auto 0`. To preserve the looser top-of-page rhythm done had, **add `padding-top: 24px` to done's `.hero` block** (compensating for the 24 px lost from the page-level margin). Delete `.page`.

### Files touched — summary

| Action | File | Purpose |
|---|---|---|
| NEW | `packages/extension/src/onboarding/components/OnboardingPage.vue` | Shared layout shell |
| NEW | `packages/extension/src/onboarding/components/OnboardingPage.test.ts` | Vitest coverage (≥6 cases) |
| EDIT | `packages/extension/src/onboarding/components/StepIndicator.vue` | Drop own max-width + auto margin |
| EDIT | `packages/extension/src/onboarding/pages/welcome.vue` | Use `<OnboardingPage>`, drop `.page` |
| EDIT | `packages/extension/src/onboarding/pages/create.vue` | Same |
| EDIT | `packages/extension/src/onboarding/pages/import.vue` | Same |
| EDIT | `packages/extension/src/onboarding/pages/learn.vue` | Same + grid breakpoint → container query at 540 px |
| EDIT | `packages/extension/src/onboarding/pages/accelerator.vue` | Same |
| EDIT | `packages/extension/src/onboarding/pages/done.vue` | Same + `padding-top: 24px` on `.hero` to compensate for tighter page top margin |
| EDIT | [`.github/workflows/pr-smoke-e2e.yml`](../../.github/workflows/pr-smoke-e2e.yml) | Add `packages/extension/src/onboarding/**` to the `smoke-surface` filter (so this PR + future onboarding work triggers smoke e2e automatically) |

Auto-import is wired: `packages/extension/vite.config.ts:174-177` registers `useComponents({ dirs: ["src/components", "src/onboarding/components"], dts: "src/types/components.d.ts" })`. `<OnboardingPage>` will be auto-imported in all 6 page templates without explicit imports. **Caveat for tests** — `packages/extension/vitest.config.ts` does NOT register `useComponents`; the `OnboardingPage.test.ts` file must `import OnboardingPage from "./OnboardingPage.vue"` explicitly and stub any auto-imported children via `global.stubs` per the [`CLAUDE.md`](../../CLAUDE.md) "Vue component test conventions" section.

## `<OnboardingPage>` test plan

Component coverage in `OnboardingPage.test.ts` — six cases, each load-bearing for a specific invariant the component owes its consumers. Audit feedback removed two near-duplicate snapshot cases (the original "default render" + "explicit `align='start'` matches default" + "`max-width` on root" were three lenses on the same fact) in favour of two regression-pinning cases (root tag-name + `gap=0` not regressing to default).

1. **Default props render** — no `align`, no `gap` → `.page` class applied, `.center` class absent, no inline `style` attribute on the root (so `var(--onboarding-page-gap, 32px)` falls through to the 32 px fallback). Assert via class snapshot + `wrapper.attributes("style")` is `undefined`.
2. **`align="center"` adds the center class** — root carries both `.page` and `.center`.
3. **`gap=40` maps to the CSS var** — root's inline `style` contains `--onboarding-page-gap: 40px`.
4. **`gap=0` does NOT regress to default** — root's inline `style` contains `--onboarding-page-gap: 0px`, NOT absent. Locks the `props.gap !== undefined` check in the `gapVar` computed; a future implementer using truthy `props.gap ? ... :` would fail this test.
5. **Default slot renders** — passed slot content (a dummy `<span data-testid="child">payload</span>`) appears inside the root.
6. **Root element `tagName === 'DIV'`** — locks the a11y decision. If a future refactor swaps in `<main>` / `<section>` / `<article>`, this test fails immediately and forces the refactorer to revisit the landmark hierarchy.

Six cases is below the "≥10 for composites" guideline in [`CLAUDE.md`](../../CLAUDE.md), but `OnboardingPage` is a slot-only layout shell with a 2-prop surface — there is no behavior to exercise beyond what's listed. Adding bulk cases would dilute, not strengthen, the suite. Document the rationale at the top of the test file.

**Test-file imports** — vitest does NOT register `useComponents`, so the file uses an explicit `import OnboardingPage from "./OnboardingPage.vue"` at the top. No child components are used in test (only a dummy slot payload), so no `global.stubs` needed.

## Validation

**Local gates (before the PR):**

1. `bun run typecheck` — types tight on the new component.
2. `bun run --cwd packages/extension test src/onboarding/components/OnboardingPage.test.ts` — fresh test passes.
3. `bun run audit:vue` — typecheck → unit + component tests → lint → build, end-to-end.
4. **Manual visual smoke (required, can't be automated)** — open the onboarding tab, walk welcome → create → learn → accelerator → done, then back through import. Confirm:
   - The brand header + step indicator stay anchored at the same horizontal extent across all 6 pages.
   - On `learn`, the 3-card grid renders 3-column whenever `<OnboardingPage>` is at its full 640 px container width (which holds at any viewport ≥ 688 CSS px — i.e., 640 page + 48 px shell padding). Shrink the window below ~588 CSS px viewport and the cards should stack to single-column (container-query threshold at 540 px container width). Verify the transition happens at the right edge — no oscillation, no horizontal overflow at the breakpoint.
   - Inside the 3-column layout, the existing copy ("Public and private state" etc.) wraps cleanly to ≤ 3 lines per title and ≤ 8 lines per body. If it visibly cramps, apply the `.card { padding: 16px }` fallback (gains 16 px usable per card → ~180 px). Update this plan if the fallback is taken.
   - The hero block on welcome + done still centers correctly.
   - No horizontal scroll appears at 320 px viewport (the extension targets desktop popup width but the onboarding tab can shrink in a narrow window).
5. `bun run test:e2e` — smoke. Existing `onboarding-tab.test.ts` selectors (`onboarding-welcome-create`, `onboarding-name-input`, `onboarding-password-input`, `onboarding-password-confirm`, `onboarding-accelerator-status`, `onboarding-accelerator-continue`) are inside form / button elements that don't move — selectors should hold without change.

**CI gates:**
- `Quality / Status` — must pass.
- `Smoke e2e / Status` — **does NOT trigger today** on onboarding-only changes. `.github/workflows/pr-smoke-e2e.yml` lines 36–80 list the `smoke-surface` filter; `packages/extension/src/onboarding/**` is conspicuously absent (popup, components, composables, stores, design, etc. are all included; onboarding is not). This PR adds `packages/extension/src/onboarding/**` to that filter so smoke e2e runs automatically — both for this PR and for future onboarding-only work. Alternative if the filter expansion is rejected in review: explicitly label this PR `e2e:smoke` to force the smoke gate to run.
- Network e2e is not required for a CSS-only flow change.

**Post-implementation e2e addition** — append a tiny assertion to `packages/extension/tests/e2e/onboarding-tab.test.ts` that walks the welcome route and asserts `await page.evaluate(() => document.querySelectorAll('main').length) === 1`. This locks the "one `<main>` landmark per document" guarantee from the component test under CI, end-to-end. Single line, no new fixtures.

## Security & adversarial considerations

This is a CSS / layout refactor with no surface that handles secrets, no new network calls, no new storage reads. The threat surface is narrow but non-zero:

| Vector | Assessment |
|---|---|
| **CSS injection** | None. No user-input interpolation into styles. Width values are static literals. |
| **Clickjacking** | The onboarding tab is at `chrome-extension://<id>/...`; X-Frame-Options is moot for extension URLs (they can't be framed by web content under MV3). Width change doesn't alter the surface. |
| **Phishing** | The tab URL is unforgeable. Width change doesn't reduce user trust signals (brand header + lock icon remain unchanged). |
| **E2E selector breakage** | Existing `data-testid`s are inside inputs / buttons / status cards that aren't restructured. Per [`CLAUDE.md`](../../CLAUDE.md), testid preservation is verbatim. The plan does NOT introduce a new testid on `<OnboardingPage>` — there is no reason to query the layout shell, and adding one would invite tests that lock the layout shape. |
| **A11y regression** | `<main>`-nesting check (above). `StepIndicator`'s `aria-current="step"` is unchanged. Keyboard tab order is unchanged (no DOM re-ordering, just style-class swap). `prefers-reduced-motion` is not affected (no animations added). |
| **Supply chain** | No new deps. |
| **Visual regression for users mid-onboarding** | A user who has the onboarding tab open during update would see the layout shift. The onboarding tab is short-lived (single session, dismissed on `Open wallet`), so this is "next time you open the tab" — acceptable. The `<OnboardingPage>` change does NOT touch `appStore.onboardingCompleted` or any persistence; the route → component mapping is unchanged. |
| **Reduced motion** | No motion is introduced. The existing `shakeInput` / `pulse` keyframes remain unchanged. |
| **`prefers-color-scheme`** | All width changes are color-agnostic. The existing `applyTheme` in `app.vue` is untouched. |

**Adversarial pass** — *what could go wrong here that isn't on the list?*

- **`window.close()` exploits via the `done` page changes** — `done.vue`'s `openWallet` flow (SW message → `window.close()`) is untouched by this plan. Confirm in code review that the diff only edits the `.page` style block + outer wrapper, not the script.
- **Layout-driven CSS reflow timing as an oracle for "user is on step X"** — the onboarding pages don't gate on layout-derived timing. The accelerator status detection is on its own polling loop in `useAcceleratorStatus`. N/A.
- **Bypassing the onboarding gate by deep-linking to `/onboarding/done`** — already possible today; not introduced or worsened by this plan. The actual routing logic at [`packages/extension/src/onboarding/app.vue:51-71`](../../packages/extension/src/onboarding/app.vue) is: (a) if onboarding is already completed, open the popup window and close the tab; (b) else if `hydrateKnownProfile` finds an active profile, redirect to `/onboarding/learn`; (c) else if there are zero profiles, *do not redirect* (the user stays on whatever route they entered on); (d) else open the popup window and close. The catch-all redirect at [`packages/extension/src/onboarding/index.ts:40-43`](../../packages/extension/src/onboarding/index.ts) only handles bare `/` → `/onboarding/welcome`. So a deep link to `/onboarding/done` for a brand-new user (zero profiles) WOULD land on `done.vue` without a profile, and clicking "Open wallet" there would call `appStore.setOnboardingCompleted(true)` and open the popup against an empty profile set. That is a pre-existing gap in the routing gate, not a width-change concern; out of scope for this plan. If it's deemed worth fixing, a separate PR adds a `beforeEnter` route guard to the done route.
- **A `<main>`-inside-`<main>` nesting accidentally caused by switching `<OnboardingPage>`'s root to `<main>`** — explicit decision: `<OnboardingPage>` renders `<div>` (not `<main>`), because `app.vue#main.shell` is already the page's `<main>`. Pinned by the component test (`tagName === 'DIV'`) AND a post-implementation e2e assertion that the rendered document has exactly one `<main>` (see Validation section).
- **`gap=0` silently regressing to 32 px default** — a future implementer simplifying the `gapVar` computed to a truthy check (`props.gap ? ... :`) would silently make `gap=0` render as 32 px. Test case #4 (`gap=0` → `--onboarding-page-gap: 0px` on the root) blocks this regression.

## Out of scope

- **The popup register page** (`packages/extension/src/popup/pages/register.vue`) — has its own width concerns inside the 360 px popup; not visible to the onboarding tab. Untouched.
- **The legal modal popups** (`https://nulo.sh/terms`, `https://nulo.sh/privacy` opened via `chrome.windows.create`) — external pages, not part of the extension surface.
- **Standardizing the hero `_bar` widths** (currently 40 px on most pages, 56 px on welcome + done) — the hero bar is a brand element, not a width concern. The user's report is about the *page* width, not the bar. Defer.
- **Mobile / narrow-viewport tuning below 480 px** — the onboarding tab is desktop-only in practice (Chrome extension tab; tablet Chrome doesn't run extensions today).
- **`onboarding.scss` `min-width: 320px`** — already correct; not removed.

## Rollback

Pure additive + style change. Rollback = revert the PR. No storage migration, no persistence bump, no API surface. Users mid-onboarding when the rollback ships re-see the old per-page widths; nothing else regresses. **Note** — if the smoke-surface filter is updated in this PR ([`pr-smoke-e2e.yml`](../../.github/workflows/pr-smoke-e2e.yml)), the rollback also reverts that change. The expanded filter is harmless on its own (smoke runs more often, no false-negative risk), so a partial-revert that keeps the filter expansion is also acceptable.

## Audit reconciliation

Both audit transcripts ([`audit-codex.md`](audit-codex.md), [`audit-opus.md`](audit-opus.md)) returned **yellow** and converged on the same three top issues. Audit-driven changes adopted in this revision:

| # | Source | Finding | Resolution |
|---|---|---|---|
| 1 | opus A1 + codex #3 | `<OnboardingPage>` template snippet used `<main>` — nests inside `app.vue:75`'s `<main>` landmark (HTML5 + WAI-ARIA-1.2 violation). | Root locked to `<div>` in the spec. Test case #6 asserts `tagName === 'DIV'`. E2E smoke gets an `assert(document.querySelectorAll('main').length === 1)` line. |
| 2 | opus C5 + codex #1 | `welcome.vue`'s `.page { flex: 1 }` is load-bearing for the legal footer's `margin-top: auto`. Plan silently dropped it. | `OnboardingPage`'s `.page` style now sets `flex: 1` universally. Benign for the other 5 pages (no footer-pinning expectation); fixes welcome's footer. |
| 3 | opus M2 + codex #3 | Template referenced `gapVar` but `<script setup>` never defined it. | Spec now declares `const gapVar = computed(() => props.gap !== undefined ? { ... } : undefined)`. Test case #4 (`gap=0` doesn't regress to default) locks the `!== undefined` check against a future truthy-shortcut refactor. |
| 4 | codex #2 + opus T1 | Grid breakpoint `@media (max-width: 560px)` is viewport-based and ignores `app.vue#shell`'s `24+24 px` horizontal padding. Plan's "~205 px usable per card" math also forgot the card's own `padding: 24px`. | Switched to a CSS **container query** (`@container onboarding-page (max-width: 540px)`) with `container-type: inline-size` on `<OnboardingPage>`. The threshold is container-relative, not viewport-relative. Per-card padding math now explicit (212 outer − 48 padding = 164 usable). Pre-merge visual verification gate added with `padding: 16px` fallback if 164 px proves too cramped. |
| 5 | opus M1 | Plan claimed `Smoke e2e / Status` would auto-run; smoke-surface filter at [`pr-smoke-e2e.yml`](../../.github/workflows/pr-smoke-e2e.yml) does NOT include `packages/extension/src/onboarding/**`. | This PR adds `packages/extension/src/onboarding/**` to the filter. The plan's CI section is corrected accordingly. |
| 6 | opus T2 | `import.vue`'s outer `<Flex>` uses `gap="24"` today; standardizing to 32 grows the page height by ~40–50 px and can push the submit button below the fold at 1080 × 720. | `import.vue` migration passes `:gap="24"` explicitly. The plan's `.vue` diff is updated. |
| 7 | opus T3 | `done.vue`'s top margin was `48px auto 0`; unifying to OnboardingPage's `24px auto 0` default loses 24 px of breathing room. Plan punted with conditional `pt-32` (a non-existent class in this CSS-module setup). | Concrete decision: `done.vue` adds `padding-top: 24px` to its `.hero` block. No conditional. |
| 8 | opus C6 | 6 test cases included 3 near-duplicate snapshot variants. | Cases revised — `align="start"`-is-default and `max-width`-on-root collapsed into the default-render case, replaced with `tagName === 'DIV'` (#6) and `gap=0` regression (#4). |
| 9 | opus M5 | Plan said tests benefit from auto-imports; `vitest.config.ts` doesn't register `useComponents`. | Plan now states: test file uses explicit `import OnboardingPage from "./OnboardingPage.vue"`. |

Audit-flagged points **NOT adopted**, with rationale:

| # | Source | Finding | Rationale for rejection |
|---|---|---|---|
| A | opus T1 alternative | Bump container to 680 px instead of 640 to give cards more room. | Defers the visual-fit question rather than answering it. The container query + per-card `padding: 16px` fallback handles cramped cards without cascading a width change to every other page. If 16 px padding still feels cramped after visual verification, *then* the discussion of 680 vs 640 is in scope as a follow-up; not pre-emptive. |
| B | opus M7 | Mention HMR caveat for `<style module>` in dev mode. | Pure dev-loop note. Doesn't affect correctness, security, or the merged surface. Skip. |
| C | opus M6 | Add SSR / dark-mode coverage. | `OnboardingPage` doesn't subscribe to theme; theme runs at `app.vue` via `applyTheme`. JSDOM doesn't compute styles, so a "dark mode renders" test is a no-op. Skip. |
| D | opus M3 | Add `<header>` semantic to learn / accelerator. | Pre-existing minor a11y gap, not introduced or worsened by this PR. Out of scope (file separately if it bothers reviewers). |

## References

- [`packages/extension/src/onboarding/`](../../packages/extension/src/onboarding/) — the affected tree.
- [`packages/extension/tests/e2e/onboarding-tab.test.ts`](../../packages/extension/tests/e2e/onboarding-tab.test.ts) — selectors that must continue to resolve.
- [`.github/workflows/pr-smoke-e2e.yml`](../../.github/workflows/pr-smoke-e2e.yml) — the `smoke-surface` filter to expand.
- [`packages/extension/vite.config.ts`](../../packages/extension/vite.config.ts) — `useComponents` auto-import configuration (lines 174–177 cover `src/onboarding/components/`).
- [`CLAUDE.md`](../../CLAUDE.md) — testid preservation rule, code-comment style, validation gates.
- Earlier related plan: [`implementations-plan/onboarding-extraction/`](../onboarding-extraction/) — when the onboarding tab was carved out of the popup.
- Audit transcripts: [`audit-codex.md`](audit-codex.md), [`audit-opus.md`](audit-opus.md).
