# Audit — onboarding width unification (opus)

Reviewer: Opus 4.7 (called as opus subagent for Tier B dual audit).
Plan under review: [`implementations-plan/onboarding-width-unification/plan.md`](plan.md).

## Verdict

**Yellow — fix-before-implementation.** The 640 px target, the shared `<OnboardingPage>` direction, and the StepIndicator `max-width` drop are all sound. The plan is solid in spirit. But the template snippet and the prose disagree on the root tag (`<main>` vs `<div>`), and the snippet as written produces nested `<main>` landmarks — an HTML5 + WAI-ARIA violation that needs to be locked down with a test, not left as "reviewer to pick". The plan also misses `welcome.vue`'s `flex: 1` invariant (footer pins to viewport bottom via `margin-top: auto`); dropping it silently broaks "By continuing" copy positioning. Two more concrete misses below: (1) the smoke-surface CI filter does NOT include `src/onboarding/**`, so the plan's claim "the smoke e2e will run on this PR" is factually wrong, and (2) the `:style="gapVar"` reference in the template has no `gapVar` definition anywhere in the API spec — incomplete. Top must-fix: pin the root tag with an explicit test that asserts the document has exactly one `<main>`.

## Adversarial findings

### A1. Nested `<main>` is a real a11y regression (medium)

`packages/extension/src/onboarding/app.vue:75` already renders the page's `<main :class="$style.shell">`. The plan's `OnboardingPage.vue` template snippet at [`plan.md:81-86`](plan.md) shows:

```vue
<template>
  <main :class="[$style.page, align === 'center' && $style.center]" :style="gapVar">
    <slot />
  </main>
</template>
```

This nests `<main>` inside `<main>`. HTML5 spec allows multiple `<main>` only if all but one have `hidden`, and WAI-ARIA-1.2 §5.3 explicitly limits a document to one `main` landmark. Axe / Lighthouse will flag it; screen readers will announce two "main" landmarks which is genuinely confusing. The plan's prose at [`plan.md:103-104`](plan.md) acknowledges the conflict and defers to "reviewer should pick", which is exactly the kind of half-resolved decision that ships broken.

**Severity raises if the new component swaps in via auto-import without an explicit test** — onboarding pages currently each declare their own outer `<Flex>` (a `<div>` via the default `tag` prop), so the existing tree is `<main><div>...content...</div></main>`. The plan's snippet would change that to `<main><main>...</main></main>` on every page. There is no a11y test in the suite that would catch this.

Fix: lock the root to `<div>` in the spec **and** add a component test that asserts `wrapper.element.tagName === 'DIV'`. Also add one assertion in the e2e smoke that the rendered document has exactly one `<main>`.

### A2. testid surface — plan is correct, but the boundary edge is under-asserted

The plan explicitly chooses NOT to put a `data-testid` on `<OnboardingPage>` ([`plan.md:221`](plan.md)) — good call, locking the layout shell would invite tests that fixate on shape. The existing testids (`onboarding-welcome-create`, `onboarding-name-input`, `onboarding-password-input`, `onboarding-password-confirm`, `onboarding-accelerator-status`, `onboarding-accelerator-continue`, etc., listed at `packages/extension/src/onboarding/pages/*.vue`) all live on `<Button>`, `<Input>`, status cards, and back buttons — none of which the plan restructures. Verified.

One adversarial edge: `replaceInputValue` at `packages/extension/tests/e2e/fixtures/extension.ts:845` walks via `document.querySelectorAll<HTMLElement>(sel)` then descends to `querySelector("input")`. It is structurally robust. But there's an `offsetParent !== null` filter — if `OnboardingPage`'s `display: flex; flex-direction: column` is somehow set to `display: none` in any state, that filter would drop the candidate. The plan's CSS never sets `display: none`, so this is theoretical, but worth mentioning.

### A3. Phishing / clickjacking — plan's analysis is correct

The onboarding tab is at `chrome-extension://<id>/src/onboarding/index.html`. MV3 frame-ancestors default forbids embedding extension URLs in web content (`X-Frame-Options` is moot here, the browser blocks it at the WebRequest layer). Width changes don't shift any URL-trust signal. The plan's assessment at [`plan.md:219-220`](plan.md) is accurate.

### A4. Mid-onboarding deploy visual shift — acknowledged but understated

