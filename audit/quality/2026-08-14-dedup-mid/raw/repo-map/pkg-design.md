# Repo map — `packages/design` (`@nulo/design`)

Brutalist design system shared by extension + faucet (+ playground). No auto-import; explicit
imports only. Presentational only — no service clients, no `chrome.*`.

## 1) Module inventory

| Component | Path | Purpose | LOC |
|---|---|---|---|
| Flex | `src/core/Flex.vue` | Flexbox layout primitive (align/justify/gap/direction) | 81 |
| Icon | `src/core/Icon.vue` | Custom SVG icon set renderer (`internal/icons.json`) | 102 |
| MaterialIcon | `src/core/MaterialIcon.vue` | Material Symbols web-font icon renderer | 32 |
| Text | `src/core/Text.vue` | Typography primitive (size/weight/color) | 83 |
| Badge | `src/ui/Badge.vue` | Small tone-colored pill (info/warning/error/purple) | 47 |
| Banner | `src/ui/Banner.vue` | Bordered alert row, tone via icon fill | 168 |
| BrutalistTitle | `src/ui/BrutalistTitle.vue` | Two-line uppercase hero title (onboarding) | 70 |
| Button | `src/ui/Button.vue` | Button variants (router-free base) | 393 |
| Card | `src/ui/Card.vue` | Bordered surface container | 19 |
| Checkbox | `src/ui/Checkbox.vue` | Checkbox input | 70 |
| Input | `src/ui/Input.vue` | Text input w/ variants | 407 |
| LoadingState | `src/ui/LoadingState.vue` | Loading placeholder row | 47 |
| Popover | `src/ui/Popover.vue` | Positioned popover overlay | 137 |
| SectionLabel | `src/ui/SectionLabel.vue` | Uppercase section heading + count | 40 |
| Spinner | `src/ui/Spinner.vue` | Loading spinner | 62 |
| SubPageHeaderBase | `src/ui/SubPageHeaderBase.vue` | Sub-page header (router-free base) | 118 |
| Tag | `src/ui/Tag.vue` | Bordered mono-uppercase pill (neutral/test/warn) | 37 |
| Toast | `src/ui/Toast.vue` | Single toast item (kind-colored left border) | 70 |
| ToastManagerBase | `src/ui/ToastManagerBase.vue` | Transient single-toast teleport region | 105 |
| Toggle | `src/ui/Toggle.vue` | Switch/toggle input | 112 |
| Tooltip | `src/ui/Tooltip.vue` | Positioned tooltip | 280 |
| AddressDisplay | `src/composite/AddressDisplay.vue` | Truncated address + copy-to-clipboard | 69 |
| BalanceRow | `src/composite/BalanceRow.vue` | Token balance line item | 55 |
| DisclaimerTag | `src/composite/DisclaimerTag.vue` | `<Tag tone="test">` wrapper, fixed copy | 7 |
| DripButton | `src/composite/DripButton.vue` | Faucet drip CTA button | 34 |
| EmojiGrid | `src/composite/EmojiGrid.vue` | Passkey/emoji verification grid | 46 |
| useOutside | `src/composables/outside.ts` | Click-outside detection | 61 |
| useToast | `src/composables/toast.ts` | Toast queue state | 44 |

Non-component modules: `severity.ts` (7), `color-names.ts` (11), `layout-names.ts` (25),
`theme-vars.ts` (91), `theme-contrast.ts` (124), `token-contract.ts` (151, source of generated
`tokens.ts`), `testing.ts` (9), `internal/sanitize.ts` (18), `internal/render-css.ts` (50),
`internal/render-tokens.ts` (60).

**Total components: 27** (4 core + 17 ui + 5 composite + 1 composable pair). Excludes tests, stories,
`src/fonts`, generated `tokens.ts`/`utilities.css`.

## 2) Public exports (`src/index.ts`)

- **core**: `Flex`, `Icon`, `MaterialIcon`, `Text`
- **ui**: `Badge`, `Banner`, `BrutalistTitle`, `Button`, `Card`, `Checkbox`, `Input`, `LoadingState`,
  `Popover`, `SectionLabel`, `Spinner`, `SubPageHeaderBase`, `Tag`, `Toast`, `ToastManagerBase`,
  `Toggle`, `Tooltip`
- **composite**: `AddressDisplay`, `BalanceRow`, `DisclaimerTag`, `DripButton`, `EmojiGrid`
- **composables**: not barrel-exported; consumed via `@nulo/design/composables/*` subpath
  (`outside.ts`, `toast.ts`)
- **types/vocab**: `SeverityTone`, `TextColorName`, `FlexAlign/Direction/Gap/Justify/Wrap`, `TextAlign`

