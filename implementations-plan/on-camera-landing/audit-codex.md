# Codex audit — on-camera-landing (round 1)

Model GPT-6 Astra, effort `high`, sandbox read-only, session `01a078d0-3423-7561-b2eb-d0d47249865d`. Inputs: `plan.md` (draft at commit `4a2c1037`), `recon.md`, the repo. Paths below are repo-relative as returned. The disposition of every finding is recorded in `plan.md` § Audit — codex (round 1); every High and Medium claim was verified against the cited files before adoption.

---

Confidence: **high** for source findings; Cloudflare dashboard settings and the exact approved prototype remain **unknown**. I checked the files and ran a CSS probe against Biome 2.5.9. Install/build validation was not run in this read-only environment.

Plan references below refer to `implementations-plan/on-camera-landing/plan.md`.

## 1. Adversarial / security

- **High — "Testnet-only" contradicts the wallet implementation.** The plan asserts every listed claim is true (`plan.md:102`). Production seeds Alpha **mainnet** as active; only the E2E override selects testnet (`apps/extension/src/wallet/services/network/service.ts:97–115`). Profile bootstrap also falls back to that primary network (`apps/extension/src/composables/useProfileBootstrap.ts:83–94`). The existing banner and README are stale evidence, not proof. Resolve the intended wording with the owner; retain "preview," "not audited," and "do not use with real funds," without implying technical testnet confinement.

- **High — "Public by choice" needs qualification.** Send initially selects private, but automatically selects public when a token lacks private transfers; an existing balance selection can also determine the mode (`apps/extension/src/popup/pages/send.vue:123–150`). PRIVATE/PUBLIC labels exist (`apps/extension/src/components/composite/send/SendTypesCard.vue:27–41`), but that does not establish an explicit privacy choice for every action. Use wording scoped to supported transfers. Password/passkey choice is supported by onboarding (`apps/extension/src/onboarding/pages/create.vue:145–169`); "not audited" matches the repository's stated status (`README.md:7`).

- **Medium — The CSP is compatible, but its validation gate is ineffective.** Bundled external scripts, local fonts, and `textContent` need no CSP relaxation. Remote fonts, inline executable scripts, and external runtime fetches would be blocked (`apps/landing/public/_headers:3`). However, `preview` is plain `vite preview`, with no configured response headers (`apps/landing/package.json:11`, `apps/landing/vite.config.ts:4–11`). Cloudflare parses `_headers`; Vite does not. A quiet preview console therefore cannot prove CSP compatibility (`plan.md:98`). Inspect the actual response header and run the browser check with that policy applied.

- **Medium — The "live public record" must be explicitly illustrative.** The plan calls it live while specifying locally generated random hashes (`plan.md:13`, `plan.md:99`). Label it "Illustrative public record" in static HTML. Otherwise visitors and crawlers may mistake invented transactions for network evidence.

- **Medium — Resource bounds are missing.** "~9k characters" and "well under 2ms" are unsupported measurements (`plan.md:50`, `plan.md:100`). Three feeds incur rendering, text layout, and painting costs; fixed background grain remains intersecting while the user scrolls. Specify maximum grid dimensions, bounded record-row retention, and no per-frame layout measurement. Check sustained rendering on a throttled mobile viewport. Thirty FPS limits frequency, not work per frame.

- **Medium — Accessibility needs more than hiding the art.** `aria-live="off"` leaves changing record content readable; it does not hide or stabilize it (`plan.md:78`). Keep explanatory copy, warnings, links, and a representative record in HTML before JavaScript runs. Preserve the existing skip link and main landmark (`apps/landing/index.html:58`, `apps/landing/index.html:86`). Include keyboard focus, zoom/reflow, JavaScript-disabled reading, and reduced-motion checks in the existing browser pass. Provide a pause mechanism for perpetual decorative motion and record updates.

