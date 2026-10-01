# Phase 2 lessons — F1 onboarding fee-juice step + indicator redesign

## Outcome

`feat(onboarding): add fee-juice + private-fee-juice step; expand indicator to 5 cells` — typecheck clean, 2014/2021 vitest passing (+6 new StepIndicator cases), `bun run lint` clean on staged files. New onboarding step shipped with the StepIndicator widened from 4 cells to 5 (`Setup / Aztec / Fees / Speed / Done`), `learn.vue`'s shared `goNext` handler split into two intent-specific handlers, and the e2e walk-through updated to traverse the new step.

## Files changed

- `onboarding/components/StepIndicator.vue` — type prop widened from `1 | 2 | 3 | 4` to `1 | 2 | 3 | 4 | 5`. Steps array gains the new `{ num: "03", label: "Fees" }` entry. CSS grid `repeat(4, 1fr)` → `repeat(5, 1fr)`. Comment header updated to reflect the new layout. Welcome stays indicator-free (unchanged).
- `onboarding/pages/learn.vue` — `goNext` split into `goContinue` (→ `/onboarding/fees`) and `goSkip` (→ `/onboarding/accelerator`). Two template `@click="goNext"` references rewired separately. The Skip route is unchanged (still bypasses fees + accelerator gate); the Continue route moves into the new step.
- `onboarding/pages/accelerator.vue` — `:current="3"` → `:current="4"` (Speed cell index).
- `onboarding/pages/done.vue` — `:current="4"` → `:current="5"` (Done cell index).
- `onboarding/pages/fees.vue` — NEW. Mirrors `learn.vue` structurally (brutalist 3-card grid, OnboardingPage shell, Continue + Skip CTAs). Copy: "Fee juice / Private fee juice / Sponsored fees" — short declarative cards, no jargon. Both Continue and Skip route to `/onboarding/accelerator` (skip semantics = "I've read enough"; the user can revisit fee details from the wallet's fee-settings panel later).
- `onboarding/components/StepIndicator.test.ts` — NEW. 6 cases pinning: 5-cell render + label set + numeric prefix + `aria-current` placement at `current=1`, `current=3` (the new Fees cell), `current=5` (Done) + nav `aria-label`. Each case load-bearing per the L1 primitive minimum.
- `tests/e2e/onboarding-tab.test.ts` — Updated happy-path walk-through to click through `/onboarding/fees` between learn and accelerator.

## What broke during impl (and the fix)

### 1. Vitest from repo root fails to parse `.vue` files

```
Error: Failed to parse source for import analysis because the content contains invalid JS syntax.
Install @vitejs/plugin-vue to handle .vue files.
```

Root cause: vitest config is `packages/extension/vitest.config.ts`. Running `bunx vitest run …` from the repo root picks up vitest's default config (no Vue plugin) instead. Earlier F4 tests were on pure-TS files so the issue didn't surface.

**Fix:** prefix vitest invocations with `cd packages/extension &&`. The pre-commit hook + CI run vitest from the package dir already, so this only affects local dev.

**Generalisation:** workspace tests with cwd-rooted config (`vitest.config.ts` lives in the package) MUST be invoked from that package's cwd. Putting `cd packages/extension &&` in front of every vitest invocation is the safe pattern.

### 2. Component tests on `fees.vue` / `learn.vue` are deferred

Pages depend on auto-registered children (OnboardingPage, StepIndicator, BrutalistTitle, Flex, Text, Button). Mounting them in unit tests requires stubbing each — fragile, easy to drift. Per CLAUDE.md L5/L6 minimums (component tests "not required; covered by e2e + manual smoke"), the e2e walk-through is the canonical coverage for routing semantics. The dedicated split-handler regression is pinned by the e2e's `waitForHash(page, "#/onboarding/fees", 10_000)` assertion — if Continue ever stops routing into the fees step, the test fails.

**Decision:** ship F1 with StepIndicator.test.ts (the load-bearing component test) + the updated e2e (the integration test). Skip standalone fees.test.ts / learn.test.ts.

## What confirmed working at the end

- `vue-tsc --noEmit` clean (no regression from the type widening).
- 2014/2021 vitest cases pass (was 2008 pre-F1; +6 StepIndicator cases). 7 todos, no fails.
- `bun run lint` clean on staged F1 files (biome auto-fix not triggered this round).
- `bun run audit:vue` deferred to the F4 lessons; for F1 the typecheck + targeted tests + full suite are sufficient.
- StepIndicator's type widening — `1 | 2 | 3 | 4` → `1 | 2 | 3 | 4 | 5` — silently caught at typecheck for any consumer that hardcoded the narrower union. None did.

## Open items for downstream phases

None — F1 is self-contained. F3 (canceled-tx details) is the next phase; no F1 → F3 coupling.
