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