- **Low — Runtime injection handling is sound; the build still has a trust boundary.** The proposed DOM APIs avoid parsing generated strings as markup (`plan.md:33`). The retained release plugin, however, inserts API-derived values directly into HTML (`apps/landing/scripts/release-html-plugin.ts:46–64`; `apps/landing/src/release-resolver.ts:28–34`). An attacker would more profitably target release/build integrity or download destinations than the five-character renderer. This is existing exposure, not a reason to rewrite the release pipeline, but remove "no trust boundary beyond its CSP" (`plan.md:131`).

## 2. Assumption attack

### Facts

- **High — Fact 9 is narrowly correct, but the delivery conclusion is wrong.** Skipped E2E statuses pass; **this PR will not normally skip them** because it changes `bun.lock` (`plan.md:42`). Both filters include that file (`.github/workflows/pr-network-e2e.yml:78`, `.github/workflows/pr-smoke-e2e.yml:72`). Delete the instruction that a red E2E status is necessarily a flake (`plan.md:147`). Diagnose failures before rerunning, as `CLAUDE.md:457` requires.

- **Low — Facts 1–5, 7, and 8 match the inspected files.** The scripts, four-token substitution, stylesheet export, global CSS effects, unconditional lint/unit jobs, and node test environment are present. The landing filter is explicitly documented as dead (`.github/workflows/pr-quick.yml:106–108`).

- **Low — Fact 6 needs precision.** The production line budget is **80 nonblank lines**, and exemptions extend beyond `*.test.ts` to specs, tests, E2E, and test utilities (`biome.json:61–85`). "Repo-wide" also means within Biome's configured includes, not every repository file (`biome.json:6–17`). The intended renderer constraints are correct.

### Inferences

- **Medium — "Unmet Vue peer only warns" is the wrong expected model.** Bun documents automatic peer installation, including its isolated-install workflow. Vue is already locked at 3.5.41 (`bun.lock:2263`), satisfying design's `^3.5.38` peer (`packages/design/package.json:22–24`); the installed design workspace already resolves it. Expect peer resolution, potentially without a warning. **Moderate confidence** on the exact changed-install outcome until a clean install runs. Keep the install/frozen-lockfile gate; do not preemptively make Vue optional. A CSS-only import does not itself bundle Vue.

- **Low — Hashed font emission is a well-supported inference.** The stylesheet uses relative font URLs, and landing has no asset-output overrides (`packages/design/src/base.css:16–42`, `apps/landing/vite.config.ts:8–10`). These files exceed Vite's default inline threshold. Inspect emitted CSS URLs as well as asset existence; browser requests must resolve under `/assets/`.

- **Low — The questioned CSS properties are accepted.** A stdin probe containing `text-wrap: balance`, `mask-image`, and `box-decoration-break: clone` passed the installed **Biome 2.5.9** check. Actual stylesheet formatting and browser rendering still need their gates.

- **Medium — Cloudflare configuration is unknown, not established.** Recon correctly says build settings are dashboard-only (`implementations-plan/on-camera-landing/recon.md:13`). A working existing landing does not prove root workspace installation or Bun ≥1.4. Root `bun run build` builds the extension (`package.json:13`), whereas landing's script builds Vite (`apps/landing/package.json:10`). Record the actual production/preview build command, root/output directories, Bun version, and install behavior before calling deployment readiness proven.

### Asks

- **High — Surface the network/privacy copy discrepancy.** It changes factual promises, not merely editorial preference.
- **Medium — Make the approved v3 source accessible to implementation and review.** `plan.md:15` names an artifact but supplies neither its source path nor a retrievable reference. Exact copy and design fidelity cannot be audited from that description.
- **Medium — Treat Cloudflare settings as an evidence request**, not an approval-by-default assumption.
- **Low — Title and omission of the dynamic release version can remain defaults.** Update OG and Twitter titles/descriptions together (`apps/landing/index.html:18–28`). Although `{{version}}` is absent today, the old mockup does display hardcoded `NULO v1.0` (`apps/landing/index.html:184`).

## 3. Implementation critique

