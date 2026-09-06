---
plan: on-camera-landing
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 1 agent · codex high · code-review off
status: approved 2026-09-06 (conditional: copy per Asks 1–2) — implementing
---

# On Camera — rebuild `apps/landing` as the feed page

Replace nulo.sh with the "On Camera" design approved in the study rounds: a full-bleed CCTV feed rendered in characters, every readable element on a solid plate, plain-language copy about the user's control, the private/public split as two screens, three promises, an illustrative public record, the preview notice, and the CTA. Vanilla Vite + TypeScript, no framework, no library, no WebGL. Tokens and fonts come from `@nulo/design/base.css`.

The approved prototype is committed beside this plan as `prototype.html` (the artifact "Nulo On Camera", v3). It is the reference for markup, copy and the renderer; this plan turns it into shippable code under the repo's rules, with the copy corrections in Assumptions → Asks.

## Scope

**In**
- `apps/landing` only: `index.html` body, styles, `main.ts`, a new pure renderer module with unit tests, the package dependency on `@nulo/design`, a `preview.headers` block in `vite.config.ts`, the landing README, the plans index.
- Keep: the `<head>` meta/OG/canonical block (title and descriptions updated together), the skip link and `<main>` landmark, the four release-template tokens and their plugin, `public/_headers` (CSP unchanged), `sitemap.xml`, `robots.txt`, the prebuild release fetch.
- The old demo banner's facts move into the preview-notice plate, reworded per the Asks (full replacement per the owner's Phase 0 answer).

**Out**
- Extension, tools, packages: untouched. No CI workflow changes (a landing build job is a follow-up). No Cloudflare dashboard changes. No popup captures. The prototype's designer's-notes section is not shipped.

## Architecture & Implementation

**Shape.** Three source concerns, one page:

1. `src/feed.ts` — pure, DOM-free renderer. `createField(seed)` builds two 64×64 value-noise lattices from a seeded PRNG (mulberry32). `renderFrame(field, opts)` returns one string of `rows` lines × `cols` glyphs: value noise blended over time, an optional brighter "subject" blob, a gain curve, then Bayer 4×4 ordered dithering into the five-glyph ramp `' .:+%'`. `subjectAt(t, cols, rows)` returns the blob centre so the DOM layer places the tracking box from the same numbers the frame used. Small named helpers (prng, lattice sample, smooth interpolation, subject intensity, quantize) keep every function under the 15-cognitive / 80-line budgets; `renderFrame` assembles rows.
2. `src/feed-dom.ts` — the wiring. Measures the mono cell width from a probe span that sets `font-family: var(--font-mono)` so the measurement requests JetBrains Mono, after `document.fonts.ready` (2.5 s fallback); re-measures and re-sizes on `resize` and on a late `fonts.ready`, never per frame. Grid caps: ≤ 240 columns × ≤ 80 rows per feed. Mounts three feeds (hero with subject, mini public-feed panel, fixed background grain at low gain) in ONE `requestAnimationFrame` loop capped at ~30 fps that skips hosts off-screen (IntersectionObserver) and stops while `document.hidden`. `prefers-reduced-motion` renders one still frame and redraws only on resize. A real `<button>` "Pause" in the hero corner toggles the loop (and reads "Play" when paused). Also owns the hero clock, the tracking box position and its cycling label, and the record stream: nodes built with `createElement`/`textContent`, retention capped at 16 rows.
3. `index.html` + `src/styles/{overrides,page}.css`. `overrides.css` loads right after `@nulo/design/base.css` and corrects what a landing cannot inherit (recon § "What base.css does"): `a { color: inherit }`, `a:focus-visible, button:focus-visible { outline: 2px solid var(--nulo-accent); outline-offset: 2px }` (the package sets `a:focus { outline: none }`, so the override must be at least as specific), `body { user-select: text }`, `*::-webkit-scrollbar { display: revert }`. The page consumes design tokens directly (`var(--app-bg)`, `var(--txt-primary)`, `var(--nulo-secondary)`, `var(--nulo-outline)`, `var(--red)`, `var(--font-headline)`, `var(--font-body)`, `var(--font-mono)`); it defines no alias of the same name (a `--red: var(--red)` alias is a cycle). `page.css` holds the plate rule, bar, hero overlay, sections, notice, CTA, footer, breakpoints.

