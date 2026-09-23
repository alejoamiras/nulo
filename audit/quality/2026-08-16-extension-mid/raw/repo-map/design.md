# `packages/design` — Module Map

`@nulo/design` (`packages/design`, `package.json` name `@nulo/design`) is the shared, presentational-only Vue 3 design system consumed by `apps/extension` and `apps/faucet`. No build step — it ships Vue SFC + TS source; consumers compile it with their own Vite/`vue-tsc`. 6104 total LOC across `src/` (`.ts`/`.vue`, excluding fonts/JSON).

## 1. Module inventory

**Token contract / generation (L0)**
| Path | Purpose | LOC |
|---|---|---|
| `src/token-contract.ts` | Canonical hand-authored source of token NAMES/scales/durations (`tokenGroups`, `fontSizes`, `fontWeights`, `lineHeights`, `durations`, `textColors`, `textAligns`, `flexGaps`, `flexAlignments`, `flexWraps`, `flexDirections`) | 151 |
| `src/tokens.ts` | **GENERATED** typed reflection of the contract (`surfaces`, `brand`, `text`, `borders`, `colors`, `fonts`, `easings`, `layout`, `cssVar()`, `SurfaceToken`/`BrandToken`/etc. types) | 101 |
| `src/internal/render-tokens.ts` | Pure renderer: contract → exact source text of `tokens.ts` | 60 |
| `src/internal/render-css.ts` | Pure renderer: contract → exact source text of `utilities.css` (~120 utility classes: `.fz--N`, `.fw--N`, `.lh--N`, `.ta--*`, `.color--*`, `.fill--*`, `.gap--N`, `.justify-*`, `.items-*`, `.wrap-*`, `.flex-direction-*`) | 50 |
| `scripts/gen-tokens.ts` | Bun CLI entry (`bun run gen:tokens`); writes `src/tokens.ts` + `src/utilities.css` via the two renderers above | 13 |
| `src/base.css` | Hand-authored global stylesheet: `@font-face`, `:root`/`[theme]` CSS-var values, resets, keyframes, `@import "./utilities.css"` | 419 |
| `src/utilities.css` | **GENERATED** utility-class layer | 458 |
| `src/color-names.ts`, `src/layout-names.ts`, `src/severity.ts` | Hand-authored prop-type unions derived from the contract (`TextColorName`, `FlexAlign`/`FlexJustify`/`FlexWrap`/`FlexDirection`/`FlexGap`/`TextAlign`, `SeverityTone`) | 11 / 25 / 16 |

**Core (L1) primitives — `src/core/`**
| Path | Purpose | LOC |
|---|---|---|
| `Flex.vue` | Layout primitive; maps `align`/`justify`/`wrap`/`direction`/`gap`/`wide` props to utility classes; `tag`/`to` for polymorphic root | 81 |
| `Icon.vue` | SVG icon renderer reading `src/internal/icons.json` (single-path or multi-path `IconPath[]`); CSS Module `.hovered`/`.loading` with `v-bind()`-driven hover color | 102 |
| `MaterialIcon.vue` | Wraps the `material-symbols-outlined` icon font (ligature text as icon name) | 32 |
| `Text.vue` | Typography primitive (`size`/`weight`/`height`/`align`/`color`/`noWrap`/`mono`/`tabular`/`selectable` → utility classes) | 83 |

**UI (L2) — `src/ui/`** (17 components, all runtime-tagged as ported from the extension or newer TS-generic style — see §9)
Badge (47), Banner (168), BrutalistTitle (70), Button (388), Card (19), Checkbox (70), Input (407), LoadingState (47), Popover (137), SectionLabel (40), Spinner (62), SubPageHeaderBase (118), Tag (37), Toast (70), ToastManagerBase (105), Toggle (112), Tooltip (250).

**Composite (L3) — `src/composite/`**
AddressDisplay.vue (69, clipboard-copy address chip), BalanceRow.vue (55, presentational public/private balance row), DisclaimerTag.vue (7, thin `<Tag tone="test">` wrapper), DripButton.vue (34, thin `<Button variant="primary_outline">` wrapper with loading-guard), EmojiGrid.vue (46, presentational verification grid).

**Composables — `src/composables/`**
| Path | Purpose | LOC |
|---|---|---|
| `toast.ts` | `useToast()` / `TOAST_DURATION` — single module-scope toast singleton | 44 |
| `outside.ts` | `useOutside()` / `useEvent()` — outside-press detection, ported verbatim from the extension incl. UA-sniffed touch/mouse branch and `data-outside` collision guard | 61 |