- **Medium — Fix the override contract.** `--red: var(--red)` is a cyclic custom property, not an alias (`plan.md:34`); simply consume the existing `--red` (`packages/design/src/base.css:115`). Likewise, retain the package's font variables directly after removing landing's old token definitions. Use `a:focus-visible` rather than only `:focus-visible`: the latter loses specificity to package `a:focus { outline: none }` (`packages/design/src/base.css:257–258`). Restore button focus too if adding pause controls. Selection and scrollbar resets are appropriately targeted.

- **Low — Keep the proposed split.** Pure rendering plus DOM wiring follows the existing resolver/test separation (`apps/landing/src/release-resolver.ts:21`, `apps/landing/src/release-resolver.test.ts:15`). Two CSS files are reasonable if overrides contain only package adaptation and page.css contains presentation. No framework, renderer framework, or tokens-only package change is warranted for this approved scope. Recon's tools example proves import ordering, although tools itself **is Vue**, not a non-Vue precedent (`apps/tools/src/main.ts:1–4`).

- **Medium — Define font-ready and resize behavior.** The plan's timeout can measure fallback metrics, after which the real mono font changes cell width (`plan.md:33`). Ensure the probe requests JetBrains Mono before awaiting readiness; remeasure on late font completion and host resize without mounting another loop. Reduced-motion pages also need resize-driven static redraws.

- **Medium — Correct the font-cost and first-paint claims.** The package references a **352,240-byte InterVariable** and **343,628-byte Material Symbols** file (`packages/design/src/base.css:16`, `packages/design/src/base.css:42`; sizes verified locally). "~180kB extra" is unsupported. Emitted assets are not necessarily downloaded: unused icon fonts need not load. Removing obsolete font files/preloads prevents stale requests, but package Inter is considerably larger than landing's 73,016-byte Latin Inter. `font-display: swap` protects readable fallback text; it does not prove unchanged first paint or layout stability. Inspect cold-load font requests and layout shift before deciding whether a replacement preload helps.

- **Low — The complexity limits are realistic.** Keep seeded random generation, noise interpolation, subject position/intensity, and Bayer quantization as small named helpers inside `feed.ts`; let `renderFrame` assemble rows. Apply the same discipline to measurement, scheduling, and record updates in `feed-dom.ts`. No extra modules are needed merely to meet the budget (`CLAUDE.md:82–85`).

- **Medium — Gates prove less than their pass descriptions claim.** The named scripts are real, including root lint (`package.json:24`). Phase 1 asset existence does not prove correct font selection. Phase 2 leaves wiring unmounted until Phase 3, so passing units prove only rendering. Two screenshots cannot establish pause/resume, reduced motion, bounded records, or CSP behavior (`plan.md:61–83`). Extend the existing manual browser pass with those observations; no new test framework is necessary.

- **Low — Remove the six-case quota and repair the shell gate.** The six renderer behaviors are reasonable, but "≥6 cases" rewards test count (`plan.md:67–72`). Combine dimensions/ramp assertions and use fixed seeds and deliberately separated times; arbitrary nearby times may quantize identically. A small known Bayer-pattern fixture would substantiate dithering better than merely observing animation. Also, `grep -c` prints `0` **and exits 1** when nothing matches (`plan.md:82`). Use a file-reading assertion that succeeds only when placeholders are absent and fails on read errors.

## 4. What you would build differently, and why

- Keep the four-file architecture and chosen design dependency.
- Correct the claims and label the record illustrative before transferring prototype copy.
- Remove self-aliases; make focus overrides explicit.
- Bound rendering and record growth; handle late fonts and resizing.
- Strengthen the existing browser check with actual CSP headers, keyboard/reduced-motion behavior, and cold-load observations.
- Record Cloudflare evidence and triage all triggered CI failures.

VERDICT: conditional approve (with conditions: resolve the network/privacy claims and approved-source reference; fix CSS overrides and validation gates; bound animation and record updates; verify Cloudflare settings and treat triggered E2E failures as actionable)