**Static content before JavaScript.** The hero plate, all copy, the preview notice, links, and a representative eight-row public record are in the HTML; JS enhances (feeds, clock, box, stream). The `<pre>` feeds are `aria-hidden`; the streaming record container is `aria-hidden` with a visually-hidden sentence describing it, so assistive tech is not fed changing hashes.

**Data & control flow (critical path).** Load → CSS (package `@font-face`, hashed into `/assets/`) → `main.ts` → `mountPage()` → fonts ready → measure cell → initial frames for the three feeds + record stream → loop. The release plugin substitutes `{{release_url}}` at build time as today.

**Preview with the real CSP.** `vite preview` ignores `public/_headers`. `vite.config.ts` gains `preview.headers` read from the `/*` block of `public/_headers` by a tiny parser in `scripts/headers.ts`, so the Phase 3 browser pass runs under the production policy.

**File-level change map.**

| Action | Path |
|---|---|
| modify | `apps/landing/package.json` (+ `dependencies["@nulo/design"] = "workspace:*"`), `bun.lock` |
| modify | `apps/landing/index.html` (head: title + OG/Twitter titles and descriptions; body: full rewrite) |
| modify | `apps/landing/src/main.ts` (imports + `mountPage()`), `apps/landing/vite.config.ts` (`preview.headers`) |
| add | `apps/landing/src/feed.ts`, `src/feed.test.ts`, `src/feed-dom.ts`, `scripts/headers.ts`, `scripts/headers.test.ts` |
| add | `apps/landing/src/styles/overrides.css`, `src/styles/page.css` |
| delete | `apps/landing/src/reveal.ts`, `src/styles/{tokens,base,layout,sections,animations}.css`, `public/fonts/*` (4 files), the two font `<link rel="preload">` hints |
| modify | `apps/landing/README.md`, `implementations-plan/index.md` |

**Trade-offs.** A `<canvas>` glyph renderer would be faster per frame but loses text semantics and complicates font timing; at ≤ 240×80 cells a frame is ≤ 19 k characters, and the Phase 3 pass measures it on a throttled mobile viewport rather than asserting it. Keeping the landing's own tokens (no dependency) was cheaper; the owner chose the dependency so the palette cannot drift. Cost, measured: the package's InterVariable is 352 kB versus the landing's 73 kB Latin Inter subset (JetBrains Mono 31 kB, Space Grotesk 41 kB). Unused faces (Material Symbols, 344 kB) are declared but never fetched. Whether a `<link rel="preload">` for the used faces helps is decided from the Phase 3 cold-load observation, not assumed.

## Phases

### Phase 1 ✓ — Foundation: dependency, base stylesheet, overrides, fonts
- Add `@nulo/design` to `apps/landing/package.json` dependencies; `bun install` (lockfile changes and is committed).
- `main.ts` imports `@nulo/design/base.css` then `./styles/overrides.css`; write `overrides.css`.
- Remove the landing's `@font-face` blocks, `public/fonts/*` and the preload links.
- Assumptions: Vue is already locked (3.5.41) so the package's peer resolves; Vite hashes the package fonts into `/assets/`.

**Validation gate**
- Commands: `bun install && bun install --frozen-lockfile && bun run --cwd apps/landing typecheck && bun run --cwd apps/landing test && bun run lint && bun run --cwd apps/landing build`
- Pass: all exit 0; the emitted CSS in `apps/landing/dist/assets/*.css` references `/assets/*.woff2` URLs for Space Grotesk, InterVariable and JetBrains Mono, and those files exist.
- Layers: typecheck · lint · unit · build.

### Phase 2 — Renderer: `feed.ts` + tests + `feed-dom.ts` + `scripts/headers.ts`
- Implement the pure renderer and the DOM layer as described; the `_headers` parser and the `preview.headers` wiring.
- `feed.test.ts` (vitest node, fixed seeds, times chosen far apart): shape and alphabet in one case (exactly `rows` lines of `cols` glyphs, every glyph in the ramp); determinism (same seed and time ⇒ identical string; a time 5 s later ⇒ a different string); gain 0 ⇒ all spaces; a Bayer fixture (a constant mid-grey input through `quantize` reproduces the known 4×4 threshold pattern); the subject blob raises mean glyph density in its 8-cell neighbourhood versus the same frame without it. `headers.test.ts`: parses the `/*` block into a header map and ignores path-scoped blocks.
- Assumptions: no jsdom is needed; the DOM layer is exercised by the Phase 3 browser pass.

