# Repo map — `packages/design` (`@nulo/design`)

Phase-1 map for the `/harden quality` (ultra) audit. Read-only. Lens: **TYPING quality** + **DEDUP**
(esp. design-primitive ⇄ extension-wrapper cross-package duplication).

**Purpose:** the framework-/host-agnostic, **presentational-only** design system shared by the wallet
extension and the faucet. Ships Vue SFC + TS *source* (no build step — each consumer's Vite/`vue-tsc`
compiles it). Hard floor: NO `@nulo/*` imports, NO `chrome.*`, NO stores/service-clients/app-utils
(enforced by biome `noRestrictedImports`/`noRestrictedGlobals` + `boundary.test.ts`). ~44 source files,
~7.7k LOC incl. tests. Consumed by the extension via a custom `unplugin-vue-components` resolver
(`packages/extension/scripts/design-resolver.ts`) so bare `<Flex>`/`<Badge>` tags resolve to the package.

---

## 1. Module inventory

### L0 — tokens (`src/token-contract.ts` + generators)
- `token-contract.ts` — **canonical SSOT** for token NAMES/scales/durations. `as const` maps:
  `tokenGroups` (surfaces/brand/text/borders/colors/fonts/easings/layout), `fontSizes`, `fontWeights`,
  `lineHeights`, `durations`, plus utility-class inputs (`textColors`, `textAligns`, `flexGaps`,
  `flexAlignments`, `flexWraps`, `flexDirections`).
- `internal/render-tokens.ts` — pure renderer → source of `tokens.ts` (also emits the union TYPES:
  `SurfaceToken`, `BrandToken`, `TextToken`, `ColorToken`, `FontToken`, `FontSize`, `FontWeight`,
  `LineHeight`, plus `cssVar()`).
- `internal/render-css.ts` — pure renderer → source of `utilities.css` (~120 `.fz--`/`.gap--`/`.color--`… rules).
- `scripts/gen-tokens.ts` — Bun CLI writing both generated files (`bun run gen:tokens`).
- `tokens.ts` **(GENERATED, byte-pinned)**, `utilities.css` **(GENERATED, byte-pinned)**.

### L1 — core primitives (`src/core/`)
`Flex.vue`, `Icon.vue` (reads `internal/icons.json`), `Text.vue`, `MaterialIcon.vue`.

### L2 — ui primitives (`src/ui/`)
`Badge`, `Banner`, `BrutalistTitle`, `Button`, `Card`, `Checkbox`, `Input` (uses `internal/sanitize`),
`LoadingState`, `Popover`, `SectionLabel`, `Spinner`, `SubPageHeaderBase`, `Tag`, `Toast`,
`ToastManagerBase`, `Toggle`, `Tooltip`.

### L3 — composites (`src/composite/`)
`AddressDisplay`, `BalanceRow`, `DisclaimerTag` (wraps `Tag`), `DripButton` (wraps `Button`),
`EmojiGrid`.

### composables (`src/composables/`)
`toast.ts` (`useToast` + `TOAST_DURATION` — module-scope single-toast singleton driving
`ToastManagerBase`), `outside.ts` (`useOutside`/`useEvent` — outside-press detection for `Popover`).

