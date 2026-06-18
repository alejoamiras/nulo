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

## Result — Phase 1 COMPLETE ✓

All sub-tasks done. Validation gate (all green):
- `bun run typecheck:all` → exit 0, all 12 `@nulo/*` packages (extension re-export resolves).
- `bun run lint` → exit 0 (53 pre-existing advisory warnings; none in the new files).
- Tests: `packages/design` 69 (incl. `tokens.drift` byte-pin + `boundary` chrome/floor guards) ·
  `bun run test:faucet` 336 · `bun run test` (extension) 2398. All green.
- `bun run build` (extension, crxjs chrome) + `bun run build:faucet` → both exit 0.

Implementation notes vs the plan's loose wording:
- Token source is `src/token-contract.ts`; the pure renderer is `src/internal/render-tokens.ts`; the
  Bun CLI is `scripts/gen-tokens.ts` (kept out of `src/**` so `Bun.write`/top-level-await don't reach
  vue-tsc). `src/tokens.ts` is the generated, byte-pinned artifact.
- The extension's `src/design/tokens.ts` is now `export * from "@nulo/design/tokens"` — the full token
  surface matched the package's generated one, so there were NO ext-only members to keep (zero churn).
- Drift test reads the generated file via Vite `?raw` (jsdom `import.meta.url` isn't a `file://` URL);
  a one-line `*?raw` + `import.meta.glob` shim lives in `src/raw.d.ts`.
- Core/ui layer enforcement is a self-contained biome override (re-includes the `@nulo/*` + chrome
  floor) so override-merge can't drop the floor for `core/**`.
- CI: added `packages/design/**` to the `extension` + `faucet` filters in `pr-quick.yml`, and to the
  `pr-smoke-e2e.yml` + `pr-network-e2e.yml` filters (design feeds both apps now). actionlint runs in CI.

Commits on the branch: blueprint docs · token core · seam re-export · boundary guards · (this) CI+docs.
Next: Phase 2 (base/theme/font takeover) — SUPERVISED, needs the user's visual sign-off.