**Validation gate**
- Commands: `bun run --cwd apps/landing typecheck && bun run --cwd apps/landing test && bun run lint`
- Pass: exit 0; `feed.test.ts` and `headers.test.ts` green; no complexity findings.
- Layers: typecheck · lint · unit.

### Phase 3 — Page: markup, styles, wiring, deletions
- Rewrite `index.html` body from `prototype.html` with the copy corrections from the Asks; `{{release_url}}` on "Add to Chrome" (bar, hero, CTA) and "Releases"; "Tools" → `https://testnet.tools.nulo.sh`; "Source on GitHub" → the repo; "How it works" → `#see`; the skip link and `<main>` kept; the record panel titled "Public record · illustrative".
- Write `page.css`; delete `reveal.ts` and the five old stylesheets; `main.ts` calls `mountPage()`.

**Validation gate**
- Commands: `bun run --cwd apps/landing typecheck && bun run --cwd apps/landing test && bun run lint && bun run --cwd apps/landing build && ! grep -q '{{' apps/landing/dist/index.html`
- Pass: exit 0 on all; then `bun run --cwd apps/landing preview` and a Playwright pass that (a) confirms the response carries the `Content-Security-Policy` header from `_headers` and the console has no CSP violation or error, (b) screenshots 1400×900 and 390×844 with the feed drawn and the plate and buttons legible, (c) tabs through bar → hero buttons → Pause → section links with a visible focus ring, (d) with `prefers-reduced-motion: reduce` emulated the feed is a still frame and Pause is absent or inert, (e) Pause stops the loop (two frames 1 s apart are identical) and Play resumes it, (f) the record panel never exceeds 16 rows after 30 s, (g) under 4× CPU throttling at 390×844 the main thread stays responsive (long tasks < 50 ms) — recorded in `lessons/phase-3.md` with the cold-load font requests (which faces, sizes, and whether layout shifted).
- Layers: typecheck · lint · unit · build · manual browser (CSP, a11y, motion, perf).

### Phase 4 — Docs, index, final read
- `apps/landing/README.md` file map and key notes (renderer, overrides, fonts from the package, `preview.headers`, no CI build job); `implementations-plan/index.md`; lessons.
- Re-read every visible string against the copy rule and the corrected claims (Asks 1–2).

**Validation gate**
- Commands: `bun run --cwd apps/landing typecheck && bun run --cwd apps/landing test && bun run lint && bun run --cwd apps/landing build`
- Pass: exit 0; README's file map lists every file in `apps/landing/src` and `scripts`.
- Layers: typecheck · lint · unit · build.

## Security & Adversarial Considerations

- **Threat model.** A public static page. Surface: what it loads, what it executes, what it claims, and the build's inputs.
- **CSP stays as is** and is now exercised in preview. No inline `<script>`, no CDN, no remote fonts.
- **DOM injection.** Runtime: `textContent`/`createElement` only. Build: the release plugin inserts API-derived URLs into HTML (`scripts/release-html-plugin.ts:46-64`, values from `release-resolver.ts`). That is existing exposure at the build boundary, unchanged by this plan; a compromised release or GitHub API response is the realistic target, not the renderer.
- **Resource use.** Grid caps (≤ 240×80 per feed), one loop at ≤ 30 fps, off-screen and hidden-tab pauses, a user Pause control, record retention ≤ 16 rows, no per-frame layout reads. Measured on a throttled mobile viewport at Phase 3.
- **Supply chain.** No new npm package; one workspace dependency. `bun.lock` committed; CI installs `--frozen-lockfile`.
- **Claims.** See Asks 1–2: the page must not say "testnet only" (production installs default to Alpha mainnet) and must scope "public by choice" to tokens that support both modes. "Not audited", "preview", "password or passkey" hold.
- **Illustrative data.** The public record is generated locally and labelled illustrative in static HTML so visitors and crawlers do not read invented entries as network evidence.
- **Accessibility.** Skip link and `<main>` kept; copy, links and a representative record exist before JS; art is `aria-hidden`; motion can be paused; reduced motion honoured.

## Assumptions