The plan notes that "a user who has the onboarding tab open during update would see the layout shift" and dismisses it as acceptable because the tab is short-lived. But the tab IS the first-impression surface: if a release rolls out mid-create, the layout pops 480→640 mid-flow. With the current architecture, the SW restart on extension reload would refresh the tab anyway (MV3 reload semantics), so the shift would happen as a full reload, not a live mutation. That's actually *less* jarring than the plan implies — the tab reloads from welcome, the user re-enters the flow. The risk is more "users who took a screenshot for their notes will see two layouts". Acceptable.

### A5. Reduced motion / color scheme — no regression

`packages/extension/src/onboarding/app.vue:32-35` already wires `applyTheme` and listens for `prefers-color-scheme` changes. The plan does not touch this. The existing `shakeInput` keyframe at `create.vue:390-397` and `import.vue:518-525` is unaffected. `prefers-reduced-motion` is not respected by these keyframes today — that's a pre-existing gap, NOT introduced by this plan. Out of scope.

### A6. `window.close()` flow in `done.vue` — plan correctly leaves the script untouched

The plan limits the `done.vue` change to "delete `.page` style, replace outer `<Flex>` with `<OnboardingPage>`, standardize top margin". The `openWallet` flow at `packages/extension/src/onboarding/pages/done.vue:23-67` (SW message → `setTimeout(window.close, 50)`) is in `<script setup>` and untouched. Verified: the e2e at `packages/extension/tests/e2e/onboarding-tab.test.ts:67-90` reads `chrome.storage.local.get("nulo:onboarding:completed")` post-click, which gates on script behavior, not template shape. Safe.

### A7. Supply chain — plan correctly claims zero new deps

No new packages added. Verified by reading the plan in full — only edits to `*.vue` files + a new `*.vue` + a new `*.test.ts`. No `package.json` change implied.

## Correctness findings

### C1. File paths in the plan are accurate

Verified against the repo:
- `packages/extension/src/onboarding/pages/{welcome,create,import,learn,accelerator,done}.vue` — all exist.
- `packages/extension/src/onboarding/components/StepIndicator.vue` — exists.
- `packages/extension/tests/e2e/onboarding-tab.test.ts` — exists.

Width values in the plan's table at [`plan.md:26-34`](plan.md) match the source (`welcome.vue:66` → 480, `create.vue:293` → 480, `import.vue:465` → 560, `learn.vue:75` → 880, `accelerator.vue:162` → 560, `done.vue:114` → 440, `StepIndicator.vue:52` → 560).

### C2. StepIndicator diff is safe

`packages/extension/src/onboarding/components/StepIndicator.vue:46-54` currently:

```css
.row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  width: 100%;
  max-width: 560px;
  margin: 0 auto 16px;
}
```

Dropping `max-width: 560px` + changing `margin: 0 auto 16px` → `margin: 0 0 16px` is safe because:
- Inside a 640 px container, the indicator goes from "560 px centered" (with 40 px on each side) to "640 px filled". The 4 cells get 8 px more each. Visual gain.
- Inside an `align-items: center` parent (welcome / done), the indicator with `width: 100%` still spans the full container.

But wait — done.vue and welcome.vue currently set `align-items: center` on the page. Inside `align-items: center`, a child with `width: 100%` still spans full width (cross-axis fills). So the indicator looks the same on welcome/done as on the others. Confirmed safe.

### C3. `<OnboardingPage>` API is under-specified

The plan declares `defineProps<{ align?: "start" | "center"; gap?: number }>()` and references `:style="gapVar"` in the template — but the API spec at [`plan.md:67-79`](plan.md) does not define `gapVar`. The reader has to guess that it's a computed `() => ({ '--onboarding-page-gap': gap ? \`${gap}px\` : undefined })`. This is a 4-line `computed` block missing from the plan. Implementation will have to invent it; the audit should be able to verify it.

Also: `<style module>` block at [`plan.md:87-99`](plan.md) sets `gap: var(--onboarding-page-gap, 32px)` — this means `gap` prop omitted = 32 px, `gap=40` = 40 px. Fine. But the type is `number` — passing `gap=56` works as `:gap="56"`, while `gap="32"` would be a type error. The plan's `import.vue` example at [`plan.md:147`](plan.md) says "standardize to 32 via default", which implies omitting the prop. That works.

### C4. Vue's `<style module>` requires `useCssModule()` for dynamic style — NOT a problem here

The plan's `:class="[$style.page, align === 'center' && $style.center]"` does not need `useCssModule()` because `$style` is auto-injected. Fine. But `:style="gapVar"` needs `gapVar` to be a reactive computed (or just a plain object — Vue accepts both). Either works. The plan should make this explicit.

