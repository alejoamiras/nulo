# Phase 2 — Spinner family (superset + SpinnerLegacy freeze + Banner + LoadingState)

**Status:** ✓ green. Branch: `chore/design-r2-p1-guardrails` (P1+P2 stacked; one PR).

## What shipped
- **Canonical `Spinner` superset** (`packages/design/src/ui/Spinner.vue`): extension visuals (4s
  multi-rotate, `size: string | number`, `color` with `--`→`var()`) + the package's
  `role="status"`/`aria-label` a11y + **default `color: currentColor`** (was the extension's
  `--txt-inverse`; currentColor keeps color-less callers stable, esp. the faucet). Rewrote
  `Spinner.test.ts` (6 cases).
- **`SpinnerLegacy.vue`** (+ export, + minimal test): verbatim copy of the pre-round-2 package Spinner
  (0.75s, currentColor). The faucet's 2 `<Spinner>` sites (`WalletPanel`/`BridgeWalletPanel`, aliased
  `SpinnerLegacy as Spinner`) + `AppButton.vue`'s internal spinner ride it → faucet visually FROZEN
  until P7 (D-FAUCET-DEFER).
- **Banner + LoadingState** migrated into `packages/design/src/ui/` with explicit imports
  (`Flex`/`Icon`/`Text`/`Spinner`); ported tests (Banner 7, LoadingState 5); `data-testid="loading-state"`
  preserved. Local extension SFCs + tests deleted; 3 stories relocated into the package.
- Registries: `index.ts` (+Banner/LoadingState/SpinnerLegacy), `mount-all.test.ts` (+3, Banner with
  `isLoading:true` to exercise the Spinner branch), `design-resolver.ts` + its inventory test
  (+Spinner/Banner/LoadingState). `OperationCard.vue:285` (the 1 color-less extension Spinner site)
  got explicit `color="--txt-inverse"` to stay delta-free under the new currentColor default.
- `tsconfig.json`: exclude `src/**/*.stories.ts` from the package's vue-tsc (Storybook types aren't a
  package dep; the extension's storybook builds them via Vite).

## Lessons / gotchas
- **Round-1 left the migrated local SFCs in place** (`core/Flex.vue`, `ui/Badge.vue`, … still exist
  with full implementations), and `useComponents({ dirs: ["src/components"] })` dir-scans them, so the
  generator points those names at LOCAL paths — round-1's committed `components.d.ts` (→`@nulo/design`)
  is aspirational, and the dir-scan actually wins for them. **Round-1 cleanup debt** (delete the dead
  round-1 locals so the extension truly consumes the package) — NOT P2 scope. P2 *deletes* its own
  migrated locals, so Spinner/Banner/LoadingState genuinely route to `@nulo/design`.
- Kept the `components.d.ts` diff minimal (3 entries → `@nulo/design`, matching round-1's committed
  convention) instead of committing the build's full regen (which flips round-1 names to local).
  Restored the build's unrelated regen of `auto-imports.d.ts` + `.eslintrc-auto-import.json` (stale
  `toRestoreError` from prior commit 10ae086 — not P2's scope) to HEAD.
- Vue folds `borderTopColor` into the `border-color` shorthand → assert on the resolved color, not a
  longhand property name (Spinner default-color test).

## Validation gate — green
- `bun run typecheck:all` → 0. `bun run --cwd packages/design test` → 159 passed.
  `bun run test` → 2435 passed (3 test files moved to the package). `bun run test:faucet` → 343 passed.
  `bun run lint` → 0. `bun run build` → built (regenerates dts ephemerally). `bun run build:faucet` → built.
- `bun run test:e2e` (smoke) → 18 files pass; **1 pre-existing flake** in `import-paths.test.ts`
  (`full backup: duplicate-address rejection`): `TypeError: ctx.browser undefined` — a cross-file
  browser-context cascade under the full run. **Classified pre-existing per A1:** (1) P2 modified ZERO
  files under `tests/e2e/**` (e2e suite == dev), (2) `import-paths.test.ts` passes **8/8 in isolation**
  on this branch, (3) the failing test's domain (full-backup import) has 0 refs to Spinner/Banner/
  LoadingState. No NEW smoke failures.
- Human visual: faucet is FROZEN (no faucet delta in P2 — sign-off deferred to P7); extension Spinner
  sites preserved by design (explicit colors + OperationCard `--txt-inverse`). Machine gate green.
