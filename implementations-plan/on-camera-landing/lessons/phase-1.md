# Phase 1 — foundation

Gate run 2026-09-06, all green:

- `bun install` → "no changes" beyond the new workspace link; `bun.lock` +3 lines. `bun install --frozen-lockfile` exit 0. No peer warning: `vue` was already locked (3.5.41), so `@nulo/design`'s peer resolved silently, as the audit predicted.
- `bun run --cwd apps/landing typecheck` exit 0 (`ensure-release-json` wrote the no-release stub first).
- `bun run --cwd apps/landing test` → 3 passed (the existing resolver tests).
- `bun run lint` exit 0; `biome check apps/landing` → 15 files, clean.
- `bun run --cwd apps/landing build` → 55 ms. Emitted: `InterVariable` 352.24 kB, `MaterialSymbolsOutlined` 343.62 kB, `JetBrainsMono-latin` 31.34 kB, `SpaceGrotesk-latin` 22.32 kB, `SpaceGrotesk-latin-ext` 18.92 kB. The CSS references every face as `url(/assets/<name>-<hash>.woff2)`, so the `_headers` immutable rule for `/assets/*` applies. Material Symbols is declared but nothing on the page uses the family, so a browser never fetches it (verified at Phase 3's cold-load check).

Notes:
- Running `bun run build` from the repo root builds the extension, not the landing (root `build` script). Every landing command is `bun run --cwd apps/landing <script>`; the tool shell's cwd resets between calls, so the prefix is not optional.
- `main.ts` imports `page.css` and `feed-dom.ts` from the start; both are stubs until Phases 2–3 so the build gate is real at every phase.