### C5. The `flex: 1` invariant for welcome.vue is silently dropped

`packages/extension/src/onboarding/pages/welcome.vue:65-71`:

```css
.page {
  max-width: 480px;
  width: 100%;
  margin: 32px auto 0;
  gap: 56px;
  flex: 1;
}
```

`flex: 1` is the load-bearing line that lets the page fill the remaining viewport height inside `app.vue#shell` (which is `display: flex; flex-direction: column; min-height: 100vh`). Combined with `.footer { margin-top: auto }` at `welcome.vue:97-103`, this pins the footer ("By continuing, you are confirming...") to the bottom of the viewport.

`OnboardingPage`'s style block at [`plan.md:87-99`](plan.md) sets `display: flex; flex-direction: column; max-width: 640px; margin: 24px auto 0; gap: var(--onboarding-page-gap, 32px)` — **no `flex: 1`**. After the migration, `welcome.vue`'s footer will collapse up against the actions button (because there's no flex stretching the page to fill height).

This is the single biggest correctness miss in the plan. Either:
- (a) `OnboardingPage` sets `flex: 1` unconditionally (might affect other pages — done.vue has `margin: 48px auto 0` and no footer-bottom expectation, but unintended `flex: 1` is benign for forms),
- (b) `OnboardingPage` exposes a `fillHeight` boolean prop that welcome alone uses,
- (c) `welcome.vue` keeps a local `.shell { flex: 1 }` wrapper around the slot content (regresses the "single source of truth" goal).

(a) is the cleanest answer. `flex: 1` on every onboarding page means each page takes the available height; for short pages (create / accelerator) the gap above the page-end is just extra viewport — same as today. Verified mentally: today's create / import / accelerator pages don't `flex: 1`, but they ALSO don't pin anything to the bottom. So adding `flex: 1` universally is harmless except for the welcome+done case where it *fixes* footer pinning.

### C6. The 6 test cases is borderline — push back on cases 1, 2, and 6 being effectively redundant

The plan's 6 cases at [`plan.md:182-189`](plan.md):
1. Default props render — `.page` applied, `.center` not applied, var fallback to 32.
2. `align="start"` is the default — explicit `align="start"` matches no-prop output.
3. `align="center"` adds the center class.
4. `gap` prop maps to the CSS var.
5. Default slot renders.
6. `max-width` is on the component's root.

Cases 1, 2, 6 are largely the same observation through three lenses (default rendering). Case 6 is brittle because asserting "max-width on the root via class-name snapshot" gets snapshot-noisy with hashed CSS module names — JSDOM doesn't compute `max-width`, so the test would only inspect class names or inline styles. The test can't actually prove `max-width: 640px` is on the element; it can only prove the `.page` class is on the root. That's already case 1.

Push back: drop case 2 and case 6, add:
- **Case A**: assert root tag name is `'DIV'` (locks down the [A1] fix above; if the implementation drifts to `<main>`, the test fails).
- **Case B**: assert the `gap` prop with value `0` does NOT regress to default (numeric `0` is falsy in JS — naive `gap ? \`${gap}px\` : undefined` would treat `gap=0` as omitted and render 32 px instead of 0 px). This is a Vue prop / coercion footgun the plan currently has no protection against.

That keeps the count at 6 but with materially-different cases.

### C7. Auto-import via `unplugin-vue-components` is wired for `src/onboarding/components/`

`packages/extension/vite.config.ts:174-177`:

```ts
useComponents({
  dirs: ["src/components", "src/onboarding/components"],
  dts: "src/types/components.d.ts",
}),
```

Confirmed — the plan's parenthetical at [`plan.md:178`](plan.md) ("we'll verify this also applies to `src/onboarding/components/` and add an explicit import if not") can drop the qualifier. It is wired. `<OnboardingPage>` will be auto-imported in all 6 page templates without explicit imports.

**Caveat for tests** — `packages/extension/vitest.config.ts` does NOT register `useComponents`. Component tests must explicitly `import OnboardingPage from "./OnboardingPage.vue"` and any child components (Flex, Text, etc.) need to be stubbed via `global.stubs` per the CLAUDE.md L4-coverage convention. The plan doesn't mention this. Add it.

## Trade-off findings

### T1. 640 px is justifiable, but the math at [`plan.md:158`](plan.md) is off by ~10%

Plan claims "3 × ~205 px usable card width inside 640 px". Actual math:
- 640 px container − 1 px border each side (`learn.vue:96-97`: `border: 1px solid var(--nulo-border)`) = 638 px content.
- 3 cards with 2 × 1 px gaps = 638 − 2 = 636 px / 3 = 212 px per card.
- Each card has 24 px padding each side = 212 − 48 = **164 px usable text width per card**.

164 px (not 205 px) is the actual text-render width inside each card. At 13 px body font with the existing copy:
- "Public and private state" (24 chars) at 13 px = ~165 px width unaffected by line-height — would just fit, possibly wrap to 2 lines.
- "Proofs on your machine" (22 chars) at 16 px title = ~190 px width — **would wrap**. Title at 16 px / 700 weight is bolder, takes more horizontal space.
- The body text ("Aztec runs smart contracts with both public state and private state...") at 13 px / 150% line height would be ~12–13 chars per line ≈ 13 lines for the first card. Visually cramped.

The plan's mental math is too optimistic. The 3-card grid at 640 px will look claustrophobic vs today's 880 px. The grid breakpoint shift from 720 → 560 is correct (otherwise the cards stack), but the in-card legibility at 164 px is the load-bearing concern.

**Suggest**: either bump to 680–700 px (closer to learn.vue's natural 720 breakpoint, slightly above the plan's 640) OR keep 640 px and reduce card padding from 24 px → 16 px on the sides (gains 16 px per card = 180 px usable, still tight but closer to the plan's claim). The plan should at least acknowledge this is "verify visually before merge" rather than asserting it works.

### T2. 8 px gap change on import.vue is a visible regression

`packages/extension/src/onboarding/pages/import.vue:295` currently uses `<Flex direction="column" gap="24" :class="$style.page">` — the gap is 24 px between the back button, StepIndicator, hero, name input, method picker, and submit buttons. Plan's [`plan.md:147`](plan.md) standardizes to 32 px via the default.

That's an 8 px increase between EVERY pair of sibling elements in the import flow. With 6+ siblings, the page's overall content height grows by ~40–50 px. On 1080 × 720 viewport (the smallest common laptop), the form might suddenly require a scroll where it didn't before.

**Suggest**: either preserve `gap=24` on `import.vue` by passing `:gap="24"` (which the API supports) OR confirm visually that 32 px doesn't push content below the fold on 1080 × 720.

### T3. `done.vue` top margin change is bigger than acknowledged

`packages/extension/src/onboarding/pages/done.vue:114-117` currently has `margin: 48px auto 0` (48 px top). Plan's OnboardingPage defaults to `margin: 24px auto 0` — that's a 24 px loss of top breathing room.

The plan at [`plan.md:162`](plan.md) says "If the visual breathing room loss is a problem, add `pt-32` to the hero block instead of the page wrapper". This is a conditional escape hatch that the plan author should just decide now. Either:
- (a) Add `pt-32` to done's hero up-front.
- (b) Pass `:pt="48"` or similar prop (more API surface — probably not worth it).
- (c) Accept the 24 px loss as "tighter == more modern".

The plan should pick. Don't punt to "if visually a problem".

### T4. Welcome's bigger gap (56) is the most-stretched case

Plan's `:gap="56"` for welcome is correct. But notice that welcome currently has:
- gap=56 between hero and actions.
- gap=16 INSIDE hero (the `<Flex direction="column" align="center" gap="16">` at `welcome.vue:23`).

Migrating to `<OnboardingPage>` keeps the inner Flex's gap=16. The 56 only applies between top-level slot children. Verified — the migration preserves the visual rhythm.

## Things the plan missed

### M1. Smoke e2e filter does NOT trigger on `src/onboarding/**` changes

`packages/extension/.github/workflows/pr-smoke-e2e.yml:34-91` defines the `smoke-surface` filter. Reading the filter at lines 36-80, the included paths are:
- `packages/extension/src/popup/**`
- `packages/extension/src/components/**`
- `packages/extension/src/composables/**`
- `packages/extension/src/stores/**`
- `packages/extension/src/design/**`
- `packages/extension/src/assets/styles/**`
- ... (wallet services, setup, core, utils, shims, types)
- `packages/extension/tests/e2e/*.test.ts`

**Conspicuously absent: `packages/extension/src/onboarding/**`.**

The plan claims at [`plan.md:209`](plan.md) "Smoke e2e / Status — touches the smoke-surface filter (onboarding pages), so it will run; must pass." That's factually wrong. Onboarding-only changes do NOT trigger the smoke filter — the PR would need an explicit `e2e:smoke` label OR a manual `workflow_dispatch`.

**Fix**: either (a) update the smoke filter to include `packages/extension/src/onboarding/**` as part of this PR, or (b) explicitly label the PR `e2e:smoke` and call it out in the PR description.

### M2. `gapVar` is referenced but never defined

[`plan.md:82`](plan.md):

```vue
<main :class="[$style.page, align === 'center' && $style.center]" :style="gapVar">
```

There is no `gapVar` declared anywhere in the API spec. Implementation will have to invent the computed. Reasonable inventions include:

```ts
const gapVar = computed(() => (props.gap !== undefined ? { '--onboarding-page-gap': `${props.gap}px` } : undefined))
```

But this has the `gap=0` footgun mentioned in C6 if anyone writes `props.gap ? ...` instead of `props.gap !== undefined`. The plan should spell this out so the implementer doesn't take a shortcut.

### M3. The `<header>` semantic inside create/import/learn — preserved, no regression

`packages/extension/src/onboarding/pages/create.vue:187-190` uses `<header :class="$style.hero">`. Same for `import.vue:306-310`, `learn.vue:34-40` (uses `<Flex>` not `<header>` — already a minor a11y miss in current code). `accelerator.vue:72-80` also uses `<Flex>` not `<header>`.

The plan doesn't touch any of these — `<OnboardingPage>` wraps but doesn't re-tag inner content. Good.

But notice: if `<OnboardingPage>` is a `<main>`, then `<header>` inside `<main>` is valid semantically. If `<OnboardingPage>` is a `<div>`, then `<header>` is still valid (just less informative). The choice doesn't break the inner `<header>` — only the outer landmark count. Doesn't move the [A1] decision either way.

### M4. `learn.vue` has 1 px gap between cards — relying on `background: var(--nulo-border)` as the divider color

`packages/extension/src/onboarding/pages/learn.vue:91-97`:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--nulo-border);
  border: 1px solid var(--nulo-border);
}
```

The grid uses `gap: 1px` and the GRID's background color shows through the 1 px gap. Tightening the container to 640 px doesn't change this — the dividers will still render. But at 164 px wide cards, a 1 px gap will visually almost-disappear. Not a bug, just worth knowing.

### M5. `vitest.config.ts` does not include `useComponents` plugin — test file needs explicit imports

The component test must explicitly `import OnboardingPage from "./OnboardingPage.vue"`. The plan's mention of "Auto-import via Vue's `unplugin-vue-components` should pick up the new component" at [`plan.md:178`](plan.md) applies to RUNTIME imports in `.vue` files, NOT to test files. Tests need explicit imports.

Plan should add a one-line note in the test plan section.

### M6. No SSR / dark-mode snapshot coverage for the new component

CLAUDE.md says L4/L5/L6 don't require test coverage. `OnboardingPage` is best classed as L3-ish (it has 2 props, slot, no service deps) — but it lives in `src/onboarding/components/`, outside the L0-L6 popup tree. The plan's 6 cases all run in JSDOM with light theme implicit. There's no test that exercises:
- `theme="dark"` on `<html>` (just visual confirmation — JSDOM doesn't compute styles, so a "dark mode renders" test would be a no-op anyway).
- `prefers-color-scheme: dark` listener — but `OnboardingPage` doesn't subscribe to theme, so N/A.

Acceptable. The plan's risk model handles theme correctly.

### M7. No mention of HMR behavior during dev

During `bun --cwd packages/extension dev`, Vite HMR swaps the `<OnboardingPage>` template/style on save. Components with `<style module>` sometimes don't HMR cleanly (stale CSS module hash references). This is a dev-loop concern, not a correctness concern. Worth mentioning in validation.

## Specific edits suggested

1. **`implementations-plan/onboarding-width-unification/plan.md` — pick the root tag explicitly.**
   Replace the `<main>` in the template snippet at [`plan.md:82`](plan.md) with `<div>` (the safe default). Update the prose at [`plan.md:103-104`](plan.md) to state the decision is `<div>`, with rationale: "`app.vue#shell` is already the page's `<main>` — nesting another `<main>` violates HTML5 + WAI-ARIA-1.2".

