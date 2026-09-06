---
plan: on-camera-landing
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 1 agent · codex high · code-review off
status: draft
---

# On Camera — rebuild `apps/landing` as the feed page

Replace nulo.sh with the "On Camera" design approved in the study rounds: a full-bleed CCTV feed rendered in characters, every readable element on a solid plate, plain-language copy about the user's control, the private/public split as two screens, three promises, the live public record, the preview notice, and the CTA. Vanilla Vite + TypeScript, no framework, no library, no WebGL. Tokens and fonts come from `@nulo/design/base.css`.

The prototype this implements is the published artifact "Nulo On Camera" (v3: continuous wall, grounded record). Its source is the reference for markup, copy and the renderer; this plan turns it into shippable code under the repo's rules.

## Scope

**In**
- `apps/landing` only: `index.html` body, styles, `main.ts`, a new pure renderer module with unit tests, the package dependency on `@nulo/design`, the landing README, the plans index.
- Keep: the `<head>` meta/OG/canonical block (title and description updated to the new copy), the four release-template tokens and their plugin, `public/_headers` (CSP unchanged), `sitemap.xml`, `robots.txt`, the prebuild release fetch.
- The old demo banner's facts move into the preview-notice plate (owner's Phase 0 answer: full replacement).

**Out**
- Extension, tools, packages: untouched. No CI workflow changes (a landing build job is a follow-up, noted below). No Cloudflare dashboard changes. No popup captures.
- The designer's-notes section of the prototype is not shipped.

## Architecture & Implementation

**Shape.** Three source concerns, one page:

1. `src/feed.ts` — pure, DOM-free renderer. `createField(seed)` builds two 64×64 value-noise lattices from a seeded PRNG (mulberry32, so tests are deterministic). `renderFrame(field, opts)` returns one string of `rows` lines × `cols` glyphs: value noise blended over time, an optional brighter "subject" blob, a gain curve, then Bayer 4×4 ordered dithering into the five-glyph ramp `' .:+%'`. `subjectAt(t, cols, rows)` gives the blob centre so the DOM layer can place the tracking box from the same numbers the frame used. Every function stays under the 15-cognitive / 80-line budgets.
2. `src/feed-dom.ts` — the wiring. Measures the mono cell width from a probe span after `document.fonts.ready` (2.5 s fallback), sizes the grid to the host, mounts three feeds (hero with subject, mini public-feed panel, fixed background grain at low gain), runs one `requestAnimationFrame` loop capped at ~30 fps that skips hosts off-screen (IntersectionObserver) and stops while `document.hidden`; `prefers-reduced-motion` renders one frame and no loop. Also owns the hero clock, the tracking box position and its cycling label, and the public-record stream (nodes built with `createElement`/`textContent`, never `innerHTML`).
3. `index.html` + `src/styles/{overrides,page}.css` — markup and styling of the v3 prototype. `overrides.css` loads right after `@nulo/design/base.css` and corrects what a landing cannot inherit (recon §"What base.css does"): `a { color: inherit }` plus a visible `:focus-visible` ring, `body { user-select: text }`, `*::-webkit-scrollbar { display: revert }`, and aliases the page variables onto design tokens (`--bg: var(--app-bg)`, `--ink: var(--txt-primary)`, `--mute: var(--nulo-secondary)`, `--dim: var(--nulo-outline)`, `--red: var(--red)`, fonts via `--font-headline/--font-body/--font-mono`). `page.css` holds the plate rule, bar, hero overlay, sections, notice, CTA, footer, breakpoints.

**Data & control flow (critical path).** Load → CSS (package `@font-face`, hashed into `/assets/`) → `main.ts` → `mountPage()` → fonts ready → measure cell → initial frames for the three feeds and the record panel → loop. The release plugin substitutes `{{release_url}}` at build time as today.

**File-level change map.**