### styling / theming / internals
- `base.css` — hand-authored global stylesheet (token VALUES + fonts + `@import "./utilities.css"`).
- `internal/sanitize.ts` — bounded text normalizer (byte-identical copy of the extension's `utils/string.ts`).
- `theme-vars.ts` — undefined-var guard helpers (reusable across packages via `./testing`).
- `theme-contrast.ts` — WCAG contrast resolver over `base.css` token graph (reusable via `./testing`).
- `testing.ts` — test-only barrel re-exporting `theme-vars` + `theme-contrast`.
- `raw.d.ts` — `*?raw` + `import.meta.glob` ambient types.

---

## 2. Public exports / subpath exports (`package.json#exports`)
- `.` → `src/index.ts` (barrel: all 4 core + 17 ui + 5 composite components + `export * from ./tokens`).
- `./tokens` → `src/tokens.ts` (generated token consts + union types + `cssVar`).
- `./base.css` → global stylesheet (import once at app entry).
- `./core/*`, `./ui/*`, `./composite/*`, `./composables/*` → wildcard subpath access to individual files.
- `./testing` → `src/testing.ts` (theme-vars + theme-contrast guards; not runtime API).

Notable barrel aliases: `Button` (router-free base; extension wraps), `SubPageHeaderBase`,
`ToastManagerBase` (neutral name avoids colliding with faucet's `Toast` item).

## 3. Internal deps (DAG, lower → higher)
- `token-contract` → `render-tokens` / `render-css` (build-time only).
- core: `Icon`→`icons.json`. (Flex/Text/MaterialIcon: self-contained.)
- ui→core: `Button`→{Icon,Spinner}; `Input`→{Flex,Icon,Text,Tooltip,sanitize}; `Banner`→{Flex,Icon,Text,Spinner};
  `LoadingState`→Spinner; `ToastManagerBase`→{Flex,Icon,toast}; `SubPageHeaderBase`→{Flex,MaterialIcon};
  `Checkbox`/`Badge`→{Flex,Icon}; `Toggle`→Icon; `Popover`→{Flex,outside}; `Tooltip` self-contained.
- composite→ui: `DripButton`→Button; `DisclaimerTag`→Tag. (AddressDisplay/BalanceRow/EmojiGrid: standalone.)
- composables: independent (Vue only). `Popover` consumes `outside`; `ToastManagerBase` consumes `toast`.
- **No upward imports** (layer floor holds; verified by `boundary.test.ts`).

## 4. Frameworks
- **Vue 3.5** (peer dep) — SFC `<script setup lang="ts">`, `<style module>` + `<style scoped>` (mixed).
- **Token generation** — bespoke pure-renderer pipeline (`render-tokens`/`render-css` → `gen-tokens.ts`),
  byte-pinned by drift tests (the repo's generated-artifact idiom).
- **Vitest 4** + `@vue/test-utils` + jsdom for tests. **Storybook** stories present (7 `*.stories.ts`).
- No auto-import inside the package (explicit imports everywhere); faucet has no resolver.

## 5. Test surfaces
37 `*.test.ts` files. Categories:
- **Component** (colocated `<Name>.test.ts`): all core/ui/composite SFCs.
- **Generated-artifact pins:** `tokens.drift.test.ts`, `utilities.drift.test.ts`, `tokens.parity.test.ts`.
- **Boundary/floor:** `boundary.test.ts` (bans `@nulo/*`, `chrome.*`, polyfill indirections),
  `mount-all.test.ts` (smoke-mounts every export).
- **Theming guards:** `theme-vars.test.ts`, `theme-contrast.test.ts`, `base.css.test.ts`.
- **Logic:** `composables/{toast,outside}.test.ts`, `internal/sanitize.test.ts`.
- 7 `*.stories.ts` (Spinner, Banner, Input, Popover, ToastManagerBase, LoadingState, Tooltip).

## 6. Generated paths to EXCLUDE (do not hand-edit / not authored surface)
- `src/tokens.ts` — GENERATED, byte-pinned by `tokens.drift.test.ts`.
- `src/utilities.css` — GENERATED, byte-pinned by `utilities.drift.test.ts`.
- `src/fonts/*.woff2` (4 binary font assets), `src/internal/icons.json` (data), `tsconfig.tsbuildinfo`.
- **NOT generated (in-scope, hand-authored):** `base.css` (relocated verbatim; holds token VALUES),
  `token-contract.ts`, both `render-*.ts`.

---

## 7. Proposed Phase-2 clusters (6, stable names)
| Cluster | Files |
|---|---|
| `design/tokens` | `token-contract.ts`, `internal/render-tokens.ts`, `internal/render-css.ts`, `scripts/gen-tokens.ts`; pins `tokens.drift.test.ts`, `utilities.drift.test.ts`, `tokens.parity.test.ts` (generated `tokens.ts`/`utilities.css` are OUTPUTS — review, don't edit). |
| `design/core-primitives` | `core/{Flex,Icon,Text,MaterialIcon}.vue` (+ tests), `internal/icons.json`. |
| `design/ui-primitives` | `ui/*.vue` (17 components + tests + 7 stories). |
| `design/composites` | `composite/{AddressDisplay,BalanceRow,DisclaimerTag,DripButton,EmojiGrid}.vue` (+ tests). |
| `design/composables` | `composables/{toast,outside}.ts` (+ tests). |
| `design/theming-internals` | `base.css`, `theme-vars.ts`, `theme-contrast.ts`, `testing.ts`, `internal/sanitize.ts`, `raw.d.ts`; pins `boundary.test.ts`, `mount-all.test.ts`, `base.css.test.ts`, `theme-*.test.ts`, `sanitize.test.ts`. |

---

## 8. Typing + dedup hotspots (the audit lens)

### Typing — loose props / missing variant unions
1. **Two divergent prop-typing conventions split the package.** OLD (Options-style
   `defineProps({ variant: { type: String } })`, NO `PropType` unions, runtime `validator` arrays):
   `Flex, Text, Icon, MaterialIcon, Button, Input, Badge, Banner, Toggle, SectionLabel, Popover,
   Tooltip, LoadingState`. NEW (typed `defineProps<{…}>()`+`withDefaults`, explicit union types):
   `Tag (Tone), Toast (Kind), BrutalistTitle, Spinner, SubPageHeaderBase, ToastManagerBase` + all 5
   composites. The OLD set exposes **bare `string`** for every variant/size/color → zero compile-time
   typo/autocomplete protection at call sites (`variant="primary_outline"`, `color="tertiary"`).
2. **`Checkbox.vue` (WORST):** `defineProps(["modelValue","checked","disabled"])` — array form,
   **every prop is implicit `any`**.
3. **`Button.vue`:** `variant`/`size` are `type:String` despite an 8-variant / 6-size **closed set
   documented in JSDoc** — the exact place a union belongs. `getStyles()` string-indexes
   `style[props.variant]` with NO variant guard (`hasCorrectSize` guards size only) → unknown variant
   silently yields `style[undefined]`.
4. **Generated union types exist but are unused.** `tokens.ts` already EXPORTS `FontSize`, `FontWeight`,
   `LineHeight`, `ColorToken`, `TextToken`, … yet `Text.vue`/`Icon.vue`/etc. type `size`/`weight`/
   `color` as bare `string`. The SSOT for these unions is shipped and ignored.
5. **`Toggle.color`** is a raw CSS color string bound straight to inline `style.background`
   (primitive obsession — no token type). `Icon.color`/`Text.color` likewise bare `string`.
6. **`size` prop type is inconsistent:** `Icon`/`SectionLabel` `[String,Number]`, `Button`/`Input`
   `String`, `Spinner` `string|number`. No shared `Size` type.
7. **`Input.vue` cast cascade:** `text` ref is `string|number|null|undefined`; ~10 `as string` casts at
   string-op sites, plus `window as unknown as {clipboardData}`. Flagged intentional, but the modelValue
   union leaks casts throughout — a primitive-obsession smell.
8. **Untyped validator params:** `Flex` `validator(value)` params are implicit-any, cast `value as string`
   inside. `Icon` casts the JSON import: `iconsJson as Record<string,string|IconPath[]>`.

### Dedup — within the package
A. **Runtime `validator` arrays re-hardcode the token-contract unions.** `Flex` literals
   `["center","between","around","evenly","start","end"]` (×2), `["nowrap","wrap","wrapReverse"]`,
   `["column",…]` **duplicate** `flexAlignments`/`flexWraps`/`flexDirections` keys in
   `token-contract.ts`. `Tooltip` re-hardcodes `["top","bottom","left","right"]`+`["start","end","center"]`.
   SSOT exists; components copy the member lists as string literals → drift risk + no compile check.
B. **Class-builder boilerplate copy-pasted** across `Flex`/`Text`/`Icon`: identical
   `computed(()=>{ const c=[]; if(prop) c.push(`pfx--${prop}`)… })` shape. Candidate shared helper.
C. **Per-variant semantic-color CSS maps duplicated 4×** with divergent vocab: `Badge`
   (info/warning/error/purple), `Banner` (info/done/warning/error), `Toast` (ok/error/info),
   `ToastManagerBase` (red/green/orange via JS `variantClass` + 3 `.variant_*` rules). No shared
   severity-color token set — primitive obsession on status colors.
D. **Two toast systems coexist:** `Toast.vue` (faucet dismissible item, `Kind`="ok|error|info") vs
   `ToastManagerBase`+`useToast` singleton (extension transient, color="red|green|orange"). Documented as
   intentional, but duplicated toast surface with **divergent color vocabularies**.
E. **Color-string interpretation scattered:** `--`-prefix→`var()` logic in `Spinner` + `Icon`
   currentColor-default + `theme-contrast.resolveColor` each reinterpret color strings independently.

### Dedup — cross-package (design primitive ⇄ extension local wrapper)
*(The 3 host-coupled holdouts live in `packages/extension/src/components/ui/`; flagged here, owned by the
extension cluster.)*
F. **`extension/components/ui/Button.vue` (untyped JS wrapper) re-declares the ENTIRE base prop
   contract** (size, variant, wide, disabled, loading, leftIcon, leftIconColor, rightIcon, rightIconColor,
   target — + `link`) and **re-forwards each prop verbatim** via `:left-icon` etc. in BOTH branches. Any
   new base prop must be hand-mirrored; wrapper is `<script setup>` (no `lang="ts"`) → `type:String` again,
   no union — typing regresses across the seam. Textbook cross-package prop duplication.
G. **`extension/components/ui/SubPageHeader.vue`** likewise re-declares + re-forwards
   title/showBack/leadingIcon/leadingIconColor (+ backTo). Same verbatim prop dup; untyped JS.
H. `extension/components/ui/ToastManager.vue` — thin (renders `ToastManagerBase`, no dup). OK.
I. No duplicate primitive **SFCs** remain in the extension (migration is clean — only the 3 wrappers).
   Consider a shared prop-type module the wrappers `Pick<>`/extend from to kill F/G duplication and
   restore type parity.
