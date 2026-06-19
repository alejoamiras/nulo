# Fable-slot plan + audit — design-system-externalization

**Provenance.** Claude Fable 5 was unavailable at planning time
(`Claude Fable 5 is currently unavailable`). Per the blueprint protocol's note — *"capability
matters more than the literal name"* — an **Opus `Plan` subagent** with independent context was
substituted for the fable perspective. This file captures (1) that planner's distinct
contributions during the parallel-plan phase, and (2) — later — the fresh hostile audit verdict.

Paths below are repo-relative (the planner's raw transcript used absolute paths in chat; scrubbed
here per the committed-artifact path rule).

---

## Round 1 — independent plan (parallel-plan phase)

**Thesis taken:** tokens-first; single-source-of-truth via a **generated** token artifact (not a
hand-maintained parity); copy-into-package + a `unplugin-vue-components` **resolver** so the 142+
auto-imported tag sites need zero edits; and a **deliberately shrunk L2 set** because several
brief-listed "primitives" are not framework-pure.

### Distinct findings (caught beyond the brief + the main plan)

1. **The extension does not even declare `@nulo/design` as a dependency**
   (`packages/extension/package.json` lists only the other five `@nulo/*`). Adding the
   `workspace:*` dep is discrete Phase-0 work and is itself the first new edge in the dep graph.
2. **`core/` components have ZERO colocated tests** (`packages/extension/src/components/core/` has
   no `*.test.ts`). So "L1 ≥5 cases" is **net-new test authoring**, not a move. (The main plan
   wrongly said "move tests" for L1.)
3. **Three brief-listed L2 "primitives" are NOT framework-pure** — verified via `@/` imports:
   - `ToastManager.vue:3` imports `@/composables/toast.js` (store/state-bound) → **Tier-C, defer**.
   - `Input.vue:6` imports `@/utils/string` (`sanitizeString`, pure) → **Tier-B**, co-migrate the
     helper into `packages/design/src/internal/`.
   - `Popover.vue` imports `@/composables/outside` (`useOutside`, pure C0) → **Tier-B**, co-migrate.
   The truly-clean **Tier-A** set (0 `@/` imports) is 11: `Spinner, Toggle, Badge, Banner,
   BrutalistTitle, Checkbox, SectionLabel, SubPageHeader, LoadingState, Tooltip, Button`.
4. **`Icon` has a 124 KB data dependency** — `@/assets/icons.json` — that must co-migrate into the
   package (`internal/icons.json`). (The main plan missed this entirely.)
5. **`Badge ≠ Tag`** (extension `Badge` = filled-variant pill built on `Flex`; design `Tag` = mono
   uppercase bordered chip — `Badge.vue:11-39` vs `Tag.vue:13-37`). Not a dedup. Keep both.
6. **The two `Spinner`s differ** — design-native `Spinner` (0.75s spin, `currentColor`,
   `Spinner.vue:17-29`) vs extension `Spinner` (4s multi-rotate, `--txt-inverse` default,
   `Spinner.vue:33-58`). Reconcile deliberately; don't assume a swap is safe.
7. **`--gray-15` ghost**: `_text.scss:57` maps `color--dark` → `var(--gray-15)`, but `--gray-15`
   is declared nowhere → `<Text color="dark">` already renders unresolved. **Bug-pin verbatim**
   per CLAUDE.md, don't silently "fix" during a pure move.
8. **`--purple` gap**: extension declares it, `packages/design/src/base.css` doesn't; `Badge` has a
   `purple` variant → either promote `--purple` to the shared core (recommended) or keep that
   variant extension-only.
9. **Consumer blast radius (grep):** `<Flex>` 142, `<Text>` 86, `<Icon>` 88, `<MaterialIcon>` 26,
   `<Button>` 54, `<Spinner>` 11 — all auto-imported, **no explicit imports** → "fix the imports"
   is a non-strategy; the resolver is the only viable mechanic.

### Resolutions to the 7 open decisions (fable-slot positions)

- **(a) Tokens:** canonical = a hand-edited `packages/design/tokens/tokens.source.json`; a
  `scripts/gen-tokens.ts` generator emits committed `src/tokens.ts` + `src/tokens/_core.css`. The
  extension `@use`s the generated `_core.css` for its dark `:root` defaults and keeps its
  `[theme=light]`/extra-var blocks; the extension `tokens.ts` re-exports the package's + its
  extras. **Anti-drift = a generator-recompute test** (`gen:tokens:check` + a drift test asserting
  committed output is byte-identical to fresh output), explicitly modeled on the repo's existing
  `nulo-schema-patch.ts` drift test (CLAUDE.md line ~59) and the KDF-vector lock. "A test, not just
  a generator — the generator can be skipped, the test cannot."
