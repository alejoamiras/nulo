# Phase 3 — L1 core (Flex, Icon, Text, MaterialIcon)

Branch: `feat/design-system-p3-core` (stacked on `feat/design-system-p2-takeover`).
Machine-gated; proceeds autonomously per the /goal (Phase 2's visual sign-off remains pending the
user but does not block Phase 3 development — the verbatim base port is low-risk + all machine
checks green).

## Research findings (verified)
- **`Flex` is migratable** — it's a generic `<component :is="tag" v-bind="{to}">` wrapper; it does
  NOT import vue-router (`tag="router-link"` resolves against the *consumer's* global registry). Not
  a Button-style holdout. Exposes `wrapper` ref (pin it). Styling = global classes
  (`flex`/`items-`/`justify-`/`wrap-`/`flex-direction-`/`gap--`/`flex-wide`) → rewrite to inline
  styles from the contract maps (`flexAlignments`/`flexWraps`/`flexDirections`) for self-containment.
- **`Icon`** imports `@/assets/icons.json` (co-migrate → `internal/icons.json`; verified ONLY Icon
  imports it). Uses global `.fill--${color}` → rewrite via `colorVar()`. **`Icon.vue:72` bug is
  DEAD CODE**: icons.json is 101 strings + 3 arrays + **0 non-array objects**, so the
  `!Array.isArray(...)` "splitted object" branch (`:style="{opacity: path.opacity}"`, `path`
  undefined) never executes → simplify the template to an `Array.isArray` check (string → single
  path; array → v-for), removing the dead buggy branch. Look-preserving. Keeps `<style module>` +
  `hoverColor` v-bind. Already has explicit `import { computed } from "vue"`.
- **`Text`** — no style block; pushes `fz--/fw--/lh--/ta--/color--/mono/...` globals. Rewrite to
  inline-from-scales: set `font-size` ONLY when `Number(size) ∈ fontSizes` (off-scale/named → inherit,
  ~88 sites); `font-weight`/`line-height` likewise; color via `colorVar()` (ghosts `dark`→`--gray-15`
  preserved). Already has explicit `import { computed }`.
- **`MaterialIcon`** uses `computed` with **NO import** (relies on extension auto-import) → add
  explicit `import { computed } from "vue"`. Uses global `.material-symbols-outlined` (now in
  base.css) + `.color--${color}` → rewrite color via `colorVar()`; keep the `material-symbols-outlined`
  class (provided by base.css). The font is package-bundled (Phase 2).

## Plan
1. `git mv` icons.json → `src/internal/icons.json`; add `src/internal/colorVar.ts` (name → `var(--…)`
   via contract `textColors`; unknown → undefined = inherit, preserving the old no-op behavior).
2. Author `src/core/{Flex,Icon,Text,MaterialIcon}.vue` self-contained + explicit imports + fidelity pins.
3. Export them from `src/index.ts`.
4. Add a custom `unplugin-vue-components` resolver in `vite.config.ts` + `.storybook/main.ts` mapping
   `{Flex,Icon,Text,MaterialIcon}` → `@nulo/design`; delete the extension `core/*` copies; regen
   `components.d.ts`; template-tag audit (grep the tag sites still resolve).
5. Tests: `src/core/*.test.ts` (≥5 each, style-snapshot over grep'd prop combos incl. off-scale
   sizes + ghost colors + Icon dead-branch coverage + Flex `wrapper` expose); `src/test/mount-all.test.ts`
   (mount + exercise branches, un-stubbed children, fail on unresolved-component warnings).
6. Gate: typecheck:all + lint + design tests + extension tests + build + storybook + smoke (light+dark).

## Atomicity note
Moving a component is atomic (package copy + resolver entry + extension delete in one commit) — a
half-move breaks the extension (e.g. moving icons.json without migrating Icon). So this phase lands
as one cohesive change, validated at the end.

## Result — Phase 3 COMPLETE ✓ (machine-gated)

The reframe that de-risked it: Phase 2 relocated the global utility classes into
`@nulo/design/base.css`, so the components keep their exact class-based styling (now package-owned)
— a near-verbatim move, look-same trivially preserved. Only script changes: lang=ts (the design
package is TS-strict; JS SFCs hit TS7016 via index.ts), MaterialIcon's explicit `import {computed}`,
Icon's relative icons.json + dead-branch removal + TS typing of the JSON/SVG paths.

Migration mechanic VALIDATED: a shared `unplugin-vue-components` resolver (`scripts/design-resolver.ts`,
used by vite.config + .storybook/main) maps the 4 tag names → `@nulo/design`. `components.d.ts`
regenerated to `import('@nulo/design')['Flex']` etc. → 142 `<Flex>` / 86 `<Text>` / 88 `<Icon>` sites
resolve with ZERO template churn; build chrome green.

Gate:
- typecheck:all 0 · lint 0 (1101 files) · design tests 101 (incl. mount-all + per-component fidelity
  pins) · extension tests 2398 · build chrome + firefox + faucet 0.
- smoke e2e: settings-crud ISOLATED = 1 failed / 7 passed (only the pre-existing FPC-row flake,
  identical to p1/p2). The 2 extra failures in the full 276s run (NewFpcPopup/NewTokenPopup) are
  Chrome-cascade flakiness (file ran ~18th); both pass in isolation → NO Phase-3 regression.
- build-storybook: **PRE-EXISTING broken** — fails identically on the p2 branch with a Storybook-v10
  + Vite-8-rolldown `ViteAlias StringExpected` error on the pre-existing `{find:"@"}` alias-merge in
  `.storybook/main.ts` (commit 5ee8ec1, not mine). My extensionless-import warning was fixed with a
  `.ts` extension. Tracked for round-2 (a storybook/rolldown tooling fix, out of scope here).

Decision logged (deviation from §2.3 inline-rewrite): keep the components' global-class styling
(provided by the package's own base.css) instead of an inline-style rewrite — strictly lower
look-same risk (zero style change) + package-self-contained. No colorVar helper needed.

Round-2 cleanup: extension `src/assets/fonts/` + `src/assets/styles/` dirs now gone; storybook
rolldown-alias fix; faucet public/fonts orphaned.