`package.json#exports` also opens `./core/*`, `./ui/*`, `./composite/*`, `./composables/*`,
`./testing`, `./base.css` as direct subpaths (bypassing the barrel).

## 3) Coupling surfaces

- **Host wrappers** (3): extension keeps thin local wrappers over `Button`, `SubPageHeaderBase`
  (→`SubPageHeader`), `ToastManagerBase` (→`ToastManager`) to inject router/toast-root DOM contract.
- **Severity vocabulary** shared by `Badge`/`Banner`/`Toast` via `severity.ts`'s `SeverityTone`,
  but each renders its OWN color mapping (background vs icon-fill vs left-border) — deliberate
  per the file's doc comment, not accidental duplication.
- **Consumers**: 42 files across `apps/extension` + `apps/faucet` import `@nulo/design` directly.
- **ToastManagerBase** couples to a host DOM contract (`teleportTo`, default `#toast`) — each
  consuming app shell must declare that root.
- **Icon** depends on a static bundled `internal/icons.json`; **MaterialIcon** depends on the
  consumer having loaded the Material Symbols font — two independent icon-loading contracts.

## 4) One-level dependency sketch

```
index.ts ─┬─ core/{Flex,Icon,MaterialIcon,Text}.vue
          ├─ ui/*.vue        (Badge, Banner, Card, Popover, Toast, Tooltip → import core/Flex,Icon,Text)
          ├─ composite/*.vue (AddressDisplay/BalanceRow/EmojiGrid: own styles, no core import;
          │                   DripButton → ui/Button; DisclaimerTag → ui/Tag)
          ├─ tokens.ts (generated ← token-contract.ts)
          ├─ severity.ts, color-names.ts, layout-names.ts (shared prop-type vocab)
          └─ composables/{outside,toast}.ts (subpath-exported, not barrel)
base.css, utilities.css ← both generated by scripts/gen-tokens.ts from token-contract.ts
```
No cross-imports between `ui/*` siblings except `Banner.vue → Spinner.vue`. `composite/*` mostly
self-contained, not built on `ui/Card`/`ui/Tag` except `DisclaimerTag`.

## 5) Generated / vendored paths

- `src/tokens.ts` — **GENERATED** from `token-contract.ts` via `scripts/gen-tokens.ts`. Do not
  hand-edit; `tokens.drift.test.ts` / `tokens.parity.test.ts` guard it.
- `src/utilities.css` — **GENERATED**, same pipeline; `utilities.drift.test.ts` guards it.
- `src/base.css` — partially generated (token block) + hand-authored layout/reset; not fully
  generated so not excluded, flagged here for awareness.
- `src/fonts/` — excluded per scope (vendored fonts, package-relative referenced from `base.css`).
- `src/internal/icons.json` — vendored icon path data consumed by `Icon.vue`.

## 6) APPARENT DUPLICATION candidates (this audit's focus)

1. **Bordered-surface "box" pattern reimplemented 5×**: `ui/Card.vue`, `ui/Tag.vue`, `ui/Toast.vue`,
   `composite/AddressDisplay.vue`, `composite/EmojiGrid.vue` each hand-roll
   `border: 1px solid var(--nulo-outline)` + a `--nulo-surface*` background as raw scoped CSS,
   independently. No shared box/surface mixin or base class exists — same visual primitive,
   5 copies, 5 places to drift.
2. **Severity/tone-to-color mapping duplicated 4×**: `Badge`, `Banner`, `Toast`, and
   `ToastManagerBase` each independently switch on a tone/color string to pick
   info/warning/error/ok/done colors (`Badge`→background, `Banner`→icon fill, `Toast`→left border,
   `ToastManagerBase`→raw `red|green|orange`, a 4th axis not even using `SeverityTone`).
   `severity.ts`'s doc comment calls this deliberate (vocab-only, not palette-unified) — flagged as
   owner-acknowledged, worth revisiting given 4 implementations vs. the 3 the comment describes.
3. **Two parallel icon systems**: `core/Icon.vue` (custom SVG set from `icons.json`) and
   `core/MaterialIcon.vue` (Material Symbols font) — both exported, same prop shape, no documented
   rule for when to use which.
4. **Uppercase-mono-label micro-pattern repeated ad hoc**: `Tag.vue`, `SectionLabel.vue`,
   `Toast.vue`'s `.toast__link`, `Banner.vue`'s `.action_btn`, `AddressDisplay.vue`'s
   `.copied-hint` each independently declare mono/headline font + letter-spacing + uppercase at
   slightly different values — no shared "eyebrow label" utility despite `utilities.css` existing.
5. **`Button.vue` (393) / `Input.vue` (407)** are the two largest files by far (next is `Tooltip.vue`
   at 280) — flagged for a variant-block duplication pass in the deeper audit, not yet read in full.
