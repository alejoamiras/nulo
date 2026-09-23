# Phase 1 — `Skeleton` primitive

**Gate (2026-09-17):** `bun run lint` exit 0 · `bun run typecheck:all` exit 0 · `bun run --cwd packages/design test` 39 files / 327 tests passed · `bun run --cwd apps/extension test src/popup/components/modules/general/GasBalanceCard scripts/design-resolver` 2 files / 20 tests passed.

## Lessons

- **The resolver inventory is pinned.** `apps/extension/scripts/design-resolver.test.ts` asserts `NULO_DESIGN_COMPONENTS` equals `EXPECTED_MIGRATED` exactly, so a new package-native primitive must be added to both in the same commit. `Skeleton` never had a local SFC, so the "no local shadow" check passes trivially.
- **`mount-all.test.ts` needs an explicit case per SFC** — it is the only guard against a missing explicit import inside a package SFC (the package has no auto-import).
- **Visual parity is more than the box.** The first draft used a `surface-low → surface-high` gradient with the `--bezier` easing; the gas card's existing shimmer is `surface-high → surface → surface-high`, 1.5 s, default easing. Adopting the draft would have changed how the gas card reads — an unapproved UI change. The primitive now reproduces the existing shimmer exactly; the only addition is the `prefers-reduced-motion` opt-out.
- `fee-shared.module.css` keeps its own `.skeleton` — other Send surfaces still compose it. Migrating them is outside this plan's UI-impact table.