| Action | Path |
|---|---|
| modify | `apps/landing/package.json` (+ `dependencies["@nulo/design"] = "workspace:*"`), `bun.lock` |
| modify | `apps/landing/index.html` (head: title/description; body: full rewrite) |
| modify | `apps/landing/src/main.ts` (imports + `mountPage()`) |
| add | `apps/landing/src/feed.ts`, `apps/landing/src/feed.test.ts`, `apps/landing/src/feed-dom.ts` |
| add | `apps/landing/src/styles/overrides.css`, `apps/landing/src/styles/page.css` |
| delete | `apps/landing/src/reveal.ts`, `src/styles/{tokens,base,layout,sections,animations}.css`, `public/fonts/*` (4 files), the two `<link rel="preload">` font hints |
| modify | `apps/landing/README.md` (file map, key notes), `implementations-plan/index.md` |

**Trade-offs.** A `<canvas>` glyph renderer would be faster per frame but loses text semantics, complicates font timing and buys nothing at ~170×52 cells (a frame is ~9 k characters; string building is well under 2 ms). Keeping the landing's own tokens (no dependency) was the cheaper option; the owner chose the dependency so the palette cannot drift, and the cost is the override file plus ~180 kB of extra CSS/fonts the page does not use (utilities, Material Symbols). If that weight matters later, the follow-up is a slimmer `@nulo/design/tokens.css` export, not a landing-side fork.

## Phases

### Phase 1 — Foundation: dependency, base stylesheet, overrides, fonts
- Add `@nulo/design` to `apps/landing/package.json` dependencies; `bun install` (not frozen — the lockfile changes and is committed).
- `main.ts` imports `@nulo/design/base.css` then `./styles/overrides.css`; write `overrides.css`.
- Remove the landing's `@font-face` blocks, `public/fonts/*` and the preload links; confirm Space Grotesk / Inter / JetBrains Mono render from the package.
- Assumptions: the `vue` peer of `@nulo/design` only warns at install; Vite hashes the package fonts into `/assets/` so `_headers`' immutable cache applies.

**Validation gate**
- Commands: `bun install && bun run --cwd apps/landing typecheck && bun run --cwd apps/landing test && bun run lint && bun run --cwd apps/landing build`
- Pass: all exit 0; `apps/landing/dist/assets/` contains the three woff2 families; `bun install --frozen-lockfile` then exits 0 (lockfile consistent).
- Layers: typecheck · lint · unit · build.

### Phase 2 — Renderer: `feed.ts` + tests + `feed-dom.ts`
- Implement `createField`, `renderFrame`, `subjectAt`, `BAYER4`, `RAMP` as pure functions; then the DOM layer (measure, size, loop, visibility, reduced motion, clock, box, label cycle, record stream).
- `feed.test.ts` (vitest node): frame has exactly `rows` lines of exactly `cols` glyphs; every glyph ∈ ramp; same seed + time ⇒ identical frame; different time ⇒ different frame; the subject blob raises mean density in its cell neighbourhood versus the same frame without it; gain 0 ⇒ all spaces.
- Assumptions: no jsdom is needed (DOM code is untested by design, matching `reveal.ts` today).

**Validation gate**
- Commands: `bun run --cwd apps/landing typecheck && bun run --cwd apps/landing test && bun run lint`
- Pass: exit 0; `feed.test.ts` reports ≥ 6 passing cases; no complexity findings.
- Layers: typecheck · lint · unit.

### Phase 3 — Page: markup, styles, wiring, deletions
- Rewrite `index.html` body from the v3 prototype (nav bar, hero feed + overlay + plate, two screens, three promises, recording, notice, CTA, footer); `{{release_url}}` on "Add to Chrome" (bar, hero, CTA) and "Releases"; "Tools" → `https://testnet.tools.nulo.sh`; "Source on GitHub" → the repo; "How it works" → `#see`.
- Write `page.css`; delete `reveal.ts` and the five old stylesheets; `main.ts` calls `mountPage()`.
- `<pre>` feeds are `aria-hidden`; an sr-only sentence describes the hero; the record panel is `aria-live="off"`.
- Assumptions: `text-wrap: balance`, `mask-image`, `box-decoration-break` pass Biome's CSS lint (the existing landing CSS already uses modern properties).