2. **`implementations-plan/onboarding-width-unification/plan.md` — define `gapVar` explicitly in the API spec.**
   Replace the snippet at [`plan.md:67-100`](plan.md) with:

   ```vue
   <script setup lang="ts">
   const props = defineProps<{
     align?: "start" | "center"
     gap?: number
   }>()

   // gap !== undefined check, not gap ? : — otherwise gap=0 silently regresses to 32 px default.
   const gapVar = computed(() =>
     props.gap !== undefined ? { "--onboarding-page-gap": `${props.gap}px` } : undefined,
   )
   </script>

   <template>
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
     flex: 1;  /* preserve welcome.vue's footer-pinning behavior */
   }
   .center {
     align-items: center;
   }
   </style>
   ```

3. **`implementations-plan/onboarding-width-unification/plan.md` — fix the test plan to lock the root tag + the `gap=0` footgun.**
   Replace the 6 cases at [`plan.md:182-189`](plan.md) with:

   1. Default props render — `.page` class applied, no `.center` class, `--onboarding-page-gap` resolves to fallback 32 px (assert via inline style absent + class snapshot).
   2. `align="center"` adds the center class.
   3. `gap=40` maps to `style="--onboarding-page-gap: 40px"` on the root.
   4. `gap=0` maps to `style="--onboarding-page-gap: 0px"` (NOT fallback). Locks the `props.gap !== undefined` check.
   5. Default slot renders the passed content.
   6. **Root element tagName === 'DIV'** — locks down a11y guarantee. If a future refactor swaps in `<main>` or `<section>`, this test fails.