**Facts**
1. `apps/landing/package.json` has scripts `dev`, `build` (prebuild fetches the release), `preview` (`vite preview`), `typecheck`, `test` (`bun --bun vitest run`) and no `dependencies` block.
2. `apps/landing/scripts/release-html-plugin.ts` substitutes exactly `{{chrome_zip_url}}`, `{{version}}`, `{{release_url}}`, `{{shasums_url}}` and throws if a known token survives; tokens absent from the HTML are fine.
3. `apps/landing/public/_headers` sets `script-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'`; `vite preview` does not apply it (`vite.config.ts` has no `preview` block).
4. `packages/design/package.json` exports `"./base.css"` and peers on `vue ^3.5.38`; `bun.lock` already locks `vue` 3.5.41 for the workspace.
5. `packages/design/src/base.css` sets `*::-webkit-scrollbar { display: none }` (248–250), `a { color: var(--blue) }` and `a:focus { outline: none }` (252–259), `body { user-select: none }` (275–283), and declares Space Grotesk, InterVariable (352 kB), JetBrains Mono (31 kB) and Material Symbols (344 kB) `@font-face`s (11–43).
6. `biome.json` enforces cognitive complexity ≤ 15 and ≤ 80 non-blank lines per function across its configured includes (`apps/**` among them); `**/*.test.ts`, `**/*.spec.*`, `**/tests/**`, `**/e2e/**` and test utilities are exempt from the line cap only. A stdin probe on Biome 2.5.9 accepts `text-wrap: balance`, `mask-image` and `box-decoration-break: clone`.
7. `.github/workflows/pr-quick.yml` runs lint-and-typecheck and unit-tests unconditionally; its `landing` filter is dead (106–108). No workflow builds the landing.
8. `apps/landing/vitest.config.ts` uses `environment: "node"`; the only test is `release-resolver.test.ts`.
9. Both `pr-smoke-e2e.yml` (72) and `pr-network-e2e.yml` (78) list `bun.lock` in their path filters, so this PR triggers the smoke and network suites; all three statuses are required on `dev`.
10. Production extension builds seed Alpha mainnet as the active network (`apps/extension/src/wallet/services/network/service.ts:97-105`, `isPrimaryActive: !E2E_DEFAULT_ACTIVE_TESTNET`); only e2e builds pin testnet.
11. Send defaults to private but auto-selects public for a token without private transfers (`apps/extension/src/popup/pages/send.vue:123-152`).

**Inferences**
- Vite emits the package's `url("./fonts/…")` as hashed `/assets/*.woff2` (relative URLs, no asset overrides, above the inline threshold); the Phase 1 gate inspects the emitted CSS.
- Cloudflare Pages' `nulo` project builds the landing today with its prebuild script, so it runs `bun install` somewhere in the workspace and Bun ≥ 1.4 (the v2 lockfile requires it); adding a workspace dependency needs nothing more. Unverified: the dashboard is out of repo (Ask 4).
- InterVariable's extra weight is acceptable for a marketing page on the owner's chosen dependency; the Phase 3 cold-load observation decides whether a preload is added.

**Asks** — resolved at the gate (owner, 2026-09-06: conditional approve)
1. **"Testnet only" is false for real installs** (Fact 10). Owner: correct. Notice copy: "Nulo is a preview and hasn't been audited yet. Use small amounts you can afford to lose, or the test network, and tell us what breaks."
2. **"You choose what's seen" is true only where a token supports both modes** (Fact 11). Owner rejected the verbose qualifier; wants marketing register. Locked copy: promise heading "You decide what's seen." body "Private by default. Public when you say so. Nulo always shows you which is which." The per-token nuance lives in the caption under the two screens: "A few tokens only work in public. Nulo tells you before you send." Hero unchanged: "You're on camera. You choose what it sees."
3. Title `NULO | Nothing to see. Everything to own.`; OG and Twitter titles and descriptions updated together; no version number. Default accepted.
4. Cloudflare `nulo` project left as-is; the first Pages build after merge is the proof. Default accepted.

## Post-implementation hardening

Not scheduled.

## Post-implementation

Executed by the implementing session from this file. `code_review` is `off`: `/code-review` is not run.

1. **Codex audit** (`/codex high`): send the net diff from the plan baseline (`git diff bde7fc7c...HEAD`), this `plan.md`, `recon.md`, `audit-codex.md`, and the asks: adversarial/security review of a public static page (CSP, injection, resource use, claims, accessibility), plus the two rules below.
2. **Iterative fix loop**: verify each factual claim against the repo before acting; apply accepted fixes; commit; log the round (consult + verdict) in `lessons/phase-N.md`; resume the same codex session with the fix diff and ask for a re-review. Repeat until a round yields no new material findings. Still material after 3 rounds: stop and surface.
3. **Delivery** (below): open the PR only after the loop converges.

