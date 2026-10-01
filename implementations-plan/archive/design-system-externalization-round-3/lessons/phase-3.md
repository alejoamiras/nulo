# Phase 3 — Retire AppButton + migrate DripButton

**Status:** ✓ DONE (machine-green; the faucet DripButton visual — `AppButton` outline → `Button`
`primary_outline` — rides with P4's sign-off, but both are brutalist outline buttons so the delta is
small, mirroring the round-2 faucet cutover).

## What shipped
- **DripButton migrated** (`composite/DripButton.vue`): `<AppButton variant="outline">` →
  `<Button variant="primary_outline">`. **MANDATORY disable-on-loading (codex HIGH):** AppButton
  disabled-on-loading INTERNALLY (the test pinned `disabled` defined while loading + "does NOT emit
  click while loading"); `Button` does NOT, so DripButton now passes `:disabled="disabled || loading"`
  explicitly. Kept `:data-loading` (e2e probe), `:aria-label`, `@click`, slot.
- **AppButton DELETED** — `AppButton.vue` + `AppButton.test.ts` (`git rm`) + its `index.ts` export. It
  had exactly one consumer (DripButton); no other importer.
- **DripButton.test.ts** re-pointed the 3 AppButton-specific assertions to Button equivalents: the
  loading spinner is now the package `Spinner` (`[role="status"]`, ×2) not `.btn__spinner`; the variant
  class check is `/primary_outline/` (CSS-module hashed) not `.btn--outline`. The disable-on-loading +
  data-loading + aria-label + click-guard pins all PASS unchanged (the explicit `:disabled` preserves
  the semantics).

## Validation gate — PASS
`bun run typecheck:all` → 0 · `bun run --cwd packages/design test` → 243 (−5 = AppButton's own tests
removed) · `bun run test:faucet` → 343 · `bun run lint` → 0 · `bun run build:faucet` + `bun run build`
→ 0. No `AppButton` reference remains in `packages/*/src` (grep empty). Orthogonal type-file regen
churn (components.d.ts/auto-imports) restored to dev baseline — P4 owns the components.d.ts change.

LESSONS_FILE=implementations-plan/design-system-externalization-round-3/lessons/phase-3.md
