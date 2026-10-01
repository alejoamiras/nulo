# Recon — on-camera-landing

Phase 0.4 findings, base `bde7fc7c` (origin/dev). One read-only explorer, batched over nine capabilities. Its shell was blocked by the worktree isolation guard, so absence claims below come from full-file reads of the named files rather than `grep`; the trail says what was read.

## Reuse map

| Capability | Found | Verdict | Notes |
|---|---|---|---|
| Consume `@nulo/design/base.css` from a non-Vue app | `packages/design/package.json` exports `./base.css`; `apps/tools/src/main.ts:3-4` imports it before the app CSS | **adapt** | The import itself needs no Vue plugin, polyfill or resolver. The CSS content fights a landing page and must be overridden (below). |
| Isolated-linker declaration | `CLAUDE.md` "The linker is isolated"; `apps/tools/package.json:40` | **adapt** | `apps/landing/package.json` has no `dependencies` today; add `"@nulo/design": "workspace:*"` and re-lock. `@nulo/design` peers on `vue` — verify `bun install` only warns. |
| Release-URL templating, scripts, tsconfig, CSP, sitemap | `apps/landing/scripts/*.ts`, `src/release*.ts`, `tsconfig.json`, `public/_headers` | **reuse-as-is** | Keep the four `{{tokens}}` names exactly; the plugin throws if a known token survives. Absent tokens are fine. |
| CI coverage | `pr-quick.yml` (lint-and-typecheck, unit-tests run unconditionally); the `landing` paths filter is dead | **reuse-as-is** | Landing lint, typecheck and unit tests already run on every PR. `vite build` runs nowhere in CI — it is a local gate in this plan. |
| Cloudflare Pages deploy | `refresh-landing.yml`, `release.yml` `refresh-landing` job (deploy-hook POST) | **reuse-as-is** | Build command, root dir and `BUN_VERSION` are dashboard-only. No landing `build.json`; `verify-live` can only check reachability. |
| Text / dither / noise renderer | none. Read: `apps/landing/src/{main,reveal}.ts`, all three app `package.json`s, `packages/design/package.json`, `CLAUDE.md` | **build new** | Closest analog is the static SVG `feTurbulence` grain in `apps/landing/src/styles/base.css:94-110`, which the feed replaces. |
| Landing test shape | `apps/landing/src/release-resolver.test.ts` | **reuse-as-is** | `vitest` node environment, no jsdom: the renderer's pure functions are what get tested. |
| Complexity budgets | `biome.json` top-level rules; test override drops only the line cap | **constraint** | Renderer functions ≤ 15 cognitive, ≤ 80 lines; tests keep the cognitive cap. |
| `noConsole` | `biome.json` override scoped to `apps/extension/src/**` | **non-issue** | |

## What `@nulo/design/base.css` does to a page that imports it

Quoted from `packages/design/src/base.css`:

- `:root { color-scheme: dark; --font-body: "InterVariable", … }` (70–121) — the landing's own `--font-body` is `"Inter"`; whichever `:root` rule loads last wins.
- `*::-webkit-scrollbar { display: none }` (248–250) — hides the page scrollbar.
- `a { text-decoration: none; color: var(--blue) }` and `a:focus { outline: none }` (252–259) — links go blue, focus ring disappears.
- `button { padding: 0; border: none; outline: none }` (261–266).
- `body { font-family: "InterVariable", …; user-select: none }` (275–283) — text becomes unselectable.
- Four `@font-face` blocks (11–43): InterVariable, Space Grotesk (two files), JetBrains Mono, Material Symbols. The landing self-hosts Space Grotesk and Inter under `public/fonts` with preloads in `index.html`; importing base.css doubles the font payload unless those are removed.
- `utilities.css` (`.fz--N`, `.fw--N`, `.gap--N`, `.color--*`, …) and a transition-class zoo (285–383). Unused classes cost bytes, not behaviour.

Resolution in this plan: import base.css first, then a landing `overrides.css` that restores `a { color: inherit }`, a visible focus ring, `body { user-select: text }`, `*::-webkit-scrollbar { display: revert }`, and maps the page's own variables onto design tokens (`--bg: var(--app-bg)` …). Delete the landing's `@font-face` blocks, `public/fonts/*`, and the preload links; fonts come from the package, hashed into `/assets/`.

## Absence trail

- No dither/Bayer/ASCII/noise/canvas helper: read in full `apps/landing/src/main.ts`, `src/reveal.ts`, `apps/landing/package.json`, `apps/tools/package.json`, `apps/extension/package.json`, `packages/design/package.json`, `CLAUDE.md`. No `requestAnimationFrame` use outside `reveal.ts`'s scroll effects.
- No landing build job: read in full `.github/workflows/pr-quick.yml`, `_lint-and-typecheck.yml`, `_unit-tests.yml`, `CI.md`.
- No landing-specific `biome.json` override: every override block read.
