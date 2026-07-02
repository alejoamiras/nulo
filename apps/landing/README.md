# @nulo/landing

Marketing landing page for the wallet. Standalone Vite app; ships independently of the extension.

## File map

| Path | Purpose |
|---|---|
| `index.html` | Page entry. |
| `src/main.ts` | Vite entry; bootstraps the page. |
| `src/reveal.ts` | Scroll-reveal logic for sections. |
| `src/styles/` | Vanilla CSS. |
| `public/` | Static assets. |
| `vite.config.ts` | Vite config. |

## Scripts

| Command | Effect |
|---|---|
| `bun run dev` | Local dev server (`bun run dev:landing` from the repo root → port 5175). |
| `bun run build` | Production build → `dist/`. |
| `bun run preview` | Preview the production build. |
| `bun run typecheck` | `tsc --noEmit`. |

## Key notes

- **No framework.** Vanilla DOM + Vite. The page is small; reactivity would add weight without benefit.
- **Independent ship.** This package builds and deploys without the extension. Nothing else in the monorepo depends on it.
- **No backend.** The page is fully static.
