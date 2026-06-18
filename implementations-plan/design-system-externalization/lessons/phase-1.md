# Phase 1 — Seam + single-source token contract + drift + CI wiring

Branch: `feat/design-system-p1-tokens`. Machine-gated (autonomous).

## Sub-tasks
- [ ] `src/token-contract.ts` — canonical token NAMES + scales + durations (from `_base.scss` +
      the extension's `design/tokens.ts`).
- [ ] `src/internal/render-tokens.ts` — pure renderer (contract → tokens.ts string). Typechecked + testable.
- [ ] `scripts/gen-tokens.ts` — Bun CLI (`bun run gen:tokens`): render + write `src/tokens.ts`. Lives
      OUTSIDE `src/` so vue-tsc (include: `src/**`) doesn't choke on Bun globals.
- [ ] `src/tokens.ts` — GENERATED, committed.
- [ ] `src/tokens.drift.test.ts` — byte-pin: `renderTokensModule() === read("src/tokens.ts")`.
- [ ] extension `src/design/tokens.ts` → re-export `@nulo/design` (+ any ext-only members).
- [ ] add `@nulo/design: workspace:*` to extension deps; add `./core` + `./ui` exports + `gen:tokens` script.
- [ ] biome: internal `core/`+`ui/` layer rules + chrome-indirection audit test + floor meta-test.
- [ ] CI: patch `pr-quick.yml`, `pr-smoke-e2e.yml`, `pr-network-e2e.yml` path-filters → `packages/design/**`.
- [ ] `packages/design/README.md`.
- [ ] Gate: typecheck:all + lint + tests + build + build:faucet.

## Decisions / notes
- **Generator structure (vs the plan's loose "gen-tokens"):** the *render* fn lives in
  `src/internal/render-tokens.ts` (pure, typechecked, unit-tested via the drift test); the *Bun CLI*
  lives in `scripts/gen-tokens.ts` (NOT in tsconfig `include`, so `Bun.write`/top-level-await don't
  fail vue-tsc). `tokens.ts` is a standalone generated module (groups inlined, not a re-export), so it
  typechecks under `src/**` with no cross-dir runtime import. This is the approved generated+byte-pin
  mechanism, just structured around the package's jsdom/`src/**`-only tsconfig.
- **Phase 1 contract = names + scales + durations only.** Per-theme VALUES (for base.css generation)
  are added in Phase 2 and validated by `base.parity` there — don't author unvalidated value data now.
- Confirmed from `_base.scss`: `--purple: #5856de` IS declared (3 theme blocks) → in the contract.
  `--gray-15` (referenced by `_text.scss:57` `color--dark`) is declared NOWHERE → the ghost; handled
  look-preservingly in the Phase-3 `Text` rewrite (not here).
- biome formatting: `render-tokens.ts` emits tab-indented / double-quoted / trailing-comma output to
  match the existing `tokens.ts`; verified `biome check` is a no-op on the generated file so the
  byte-pin and lint agree.