4. **`packages/extension/.github/workflows/pr-smoke-e2e.yml:36` — add `packages/extension/src/onboarding/**` to the smoke-surface filter (separate PR, ahead of this one OR in this PR).**

   ```diff
              # Popup + components (UI shell)
              - 'packages/extension/src/popup/**'
   +          - 'packages/extension/src/onboarding/**'
              - 'packages/extension/src/components/**'
              - 'packages/extension/src/composables/**'
   ```

   Then the plan's claim at [`plan.md:209`](plan.md) becomes accurate. Without this, the plan should explicitly state "PR will be labeled `e2e:smoke` to force the smoke gate".

5. **`implementations-plan/onboarding-width-unification/plan.md:147` — decide on import.vue's gap.**
   Either change "standardize to 32 via default (a 8-px change)" to "preserve 24 px via `:gap=\"24\"`" OR add a validation step that asserts the form remains above-the-fold at 1080×720.

6. **`implementations-plan/onboarding-width-unification/plan.md:162` — decide done.vue's top margin now.**
   Replace "If the visual breathing room loss is a problem, add `pt-32`" with the actual decision. Suggested: keep the OnboardingPage's 24 px default + add 24 px `padding-top` to done's hero to compensate. Or just accept 24 px.

7. **`implementations-plan/onboarding-width-unification/plan.md` — add a note that the test file needs explicit imports for child stubs.**
   After [`plan.md:191`](plan.md), add a line: "vitest.config.ts does NOT register `useComponents` — test file uses explicit imports for `OnboardingPage` and stubs any auto-imported children via `global.stubs`."