**No-over-engineering rule** (verbatim in every codex prompt): "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."

**Comment-quality rule** (verbatim in every codex prompt): "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."

## Delivery

Single arc, single PR. Branch `worktree-on-camera-landing` → `dev`, opened with `gh pr create` after the codex loop converges. Title (≤ 93 chars): `feat(landing): rebuild nulo.sh as the "on camera" feed page`. `code_review: off`. Then `gh pr checks --watch`. Because `bun.lock` changes, the smoke and network suites run (≈ 30 min): a red check is diagnosed first (read the failing job's log); it is re-run only when the log shows a known flake unrelated to this diff, and fixed on the branch otherwise. Merge is the owner's call (squash, per the dev ruleset). The Cloudflare `nulo` project deploys production from `main`, so the page goes live at the next promote.

**Follow-up (not in this PR):** a `build-landing` job in `pr-quick.yml` gated on the existing `landing` filter.

## Audit — codex (round 1)

Session on GPT-6 Astra at `high`, read-only, over `plan.md` + `recon.md` + the repo. Transcript: `audit-codex.md`. **Verdict: conditional approve** — conditions: resolve the network/privacy claims and the approved-source reference; fix CSS overrides and validation gates; bound animation and record updates; verify Cloudflare settings; treat triggered e2e failures as actionable.

Adopted (all verified against the repo before adoption):
- **Claims.** "Testnet only" contradicts the mainnet-active default (Fact 10) → Ask 1. "Public by choice" needs the per-token qualification (Fact 11) → Ask 2. "No trust boundary beyond its CSP" removed; the build-time release insertion is named as existing exposure.
- **Approved source.** `prototype.html` committed beside the plan.
- **CSP gate.** `vite preview` does not apply `_headers` → `preview.headers` parsed from the file; the browser pass checks the response header.
- **Illustrative record** labelled in static HTML.
- **Bounds.** Grid caps, 16-row retention, no per-frame measurement, a Pause control, throttled-mobile check.
- **Accessibility.** Skip link and `<main>` kept; static copy and a representative record before JS; streaming container hidden from AT; keyboard, reduced-motion and JS-off reads added to the Phase 3 pass.
- **Fact 9 / delivery.** `bun.lock` triggers both e2e filters; "red e2e = flake" removed; diagnose first.
- **Fact 6** precision; vue-peer inference corrected (already locked at 3.5.41); Cloudflare recorded as an evidence request (Ask 4).
- **Overrides.** No self-aliases (consume tokens directly); `a:focus-visible` at sufficient specificity; button focus restored.
- **Fonts.** Late `fonts.ready` and resize re-measure; the probe requests the mono face; font cost stated from measured sizes; preload decided from observation.
- **Gates.** `! grep -q` replaces `grep -c` (which exits 1 on zero matches); the "≥ 6 cases" quota dropped for a fixed-seed, well-separated-time set plus a Bayer fixture; Phase 3 pass extended (CSP header, keyboard, reduced motion, pause, retention, throttled perf, cold-load fonts).

Rejected: none. Deferred: a tokens-only `@nulo/design` export (codex agrees it is not warranted for this scope).

## Seeds

ELI5 companion: the Artifact at `https://claude.ai/code/artifact/43529cff-4da1-4884-a5f4-5118248c32bb`, published from `implementations-plan/on-camera-landing/eli5.html` (redeploy the same file to update it).

Recommended: `/goal` (completion is transcript-observable: ✓ markers, gate output, codex convergence, PR checks).

```
/goal All four phases marked ✓ in implementations-plan/on-camera-landing/plan.md, each ✓ backed by its validation gate reported passing in the transcript; `LESSONS_FILE=implementations-plan/on-camera-landing/lessons/phase-N.md` printed for each phase; `/code-review` NOT run (code_review is off); the codex fix loop converged on the net diff, evidenced by a resumed codex pass reporting no new material findings quoted in the transcript; one PR from worktree-on-camera-landing to dev exists (`gh pr view` in the transcript), created only after the loop converged; `gh pr checks` reports every required check green in the transcript; `bun run --cwd apps/landing test` and `bun run lint` both report exit 0 in the transcript.
```

Fallback: `/loop 15m` with the standard blueprint driver prompt, `<lint>` = `bun run lint`, `<test>` = `bun run --cwd apps/landing test`.
