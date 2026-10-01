# Phase 0 — Contrast gate (RED) + undefined-var guard + Storybook theme-matrix

## What landed
- `packages/design/src/theme-contrast.ts` — WCAG helper. Resolves the **token-reference graph** in base.css (token→token→literal, `:root` + `[theme]` override on one element), parses hex / rgb(a) / `color-mix(in srgb, C P%, transparent)`, flattens alpha over a named bg, computes WCAG 2.x ratio. **Deliberately NOT a cascade resolver** (the repo's own `faucet/app.css.parity.test.ts:19` documents that jsdom can't do that) — it's an asserted token-pairing checker.
- `packages/design/src/theme-contrast.test.ts` — the curated pairing table. **Dark = required** (freeze-guard). **Light palette pairs = xfail** via `test.fails` while `LIGHT_ENFORCED=false`; Phase 2 flips the flag → required. Plus 2 root-cause pins (removed at Phase 2).
- `packages/design/src/theme-vars.ts` + `theme-vars.test.ts` — reusable undefined-var guard (owned-namespace `var(--x)` must be declared in base.css) + the **design self-scan** (green). Extension/faucet wire it in Phases 1/3.
- `packages/extension/.storybook/preview.ts` — replaced the misleading background-only switch with a `globalTypes.theme` toolbar that sets the **real `theme` attribute** on `<html>` (so `[theme=…]`-gated styles + token values both apply).

## Gate result (PASS)
- `bun run --cwd packages/design test` → **265 passed | 4 expected-fail | 1 skipped** (37 files). Contrast gate present, dark GREEN, light palette xfail-RED, undefined-var guard GREEN (design), and the existing `tokens.parity`/`tokens.drift`/`utilities.drift`/`base.css` SHA all still green (base.css untouched).
- `bun run --cwd packages/design typecheck` → exit 0. `biome check` → clean (after auto-format).
- `bun run --cwd packages/extension build-storybook` → built successfully with the theme toolbar.

## RED demonstration (the point of Phase 0)
The 4 light palette pairs fail contrast TODAY (`test.fails` passing): `--txt-primary`/`--txt-secondary` on `--nulo-surface` + `--nulo-surface-low` (dark-on-dark), and `--txt-inverse` on `--nulo-accent` (white-on-cream). Two pins prove the cause: `--nulo-surface` resolves to `#141312` in light (dark fallthrough); `--border` resolves to a dark value (the `base.css:132` mis-alias to `--nulo-surface-highest`).

## Lessons / decisions
- **A contrast gate can't catch "dark-on-dark looks fine."** `--nulo-secondary`/`--nulo-surface` PASSES in light today because BOTH fall through to dark together (good contrast, wrong colours). So xfail pairs must mix a *correct* light token (e.g. `--txt-primary`, which IS overridden in light) with a *fallen-through* one. Moved `--nulo-secondary`/`--nulo-surface` to an `ENFORCE_ONLY` bucket (skipped until Phase 2, then required) — it guards the muted-text legibility the audit flagged (M2) without false-failing now.
- **Dynamic var construction is real.** `Icon.vue:47` builds `var(--txt-${props.hoverColor})`. The guard regex captured a dangling `--txt-`; fixed by skipping captures ending in `-` (template interpolation, not a static token).
- `test.fails` is the xfail mechanism (confirmed in vitest 4.1.5, per the final-codex re-review). The `LIGHT_ENFORCED` flag is the single switch Phase 2 flips.