**Validation gate**
- Commands: `bun run --cwd apps/landing typecheck && bun run --cwd apps/landing test && bun run lint && bun run --cwd apps/landing build && grep -c '{{' apps/landing/dist/index.html`
- Pass: exit 0 on the four commands; the grep prints `0`; then `bun run --cwd apps/landing preview` and a Playwright screenshot at 1400×900 and 390×844 shows the hero feed populated, the plate and both buttons legible, no console errors.
- Layers: typecheck · lint · unit · build · manual visual.

### Phase 4 — Docs, index, final pass
- `apps/landing/README.md` file map and key notes (renderer, overrides, fonts from the package, no CI build job); `implementations-plan/index.md` entry; lessons.
- Re-read every visible string against the copy rule (no "notes", "proofs", "nullifier", "self-custody" above the fold; technical words only in the record panel).

**Validation gate**
- Commands: `bun run --cwd apps/landing typecheck && bun run --cwd apps/landing test && bun run lint && bun run --cwd apps/landing build`
- Pass: exit 0; README's file map lists every file in `apps/landing/src`.
- Layers: typecheck · lint · unit · build.

## Security & Adversarial Considerations

- **Threat model.** A public static page. Attack surface: what it loads, what it executes, what it claims. No auth, no user data, no forms.
- **CSP stays as is** (`public/_headers`: `script-src 'self'`, `font-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`). No inline `<script>`, no CDN, no remote fonts; the renderer and fonts ship in the bundle. Verified by the Phase 3 build and preview (a CSP violation shows in the console).
- **DOM injection.** Everything dynamic is written with `textContent` or `createElement`; no `innerHTML` with generated strings. Hashes are random hex, not data.
- **Resource use.** One rAF loop at ≤ 30 fps, paused off-screen and when the tab is hidden; reduced motion renders one frame. A phone gets ~9 k characters per frame, well inside budget.
- **Supply chain.** No new npm package; one workspace dependency. `bun.lock` is committed; CI installs `--frozen-lockfile`.
- **Claims.** Copy states private-by-default, public-by-choice, labelled; password or passkey; testnet; not audited. Each is true of the current build. The preview-notice plate keeps the old banner's warnings.
- **Clickjacking / MIME / referrer** headers unchanged.
- **Accessibility as adversarial reading.** Screen readers skip the art; the headline and buttons are real elements in DOM order.

## Assumptions

**Facts**
1. `apps/landing/package.json` has scripts `dev`, `build` (prebuild fetches the release), `typecheck`, `test` (`bun --bun vitest run`) and no `dependencies` block.
2. `apps/landing/scripts/release-html-plugin.ts` substitutes exactly `{{chrome_zip_url}}`, `{{version}}`, `{{release_url}}`, `{{shasums_url}}` and throws if a known token survives; tokens absent from the HTML are fine.
3. `apps/landing/public/_headers` sets `script-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'`.
4. `packages/design/package.json` exports `"./base.css"`; `apps/tools/src/main.ts:3` imports it as `import "@nulo/design/base.css"` with no plugin.
5. `packages/design/src/base.css` sets `*::-webkit-scrollbar { display: none }` (248–250), `a { color: var(--blue) }` and `a:focus { outline: none }` (252–259), `body { user-select: none }` (275–283), and declares Space Grotesk, InterVariable, JetBrains Mono and Material Symbols `@font-face`s (11–43).
6. `biome.json` enforces cognitive complexity ≤ 15 and ≤ 80 lines per function repo-wide; `**/*.test.ts` is exempt from the line cap only.
7. `.github/workflows/pr-quick.yml` runs lint-and-typecheck (`bun run lint`, `bun run typecheck:all`) and unit-tests (`bun run test:all`) unconditionally; its `landing` filter is dead (106–108). No workflow builds the landing.
8. `apps/landing/vitest.config.ts` uses `environment: "node"`; the only test is `release-resolver.test.ts`.
9. Required checks on `dev` are `quality-status`, `network-e2e-status`, `smoke-e2e-status`; the two e2e statuses emit pass when their filters do not match (CLAUDE.md § Branching, § In CI).

