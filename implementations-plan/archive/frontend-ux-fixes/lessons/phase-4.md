# Phase 4 — Address-input read affordance (#2)

**Status:** ✓ complete (code + gate green; the at-rest scroll behavior gets the human visual sign-off at P5b).

## What changed
- **New** `src/components/composite/general/AddressInput.vue` — a thin TRANSPARENT wrapper over the shared
  `<Input>`. On the inner input's blur it resets `inputEl.scrollLeft = 0` so a long `0x…` value reads from
  the START at rest (`0x3333…`, via the Input's existing `text-overflow: ellipsis`), instead of staying
  scrolled to the end ("the address goes to the left and we don't see anything"). 10 component tests.
- Applied to the three address-TYPING fields: `EditContactPopup.vue` + `NewContactPopup.vue` (the
  `label="Address"` inputs) and `RecipientField.vue` (the send raw-recipient input). `<Input>` → `<AddressInput>`.
- `RecipientField.test.ts` stub renamed `Input` → `AddressInput` (the template now uses the wrapper).

## Design decisions
- **`scrollLeft = 0` on blur, NOT an overlay or value rewrite.** The plan/audit floated a blur→truncated
  overlay; the scroll-reset achieves the same user-visible result (truncated-from-start at rest, full
  editable on focus) with far less code and zero positioning brittleness. Crucially it **never rewrites
  the model value** — paste, selection, the `[data-testid="send-destination-field"] input` e2e selector,
  and screen readers are all untouched (the audit's explicit requirement). The native `<input>` stays
  mounted (transparent wrapper, not a `v-if` swap).
- **Extension-side wrapper, NOT a `@nulo/design/Input` change** (decision ledger): the wrapper hooks
  `Input`'s exposed `inputEl` (via `defineExpose({ inputEl, focus })`) + its `blur` emit. No package edit.
- **`placeholder` declared (default "") on the wrapper** so vue-tsc sees Input's one REQUIRED prop
  satisfied; everything else (label, sanitize, v-model, autofocus, `#right`/`#suffix` slots, @focus/@blur)
  passes through via `inheritAttrs:false` + `v-bind="$attrs"` + a `v-for $slots` forwarder + declared
  `blur`/`focus` emits (so the parent's handlers still fire, after the scroll reset).

## Validation gate — PASSED
- `bun run --cwd packages/extension test -- run src/components/composite/general/AddressInput src/popup/components/modules/send/RecipientField` → 15 passed.
- `bun run typecheck:all` → exit 0. `bun run lint` → exit 0 (baseline 51 warnings).
- `bun run build` → exit 0 (`components.d.ts` gains `AddressInput`; 3 new components total this PR).
- `bun run test:e2e` (contacts + registration — contact-address + send-recipient inputs) → 6 passed.

## Lessons
- **jsdom has no layout**, so the `scrollLeft`-reset can't be visually unit-tested — assert the CONTRACT
  instead (stub the Input to expose a mutable `inputEl`; set `scrollLeft=99`, trigger blur, assert it's 0).
  The real at-rest rendering goes to the human visual sign-off (P5b).
- **A transparent wrapper over a component with a REQUIRED prop fails vue-tsc** even with `v-bind="$attrs"`
  (vue-tsc type-checks the explicitly-bound props, not $attrs). Fix: declare the required prop(s) on the
  wrapper and forward them explicitly.
- **Stubs that use `setup(_, { expose })` need `defineComponent`** to satisfy the `@vue/test-utils`
  `Stubs` type (a bare object-literal stub with a typed `setup` isn't assignable; `noExplicitAny` blocks
  the `as any` escape).

LESSONS_FILE=implementations-plan/frontend-ux-fixes/lessons/phase-4.md