8. **`implementations-plan/onboarding-width-unification/plan.md:158` — soften the legibility claim.**
   Replace "verified mentally against `Text size=\"13\" height=\"150\"` ≈ 25–30 chars/line" with "the card's text-render width inside 640 px is 164 px (640 − 2 border − 2 gaps − 6 × 24 padding) / 3 cards = 212 px outer minus 48 px padding. Confirm visually before merge that '01 / Public and private state / Aztec runs smart contracts...' wraps to 2–3 readable lines, not 5+. If too cramped, bump container to 680 px or reduce per-card padding to 16 px."

9. **`implementations-plan/onboarding-width-unification/plan.md` — add an e2e assertion for "one `<main>` per page".**
   In the validation section at [`plan.md:200`](plan.md), append: "After implementation, add a smoke e2e assertion at `packages/extension/tests/e2e/onboarding-tab.test.ts` that walks each route and asserts `document.querySelectorAll('main').length === 1`. Locks the [A1] decision under CI."

10. **`implementations-plan/onboarding-width-unification/plan.md` — clarify rollback scope.**
    The rollback section at [`plan.md:243-245`](plan.md) is correct but could note that **if the smoke-surface filter is updated in step 4 above**, rollback also reverts that PR. Otherwise the filter remains in the "broader" state, which is harmless (smoke runs more often) but worth recording.
