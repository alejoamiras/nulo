# @nulo/landing

Marketing landing page for the wallet (nulo.sh). Standalone Vite app; ships independently of the extension.

## File map

| Path | Purpose |
|---|---|
| `index.html` | The whole page: head/meta, the camera-feed hero, the two-screens section, three promises, the illustrative public record, the preview notice, CTA, footer. All copy lives here, before any script runs. |
| `src/main.ts` | Vite entry: imports the stylesheets in order and mounts the page. |
| `src/feed.ts` | Pure renderer for the character "camera feed": seeded value noise, an optional bright subject, Bayer 4×4 dithering into a five-glyph ramp. DOM-free; unit-tested in `feed.test.ts`. |
| `src/feed-dom.ts` | Wiring: measures the mono cell after fonts load, sizes each `pre[data-feed]` to its host, runs one ~30 fps loop (skips off-screen and hidden-tab, scales the grid up past its cell cap so any screen is covered, honours reduced motion), and drives the clock, tracking box and record stream. |
| `src/release.ts`, `src/release-resolver.ts` | Typed access to the build-time release info (`src/generated/release.json`). |
| `src/styles/overrides.css` | The few corrections a web page needs on top of `@nulo/design/base.css` (link colour, focus ring, selectable text, visible scrollbars). |
| `src/styles/page.css` | Page presentation: plates, bar, hero overlay, sections, breakpoints. |
| `scripts/headers.ts` | Parses the site-wide block of `public/_headers` so `vite preview` serves the production CSP. |
| `scripts/release-html-plugin.ts` | Substitutes `{{release_url}}` and friends into `index.html` at build; throws if a known token survives. |
| `scripts/fetch-latest-release.ts`, `scripts/ensure-release-json.ts` | Prebuild fetch of the latest GitHub release; the no-release stub for typecheck/test. |
| `public/` | `_headers` (CSP and caching, applied by Cloudflare), favicon, robots, sitemap. |
| `vite.config.ts` | Vite config, including `preview.headers` from `_headers`. |
| `wrangler.jsonc` | The `nulo-landing` Worker: static assets from `dist/`, unknown paths served `index.html` (released wallets deep-link to `/forms/*`), Workers Logs off. No `routes` until `nulo.sh` moves off Pages. |

## Scripts

| Command | Effect |
|---|---|
| `bun run dev` | Local dev server (`bun run dev:landing` from the repo root → port 5175). |
| `bun run build` | Production build → `dist/`. |
| `bun run preview` | Preview the production build with the production response headers. |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run test` | Unit tests (renderer, headers parser, release resolver). |
| `bun run deploy:dry` | Validate `wrangler.jsonc` against the built `dist/`; needs no credentials. |
| `bun run deploy`, `bun run deploy:preview` | What Workers Builds runs for production (`main`) and for other branches. By hand only to create the Worker. |

## Key notes

- **No framework, no library.** Vanilla DOM + Vite. The feed is text in a `<pre>`, redrawn as a string; no canvas, no WebGL.
- **Tokens and fonts come from `@nulo/design/base.css`** (declared as a workspace dependency), so the site and the wallet share one palette. Vite hashes the package fonts into `/assets/`; only the faces the page uses are fetched. `overrides.css` undoes the popup-specific globals; add page styling to `page.css`, never to the package.
- **Two design rules.** Copy, buttons and panels sit on solid plates; section headings sit on the grain with a dark halo. The grain runs behind every section uninterrupted.
- **Copy rule.** No wallet jargon above the fold; the technical words (nullifier, commitment, log) appear only inside the public-record panel, which is labelled illustrative because its values are generated locally.
- **CSP.** `public/_headers` is the policy; preview applies it too. No inline scripts, no CDN, no remote fonts.
- **Independent ship.** Builds and deploys from `main` without the extension: Cloudflare Pages serves `nulo.sh` today, and the `nulo-landing` Worker (Workers Builds) takes it over at the cut-over. Both rebuild on the release's deploy hook, because `prebuild` reads the latest release. CI lints, typechecks and unit-tests this package on every PR, and builds it when the PR touches it or `legal/`.

## Legal pages

`/terms`, `/privacy` and a permalink per version (`/terms/v1.0/`) are generated from
[`legal/*.md`](../../legal/README.md) by `scripts/build-legal.ts`, which `predev` and `prebuild` run.
The outputs (`terms.html`, `privacy.html`, `terms/`, `privacy/`, `src/generated/legal-pages.json`)
are gitignored; `vite.config.ts` reads the JSON list as its extra HTML entries. Rendering rules —
raw HTML rejected, `.md` links rewritten, DRAFT banner + `noindex` while a placeholder survives — are
in `scripts/legal-pages.ts` and pinned by `scripts/legal-pages.test.ts`. `quality-status` builds the
landing on every PR that touches it or `legal/`.