- **(b) Styling:** scoped `<style>` + inline-style for the numeric scales (`font-size`/`gap` are
  pure numbers → inline is a faithful 1:1 of `.fz--N`/`.gap`) + a `colorVar()` helper map for
  color names. **No-regression proof = Storybook screenshot diff** over the prop cross-product
  actually used in the app (grep the call sites for distinct combos), the load-bearing defense
  beyond unit tests + smoke e2e.
- **(c) Layer rules:** biome path overrides inside the package (`core/**` can't import `../ui/*`;
  `ui/**` may import `../core` + `../tokens`), added in Phase 0 before any move; extension needs no
  new layer rule (it's the sink).
- **(d) Sequencing:** tokens → L1 → L2-A → L2-B → faucet → cleanup. **6 PRs**, each green on `dev`.
- **(e) Faucet:** `AppButton`→`Button` via a deprecated prop-adapting re-export (mechanical diff);
  design-`Spinner`→migrated `Spinner` (size-compatible); `Toast` unchanged; `Badge`≠`Tag` keep both.
- **(f) Storybook:** stays the single extension-hosted instance, importing migrated primitives from
  `@nulo/design` via the resolver. No second Storybook this round (no `@storybook/*` in the
  design package; beachhead shouldn't fund it).
- **(g) Mechanics:** copy-into-package + resolver + delete-in-same-PR. The resolver is a
  **permanent, cleaner substitute** for a re-export shim for the auto-imported set; a temporary
  re-export shim is used ONLY where extension code imports a moved component explicitly (rare).

### Security points (distinct)

- `@nulo/design` becomes load-bearing under the security-critical wallet UI (renders tx-confirm +
  address-display surfaces). It's `private:true` + `workspace:*` → never registry-resolved, so the
  supply-chain min-age policy isn't bypassed; plan adds **no new runtime deps** (assert per PR).
- **`biome.json` is itself security-load-bearing**: a PR that weakens the `@nulo/design` `@nulo/*`+
  `chrome` floor in the same diff as a malicious import slips past lint. Recommends a **meta-test**
  asserting the floor bans persist in the override block.
- **Generated-artifact integrity**: a hand-edit of `tokens.ts`/`_core.css` could inject a malicious
  value (e.g. `--app-bg: url(...)` exfil) without touching the JSON source → the drift test makes
  that fail CI; the generator becomes trusted code, review it as such.
- **Highest silent-regression vector**: a leftover global class in a "self-contained" rewrite (e.g.
  `class="mono"` left in `Text` instead of scoping `font-family: var(--font-mono)`) does *nothing*
  in the package's class-less render context and is **invisible to unit tests** — only the
  Storybook screenshot diff catches it. This is why the visual diff is mandatory, not optional.

### Asks raised (fable-slot)

1. Confirm removing `ToastManager` from round 1 (store-bound, not a primitive).
2. `Input`+`Popover`: include in round 1 (Phase 3) with pure-helper co-migration, or defer to keep
   round 1 to the trivially-pure set?
3. `--gray-15` ghost: bug-pin verbatim (recommended) or fix now (behavior change)?
4. `AppButton`/design-`Spinner`: deprecate-now-rename-later (recommended) or rename-and-break-faucet now?
5. `--purple`: promote to shared core (recommended) or keep `Badge` purple extension-only?
6. Storybook: confirm extension-only host this round (recommended).

---

## Round 2 — fresh hostile audit (fresh Opus reviewer, no prior context)

**`VERDICT: conditional approve`** — clear conditions 1–5. Independently confirmed codex's core
blockers and added new ones, all file:line-backed; all adopted into the revised plan.

1. **Producer-side auto-import (BLOCKING, = codex #3).** `packages/design/vitest.config.ts` has only
   `vue()`; extension auto-imports all of `vue` + `webextension-polyfill` (`vite.config.ts:153-172`).
   `Popover.vue` has no `vue` import yet uses `ref`(32)/`reactive`(35)/`nextTick`(64)/`watch`(45);
   `Input.vue:3` imports only `{ref,watch,computed}` but uses `onMounted`(111)/`nextTick`(213). JS
   SFCs + no `checkJs` → **vue-tsc + build pass, runtime throws.** → explicit imports + a gate that
   MOUNTS each moved component and fails on unresolved-component warnings + ReferenceErrors.
2. **"Storybook visual diff" is vapor (BLOCKING).** No screenshot infra (no test-runner/chromatic/
   playwright-storybook/loki/percy/reg-suit). Worse: `.storybook/preview.ts:30-31` loads
   `_base.scss` + `index.scss` → a component that LOST self-containment renders correctly (host CSS
   masks it) → the gate can't catch the leftover-global-class vector. Resolver not wired into
   `.storybook/main.ts` (own `useComponents({dirs})`). → build real screenshot infra OR drop "visual
   diff" + exhaustive per-call-site style-snapshot tests + wire the resolver into Storybook.
3. **Banner/LoadingState ↔ Spinner contradiction (BLOCKING, = codex #2).**
4. **Drift value-parity is theater (BLOCKING).** Sites already disagree byte-wise (`--txt-body`
   `rgba(…45%)` `_base.scss:47` vs `rgba(…0.45)` `base.css:61`; `--txt-white` `95%` vs `0.95`).
   Needs CSS-value-equivalence (% ↔ decimal, hex case, `var()`-as-value) + selector-aware parsing of
   `:root`/`[theme=light]`/`[theme=dark]`; allowlisting theme-varying values **excludes the
   contrast-critical text tokens** ("pins the safe, waves through the dangerous"). → normalize both
   sites byte-identical first, then byte-pin; do NOT allowlist text tokens; add a faucet value gate.
5. **~88 out-of-scale `size=` values + ghost colors (MAJOR).** `size="large/medium/small/mini/micro/
   hero/22"` aren't in the `fontSizes` numeric scale → today they no-op (inherited). An inline
   `${size}px` rewrite emits `largepx`/`NaNpx` → regression. Ghosts: `color="dark"`→`--gray-15`(8×),
   `color="purple"`→`--purple`(ext-only), `color="--nulo-error"`, literal-prop bleeds
   (`color="color"`/`"--txt-primary"`). `Icon.vue:72` reads `path.opacity` where `path` is undefined
   in that branch (latent runtime error). → inventory + pin ALL of these, not just `--gray-15`; Text
   must faithfully no-op non-numeric sizes; Icon.test must exercise the bug branch.
- Smaller: `Tooltip`/`Popover` teleport host-coupling (= codex #5); biome floor needs SEPARATE
  `core/**` + `ui/**` path overrides (one src-wide rule can't express the asymmetry); faucet
  "renders identically" has no value gate; `contract.ts` must preserve `cssVar`'s looser
  `(name: string, fallback?)` signature.
- **Got right (both reviewers):** token re-export zero-call-site-churn (extension imports only
  `text`+`cssVar`); no `provide`/`inject` in the set; rejecting wrapper-shims (defineExpose);
  chrome.* structural absence + indirection test; per-layer atomic flip + revert-one-PR.

## Round 3 — fresh hostile audit of the AMBITIOUS takeover (Phase 2)

`VERDICT: reject` — "Phase 2 has no working look-same gate" for an AFK run. Independently
confirmed codex's findings + added decisive ones (all code-verified):
- **The look-same baseline is unimplementable in the chosen env.** The design package tests run in
  **jsdom** (`vitest.config.ts:7`), which does NOT resolve CSS-var cascade or `var()` →
  `getComputedStyle().getPropertyValue('--token')` can't read resolved per-theme values.
  `tokens.baseline.json` (the spine of §2.0) cannot be captured there. Real resolution needs a
  headless browser (puppeteer — only in the node-env e2e suite) or postcss (declared, not resolved).
- **The "light+dark smoke e2e" gate doesn't exist and asserts nothing visual.** The smoke suite
  asserts only testid presence + `consoleErrors/pageErrors === []` (`navigation.test.ts:23-24`); no
  test toggles theme. It can't catch a color shift, dropped reset, missing keyframe, or FOUT.
- **A token-only baseline is blind to ~60% of `base.css`**: the reset, **`*::-webkit-scrollbar`**
  (package omits → scrollbars appear), **`body{user-select:none}`** (package omits → text
  selectable), focus-ring rules the package ADDS, and **7 keyframe families vs the package's 2**
  (toast transform differs).
- **The build is crxjs (chrome + firefox MV3), not plain Vite** (`vite.chrome.config.mts:7-12`).
  Package-relative `@font-face` / `web_accessible_resources` / CSP resolution is unverified →
  production-only font-404/FOUT risk, green in dev.
- **`MaterialIcon` breaks** if the global `.material-symbols-outlined` class isn't faithfully
  carried (it's not in the package base); takeover-before-rewrite → Material icons render as literal
  ligature words. The whole un-migrated app depends on `_text.scss` globals, so `_base.scss` can't
  be shrunk in round 1.
- **`setup/index.ts` imports no base today** (`:5` commented) → adding it is a pixel-moving change.
- **Recommendation:** real headless-browser visual gate (theme × data-has-nav, against the BUILT
  artifact); keep `_base.scss` globals until the whole library self-contains; verify the crxjs font
  path with a built-artifact load assertion; re-sequence the takeover AFTER component
  self-containment (or defer it). As written, Phase 2 is the highest-risk phase placed earliest with
  the weakest gate.