**Inferences**
- `bun install` with `@nulo/design`'s unmet `vue` peer warns rather than fails under Bun 1.4's isolated linker (verified at Phase 1's gate; if it fails, the fallback is `peerDependenciesMeta.vue.optional` in `packages/design/package.json`, a one-line change surfaced before making it).
- Vite emits the package's `url("./fonts/…")` as hashed `/assets/*.woff2`, so the existing immutable cache rule applies.
- Cloudflare Pages' `nulo` project builds with `bun run build` in `apps/landing` under `BUN_VERSION` ≥ 1.4 (it deploys today's landing, whose prebuild is the same script); the added workspace dependency needs the repo root install it already performs.
- Biome's CSS lint accepts the modern properties used (`text-wrap`, `mask-image`, `box-decoration-break`); the Phase 3 gate proves it.

**Asks** (resolved by default; the approval gate confirms)
- Update `<title>` to `NULO | Nothing to see. Everything to own.` and the meta/OG description to the hero's plain line. Default: yes.
- Drop the `{{version}}` display entirely (the old page never showed it either). Default: yes.

## Post-implementation hardening

Not scheduled. The page has no trust boundary beyond its CSP; `/harden` is not warranted.

## Post-implementation

Executed by the implementing session from this file. `code_review` is `off`: `/code-review` is not run.

1. **Codex audit** (`/codex high`): send the net diff from the plan baseline (`git diff bde7fc7c...HEAD`), this `plan.md`, `recon.md`, and the asks: adversarial/security review of a public static page (CSP, injection, resource use, claims), plus the two rules below.
2. **Iterative fix loop**: verify each factual claim against the repo before acting; apply accepted fixes; commit; log the round (consult + verdict) in `lessons/phase-N.md`; resume the same codex session with the fix diff and ask for a re-review. Repeat until a round yields no new material findings. Still material after 3 rounds: stop and surface.
3. **Delivery** (below): open the PR only after the loop converges.

**No-over-engineering rule** (verbatim in every codex prompt): "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."

**Comment-quality rule** (verbatim in every codex prompt): "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."

## Delivery

Single arc, single PR. Branch `worktree-on-camera-landing` → `dev`, opened with `gh pr create` after the codex loop converges. Title (≤ 93 chars): `feat(landing): rebuild nulo.sh as the "on camera" feed page`. `code_review: off`. Then `gh pr checks --watch`: a red `quality-status` is fixed on the branch; a red e2e status on a landing-only diff is a flake to re-run. Merge is the owner's call (squash, per the dev ruleset). The Cloudflare `nulo` project deploys production from `main`, so the page goes live at the next promote; PR pushes get a Pages preview if the project has previews enabled.

**Follow-up (not in this PR):** a `build-landing` job in `pr-quick.yml` gated on the existing `landing` filter, so a broken `vite build` fails before Cloudflare sees it.

## Audit — codex

_Pending._

## Seeds

Recommended: `/goal` (completion is transcript-observable: ✓ markers, gate output, codex convergence, PR checks).

```
/goal All four phases marked ✓ in implementations-plan/on-camera-landing/plan.md, each ✓ backed by its validation gate reported passing in the transcript; `LESSONS_FILE=implementations-plan/on-camera-landing/lessons/phase-N.md` printed for each phase; `/code-review` NOT run (code_review is off); the codex fix loop converged on the net diff, evidenced by a resumed codex pass reporting no new material findings quoted in the transcript; one PR from worktree-on-camera-landing to dev exists (`gh pr view` in the transcript), created only after the loop converged; `gh pr checks` reports every required check green in the transcript; `bun run --cwd apps/landing test` and `bun run lint` both report exit 0 in the transcript.
```

Fallback: `/loop 15m` with the standard blueprint driver prompt, `<lint>` = `bun run lint`, `<test>` = `bun run --cwd apps/landing test`.
