# Audit — onboarding width unification (codex)

Reviewer: codex CLI at `xhigh` reasoning effort, read-only sandbox.
Plan under review: [`implementations-plan/onboarding-width-unification/plan.md`](plan.md).
Session: `019e4c09-bf02-7ca0-8650-b69e2baf7d3b`.

> Codex could not write this file itself (read-only sandbox in the run). Findings transcribed verbatim by the orchestrating agent. The opus subagent audit in [`audit-opus.md`](audit-opus.md) was prepared independently and concurrently.

## Verdict

**Yellow** — the `640px` shared wrapper is the right direction, but the plan is not implementation-ready as written.

## Findings

### 1. `welcome.vue` will visually regress unless `flex: 1` survives the wrapper swap

The legal footer only stays pinned low today because `.page` grows inside the shell.

- [`packages/extension/src/onboarding/pages/welcome.vue:65-70`](../../packages/extension/src/onboarding/pages/welcome.vue) — `.page { ...; flex: 1 }`
- [`packages/extension/src/onboarding/pages/welcome.vue:97-103`](../../packages/extension/src/onboarding/pages/welcome.vue) — `.footer { margin-top: auto; ... }`
- [`packages/extension/src/onboarding/app.vue:104-113`](../../packages/extension/src/onboarding/app.vue) — `.shell { display: flex; flex-direction: column; min-height: 100vh; padding: 24px 24px 64px }`

Drop the wrapper without preserving `flex: 1` and the legal copy collapses up against the action buttons.

### 2. The `learn.vue` breakpoint proposal is wrong in real layout terms

`@media (max-width: 560px)` is **viewport**-based, but the onboarding shell consumes `48px` horizontally (`app.vue:111` — `padding: 24px 24px 64px`). The page max-width is 640, so for any viewport ≥ 688 px the page renders at full 640 px width. Below 688 px the page is narrower than 640. A `(max-width: 560px)` viewport rule would keep 3-column rendering at viewports `561–687 px` where the page itself is *already narrower than 640 px* and the cards are uncomfortably squeezed.

The plan's "~205 px usable card width" claim also **ignores each card's `24px` side padding** at [`packages/extension/src/onboarding/pages/learn.vue:91-110`](../../packages/extension/src/onboarding/pages/learn.vue), where `.card { padding: 24px }` is set. The actual usable text width is much smaller than the plan suggests.

The right answer is to switch the grid's stack-trigger to a CSS **container query** on the `<OnboardingPage>` (`container-type: inline-size`) so the layout responds to the container's actual width, not the viewport. Pure viewport queries cannot get this right without explicitly accounting for the shell's `24+24=48px` padding.

### 3. The `OnboardingPage` spec is internally inconsistent

- The snippet at [`plan.md:81-85`](plan.md) renders `<main>` even though `app.vue` already owns the page-level `<main>` at [`app.vue:75`](../../packages/extension/src/onboarding/app.vue) — nested `<main>` is an HTML5 + WAI-ARIA-1.2 violation.
- It references an undefined `gapVar` — there is no `gapVar` declared in the `<script setup>` block of the spec.
- The suggested `pt-32` fallback for `done.vue` at [`plan.md:162`](plan.md) does not exist in this CSS-module setup — there is no Tailwind utility class system here. Padding must come from a CSS-module class or an inline style.

## What this means

The 640 px target, the shared component approach, and the StepIndicator change all stand. But the plan must be revised — see [`plan.md`](plan.md) "Audit reconciliation" section — before implementation begins.