## 2. Entrypoints / public exports

`package.json` `exports` map: `.` (barrel `src/index.ts`), `./tokens` (`src/tokens.ts`), `./base.css`, `./core/*`, `./ui/*`, `./composite/*`, `./composables/*`, `./testing` (`src/testing.ts`, re-exports `theme-vars.ts` + `theme-contrast.ts` guards for consumers' own test suites).

`src/index.ts` barrel exports: all 4 core primitives, 17 of the 17 ui components (all of them, including `Card`/`Tag`/`Toast`), all 5 composite components, `export * from "./tokens"`, plus type-only `SeverityTone`, `TextColorName`, and the `Flex*`/`TextAlign` unions. It does **not** re-export `composables/*` (those are subpath-only imports) or `severity.ts`'s runtime value (type-only).

**Consumers:**
- `apps/extension/scripts/design-resolver.ts` — `NULO_DESIGN_COMPONENTS` (a `Set`) maps bare-tag names (`Flex`, `Icon`, `Text`, `MaterialIcon`, `Badge`, `BrutalistTitle`, `Checkbox`, `SectionLabel`, `Toggle`, `Spinner`, `Banner`, `LoadingState`, `Tooltip`, `Popover`, `Input`) to `@nulo/design` for the extension's `unplugin-vue-components` auto-import; shared by `vite.config.ts` and `.storybook/main.ts` (which also globs `packages/design/src/**/*.stories.@(ts|vue)`).
  - The extension wraps 3 components locally rather than resolving them bare, because they need router/naming seams the package deliberately excludes: `apps/extension/src/components/ui/Button.vue` (wraps design `Button` + injects `RouterLink`), `apps/extension/src/components/ui/SubPageHeader.vue` (wraps `SubPageHeaderBase` + `useRouter`/history-back policy), `apps/extension/src/components/ui/ToastManager.vue` (renames `ToastManagerBase` to avoid colliding with the faucet's `Toast` item name).
  - `apps/extension/src/composables/{toast.js,outside.js}` are re-export shims: `export { TOAST_DURATION, useToast } from "@nulo/design/composables/toast"` and `export { useEvent, useOutside } from "@nulo/design/composables/outside"` — kept so the extension's ~55 existing auto-import call sites resolve unchanged.
- `apps/faucet/scripts/design-resolver.ts` — `NULO_DESIGN_COMPONENTS = new Set(["Flex"])` only; the faucet imports `Button`, `Card`, `Toast`, `AddressDisplay`, `Spinner`, `BalanceRow`, `DripButton`, `DisclaimerTag`, `EmojiGrid` explicitly instead.
  - `apps/faucet/src/components/AppToastRegion.vue` imports `Toast` (the presentational item) and drives it from the faucet's **own** local multi-toast queue (`@/composables/useToast`), not the package's `useToast` singleton — a deliberate divergence from the extension's usage of `ToastManagerBase` + the shared singleton.

## 3. Coupling surfaces

- **Import-graph coupling (verified via grep, one level deep):** `core/Flex.vue`, `core/Icon.vue`, `core/Text.vue`, `core/MaterialIcon.vue` are the most-imported internals — pulled into `Badge`, `Banner`, `Button`, `Checkbox`, `Input`, `Popover`, `SubPageHeaderBase`, `Toggle`, `ToastManagerBase`.
- **Composable coupling:** `ui/Popover.vue` → `composables/outside.ts` (`useOutside`); `ui/ToastManagerBase.vue` (+ its `.stories.ts`) → `composables/toast.ts` (`useToast`). Both composables are re-exported verbatim by the extension's shim files, so the extension and the design package literally share the same module instance (see §4).
- **Sibling ui→ui coupling:** `Banner.vue` → `Spinner.vue`; `Button.vue` → `Spinner.vue`; `Input.vue` → `Tooltip.vue`; `LoadingState.vue` → `Spinner.vue`.
- **composite→ui coupling:** `DisclaimerTag.vue` → `ui/Tag.vue`; `DripButton.vue` → `ui/Button.vue`.
- **Token-pipeline coupling (textual, not import-based):** every `<style module>`/`<style scoped>` block references `var(--nulo-*)`/`var(--txt-*)`/etc. custom properties declared in `base.css`. This isn't a TS import, so it's guarded separately by `tokens.parity.test.ts` (typed tokens → declared in `base.css`) and `theme-vars.ts`'s `findUndefinedThemeVars` (every `var(--x)`/string-prop token referenced in a component → declared in `base.css`), both consumed by the `./testing` barrel and re-run by the extension (`apps/extension/src/design/theme-vars.test.ts`) and faucet (`apps/faucet/src/lib/theme-vars.test.ts`) against their own SFCs.
- **Prop-union coupling:** `color-names.ts`'s `TextColorName` is imported by `Icon`, `MaterialIcon`, `Button` (`leftIconColor`/`rightIconColor`), `Toggle`, `SubPageHeaderBase`, `Text`; `layout-names.ts`'s unions by `Flex`, `Text`; `severity.ts`'s `SeverityTone` by `Badge`, `Banner`, `Toast` (each via `Extract<SeverityTone, …>`, deliberately not sharing a color palette — see the doc comment in `severity.ts`).

## 4. State owners

- **`src/composables/toast.ts`** — module-scope singleton: `const toast: Ref<ToastOptions | null | undefined> = ref()` (line 23) and `let closeTm: ReturnType<typeof setTimeout> | undefined` (line 24), both declared at module top level outside `useToast()`. Comment explicitly warns: "A second module-level copy would split this ref." This singleton is shared by every caller in the same JS module graph, including the extension's re-export shim (`apps/extension/src/composables/toast.js`) — so the extension's entire app shares ONE toast across all `useToast()` call sites and `ToastManagerBase`.
- **`src/ui/Popover.vue`** — file-scope (not module-scope, but still non-reactive shared) `let removeOutside: (() => void) | null = null` (line 14), reassigned inside a `nextTick` in the `open` watcher; explicitly marked `(BUG PIN)` as a preserved defect (see §10).
- **`src/composite/AddressDisplay.vue`** — local component-scope `ref` (`copied`) and an un-cleared `setTimeout` (line 22) that resets it after 1200ms; not module state but a timer with no cleanup on unmount.
- **`src/ui/Tooltip.vue`** — local `ref<ReturnType<typeof setTimeout> | null>` (`delayedHover`) cleared in `handleMouseLeave`; component-scoped, not shared.
- No other module-level mutable state was found; all other components are stateless/props-driven or use only local `ref`/`reactive`.

## 5. Dependency graph (internal imports, one level deep)

```
token-contract.ts  ←  render-tokens.ts, render-css.ts, color-names.ts, layout-names.ts
tokens.ts (generated) ← Text.vue
layout-names.ts → Flex.vue, Text.vue
color-names.ts  → Icon.vue, MaterialIcon.vue, Text.vue, Button.vue, SubPageHeaderBase.vue, Toggle.vue, ToastManagerBase.vue
severity.ts     → Badge.vue, Banner.vue, Toast.vue
internal/icons.json → Icon.vue
internal/sanitize.ts → Input.vue
composables/outside.ts → Popover.vue
composables/toast.ts   → ToastManagerBase.vue, ToastManagerBase.stories.ts

core/Flex.vue    → Badge, Banner, Checkbox, Input, Popover, SubPageHeaderBase, ToastManagerBase
core/Icon.vue    → Banner, Button, Checkbox, Input, ToastManagerBase, Toggle
core/Text.vue    → Banner, Input
core/MaterialIcon.vue → SubPageHeaderBase

ui/Spinner.vue   → Banner.vue, Button.vue, LoadingState.vue
ui/Tooltip.vue   → Input.vue
ui/Tag.vue       → DisclaimerTag.vue (composite)
ui/Button.vue    → DripButton.vue (composite)

index.ts (barrel) → everything above (fan-in only)
```
**Cycles:** none found. The layering is strictly respected — `core` never imports `ui`/`composite`; `ui` never imports `composite`; `composite` only imports `ui`. This matches the Biome `noRestrictedImports` overrides at `biome.json` lines 70–150+ (`packages/design/src/**` bans `@nulo/*`; `packages/design/src/core/**` additionally bans `../ui/*`; `packages/design/src/ui/**` additionally bans `../composite/*`) and is re-verified at runtime by `src/boundary.test.ts`.

## 6. Frameworks / primitives

- **Vue**: `^3.5.38` (peerDependency). Uses `<script setup lang="ts">` throughout, `defineProps`/`defineEmits`/`defineExpose`/`defineSlots`/`withDefaults`, `computed`/`ref`/`reactive`/`watch`/`onMounted`/`nextTick`, `useCssModule()` (`Button.vue`), `Teleport`/`teleport` (`Popover.vue`, `Tooltip.vue`, `ToastManagerBase.vue` — all three require a host-provided teleport root, documented as a "Host-DOM contract" in `README.md`), `<Transition>`/`<TransitionGroup>`. No Pinia/Vuex, no `vue-router` (banned by `boundary.test.ts`), no auto-import (explicit imports everywhere, by design).
- **CSS architecture**: two coexisting patterns (see §9) — CSS Modules (`<style module>` + `$style`/`useCssModule()`) for the extension-ported components, and plain `<style scoped>` (or no style block) for the newer TS-generic composites/some ui components. Design tokens are CSS custom properties (`var(--nulo-accent)` etc.) declared once in `base.css` and consumed via `var()` everywhere; `internal/render-css.ts` generates the ~120-class utility layer (`utilities.css`) consumed by `Flex.vue`/`Text.vue`/`Icon.vue` via string-built class lists (no CSS-in-JS). `color-mix(in srgb, …)` is used for hover-state tinting (`Button.vue`, `Spinner.vue`). No SCSS/Sass in this package — `base.css`'s header notes it's "relocated verbatim from the extension's `_base.scss`+`_flex.scss`+`_text.scss`."

## 7. Test surfaces

Coverage is essentially 1:1 — every `.vue` component has a matching `.test.ts` (26 vue components, 26 co-located `.test.ts` files: 4/4 core, 17/17 ui, 5/5 composite). Additional cross-cutting tests: `boundary.test.ts` (platform-agnostic floor), `tokens.drift.test.ts` / `utilities.drift.test.ts` / `base.css.test.ts` (generated/pinned-artifact guards), `tokens.parity.test.ts` / `theme-vars.test.ts` / `theme-contrast.test.ts` (token↔CSS consistency), `internal/sanitize.test.ts`, `mount-all.test.ts` (producer-side "mounts without auto-import" smoke test).

`mount-all.test.ts` is a **partial** cross-cutting smoke gate, not full coverage: it only mounts 18 of the 26 components (`Flex`, `Icon`, `Text`, `MaterialIcon`, `Badge`, `BrutalistTitle`, `Checkbox`, `SectionLabel`, `Toggle`, `Spinner`, `Banner`, `LoadingState`, `ToastManagerBase`, `Button`, `SubPageHeaderBase`, `Tooltip`, `Popover`, `Input`) — it omits `Card`, `Tag`, `Toast`, and all 5 `composite/*` components (those have their own dedicated `.test.ts` instead, so they're not literally untested, just outside this particular auto-import gate).

Storybook `.stories.ts` exist for 7 components only: `Banner`, `Input`, `LoadingState`, `Popover`, `Spinner`, `ToastManagerBase`, `Tooltip` — consumed by `apps/extension/.storybook/main.ts` (which globs `packages/design/src/**/*.stories.@(ts|vue)`). The other 19 components have no story.

## 8. Generated / vendored / fixture code (exclude from manual edits/review-as-source-of-truth)

- `src/tokens.ts` — GENERATED from `src/token-contract.ts` by `scripts/gen-tokens.ts`; byte-pinned by `tokens.drift.test.ts`.
- `src/utilities.css` — GENERATED from the same contract; byte-pinned by `utilities.drift.test.ts`.
- `src/base.css` — hand-authored but content-hash pinned (`base.css.test.ts`, sha256 `c23ee8970a1d4a9abe2220dcd165578e3274638b9ccf574f9635f64ce37475e4`); a "relocated verbatim" port of the extension's old `_base.scss`/`_flex.scss`/`_text.scss`.
- `src/internal/icons.json` — 104-icon SVG-path vendor JSON (~121KB), consumed only by `core/Icon.vue`.
- `src/fonts/*.woff2` — 5 vendored font binaries (InterVariable 344K, MaterialSymbolsOutlined 336K, JetBrainsMono-latin 32K, SpaceGrotesk-latin 24K, SpaceGrotesk-latin-ext 20K), referenced package-relatively from `base.css`.
- `src/internal/sanitize.ts` — explicitly documented as a "byte-identical copy of the extension's `utils/string.ts` `sanitizeString`" (fork, not import, because the package can't depend on the extension) — treat as vendored/pinned, not independently evolvable.
- `tsconfig.tsbuildinfo` — build cache artifact, not source.

## 9. Apparent duplication

- **Toast concept implemented twice with divergent shapes**: `ui/Toast.vue` (props-driven, `dismiss` emit, `<style scoped>`, no composable — the faucet's per-item toast, driven by the faucet's own external multi-toast queue) vs. `ui/ToastManagerBase.vue` (composable-driven singleton via `composables/toast.ts`, `<style module>`, teleports itself, single-toast-at-a-time — the extension's toast region). Same domain concept, two non-interoperable implementations coexisting in the same package by design (per code comments), not a bug, but a real duplication surface for anyone extending toast behavior.
- **Two coexisting authoring conventions**, split roughly along "ported from the extension" vs. "written new for the package":
  - **Runtime `defineProps({...})` + `PropType` casts + `<style module>` (CSS Modules via `$style`)**: `Badge`, `Banner`, `Button`, `Checkbox` (array-form `defineProps([...])`), `Icon`, `SectionLabel`, `Tooltip`, `Input`, `Popover`, `LoadingState`, `Flex`, `MaterialIcon`, `Text`, `SubPageHeaderBase`, `Toggle`.
  - **Generic `defineProps<{...}>()` + `withDefaults` + `<style scoped>` (or no style)**: `Tag`, `BalanceRow`, `Toast`, `EmojiGrid`, `DripButton`, `AddressDisplay`, `DisclaimerTag` — plus a mixed subset (`BrutalistTitle`, `Spinner`, `ToastManagerBase`) that uses the generic-props style but keeps `<style module>`.
  - Both conventions are functionally fine and internally consistent per-file, but a contributor has no single documented pattern to follow — the split roughly tracks "migrated from `apps/extension`" vs. "authored directly in `packages/design`" (composite/* and the faucet-facing components).
- **Small "labeled chip" components with near-identical shape**: `ui/Badge.vue` (variant-driven background chip), `ui/Tag.vue` (tone-driven outlined chip), `composite/DisclaimerTag.vue` (a 7-line wrapper that just calls `<Tag tone="test">`). Three small components solving overlapping "colored label" needs with separate variant vocabularies (`BadgeVariant` vs. `Tag`'s local `Tone`) rather than one shared prop union.
- **CTA-button variant styling** in `Button.vue` explicitly self-documents its own near-duplication and consolidates it: the comment at line 300 ("Shared CTA typography contract — ONE source for all three variants") shows `cta`/`cta_outline`/`cta_destructive` intentionally share a selector list rather than triplicating typography rules — a positive counter-example, called out here because it shows the team is aware of the duplication risk pattern elsewhere.

## 10. Error-path hotspots

Few, and mostly deliberate/pinned rather than accidental:

- **`ui/Popover.vue` line 14** — `(BUG PIN)` comment: `removeOutside` is initialized to `null` and only assigned inside the `open`-branch `nextTick`; if `open` flips `false` before that `nextTick` fires, the `else` branch calls `removeOutside()` on `null` and throws. Preserved verbatim from the extension and pinned by a `boundary`/behavior test rather than fixed.
- **`ui/Input.vue`** `subtype="int"` handling (`handleInput`, lines 156–174) — `(BUG PIN)` in `Input.test.ts`: emits `parseInt` of the RAW (uncleaned) text rather than the sanitized digits, so `"12a3"` emits `12` (parseInt stops at the first non-digit) instead of the cleaned `123`. Documented quirk, not fixed, pinned by test.
- **`ui/Input.vue` `handlePaste`** (lines 201–233) — reads `window.clipboardData` as a legacy IE fallback via an unsafe cast; only exercised when `maxLength` is set.
- **`composite/AddressDisplay.vue` `onClick`** (lines 17–29) — `navigator.clipboard.writeText` failure is silently swallowed (`catch { /* best-effort */ }`) with no user-facing feedback; comment defers error surfacing to the call site.
- **`composables/outside.ts` `useEvent`'s `remove` closure** (lines 53–57) — comment flags it calls `removeEventListener` unconditionally on `element.value`, which "throws if the ref cleared first"; preserved verbatim rather than guarded.
- No error-path issues were found in the token-generation pipeline or in the majority of presentational components (most are pure prop→class/style mappers with no branching failure modes).