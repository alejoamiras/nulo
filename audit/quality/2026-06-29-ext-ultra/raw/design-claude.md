# `@nulo/design` — QUALITY audit (typing + dedup lens)

Cluster: `packages/design/src/**` (excludes `*.test.ts`, generated `tokens.ts`/`utilities.css`, fonts,
`icons.json`). Vue-aware. Focus = maintainability/change-cost only. Correctness/security spotted in
passing are in the `## Out-of-focus notes` tail.

The single dominant theme: **the package ships its own typed token unions (`tokens.ts:94-101`:
`FontSize`, `FontWeight`, `LineHeight`, `ColorToken`, `TextToken`, `SurfaceToken`, `BrandToken`,
`FontToken`) and the canonical member lists (`token-contract.ts`), then ~13 of the older primitives
ignore both** — re-typing every variant/size/color as bare `string` and re-hardcoding the member
lists as runtime arrays. The SSOT exists and is shipped; half the package doesn't consume it.

---

### Q1 Bare-`string` variant/size/color props ignore the shipped token unions
- Smell: Primitive Obsession + Stringly-Typed (analog: the typed unions exist in `tokens.ts` and are bypassed)
- Lens: typing
- Maintenance impact: architectural
- Blast radius: ~9 primitives + every call site — **542 `<Text|Icon … color=>` sites** and **59 `variant=` files** in the consumers get zero compile-time protection
- Instances (the OLD Options-style, bare-`string` enum props):
  - `core/Text.vue:5-19` — `size`, `weight`, `height`, `align`, `color` all `type: String` (should be `FontSize`, `FontWeight`, `LineHeight` keys, `textAligns` keys, `ColorToken`/`TextToken`)
  - `core/Icon.vue:11-13` — `size: [String, Number]`, `color: String`, `hoverColor: String`
  - `core/MaterialIcon.vue:9-14` — `size: [Number, String]`, `color: String` (default `"primary"`)
  - `core/Flex.vue:11-42` — `align`, `justify`, `wrap`, `direction`, `gap` all `type: String`
  - `ui/Badge.vue:5-8` — `variant: String` (closed set info/warning/error/purple)
  - `ui/Banner.vue:13-19` — `variant: String`, `direction: String` (closed: horizontal/vertical)
  - `ui/Toggle.vue:8` — `color: String` bound straight to inline `style.background` (`Toggle.vue:30`)
  - `ui/Popover.vue:29-32` — `side: String` (closed left/right)
  - `ui/Tooltip.vue:9-24` — `side`, `position`, `textAlign` all `String`
- The shipped-but-ignored SSOT: `tokens.ts:94-101` exports exactly these unions; `token-contract.ts:106-151` holds the member maps (`textColors`, `textAligns`, `flexAlignments`, `flexWraps`, `flexDirections`).
- Contrast — the NEW typed convention already in the package proves the better shape is available and in use: `ui/Tag.vue:3-4` (`Tone` union), `ui/Toast.vue:2-11` (`Kind` union), `ui/Spinner.vue:10`, `ui/BrutalistTitle.vue:14-19` (`align`/`size` unions), `ui/SubPageHeaderBase.vue` + all 5 composites use `defineProps<{…}>()`. So the package is split down the middle by **two prop-typing conventions** (Divergent Change risk).
- Sub-smell — Data Clump / no shared `Size` type: `size` is typed three different ways — `Icon`/`SectionLabel`/`MaterialIcon` `[String, Number]`, `Button`/`Input` `String`, `Spinner` `string|number`.
- Why it harms future change: renaming or removing a token (`tertiary`, `primary_outline`, a `fz--N` step) is invisible to the compiler — `vue-tsc` passes, the class silently doesn't exist, the bug surfaces only at runtime in one of 542 sites. No autocomplete at any call site. New contributors guess the vocabulary from sibling files.
- Refactoring: Replace Type Code with the existing union types — type these props as `FontSize`/`ColorToken`/keyof maps imported from `./tokens`/`./token-contract`, migrating the OLD primitives to `defineProps<{}>()` like the NEW half already does.
- Effort: days
- Confidence: high

### Q2 `Checkbox` array-form `defineProps` — every prop implicit `any`
- Smell: Primitive Obsession (worst case — no type at all)
- Lens: typing
- Maintenance impact: local
- Blast radius: 1 component, but it's the package's only fully-untyped public surface
- Instances: `ui/Checkbox.vue:5` — `defineProps(["modelValue", "checked", "disabled"])`
- Evidence: array form gives `modelValue`/`checked`/`disabled` all type `any`; `:checked` is a boolean visual state and `modelValue` a boolean v-model, but nothing enforces it — a caller can pass a string and the template `modelValue || checked` coerces silently.
- Why it harms future change: it is the one primitive with no contract at all, and it sits one floor under every form. A v-model shape change can't be caught at the seam.
- Refactoring: convert to `defineProps<{ modelValue?: boolean; checked?: boolean; disabled?: boolean }>()` (matches `Toggle.vue:5-9`, its sibling).
- Effort: hours
- Confidence: high

### Q3 `Button` variant/size as `string` + unguarded `style[variant]` indexing
- Smell: Stringly-Typed + Missing exhaustiveness (analog: closed set documented in JSDoc, enforced nowhere)
- Lens: typing
- Maintenance impact: structural
- Blast radius: 59 `variant=` files; the most-used primitive in the app
- Instances:
  - `ui/Button.vue:23-26` — `variant: { type: String, default: "primary" }`, with the closed 8-variant set written out in JSDoc immediately above (`Button.vue:12-22`).
  - `ui/Button.vue:8-11` — `size: String` (closed 6-size set hard-coded again at `Button.vue:73`).
  - `ui/Button.vue:72-82` `getStyles()` — `style[props.variant]` is string-indexed with **no variant guard** (`hasCorrectSize` guards `size` only). An unknown variant yields `style[undefined]` → an unstyled button, no error.
- Why it harms future change: the JSDoc is the spec but rots independently of the type; a typo'd `variant="primary-outline"` (hyphen vs underscore) compiles and renders unstyled. Adding a 9th variant means editing JSDoc, CSS, and the `size` guard array with nothing tying them together.
- Refactoring: Replace Type Code with a `ButtonVariant`/`ButtonSize` union (or `keyof` a const map), drop the JSDoc enum, and let the union drive both the prop and a `Record<ButtonVariant, string>` style lookup so a missing key is a compile error.
- Effort: hours
- Confidence: high

### Q4 Runtime `validator` arrays re-hardcode the token-contract member lists
- Smell: Duplicate Code (SSOT duplication)
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 2 files, 6 arrays, all duplicating `token-contract.ts`
- Instances:
  - `core/Flex.vue:19` and `core/Flex.vue:25` — `["center","between","around","evenly","start","end"]` (×2) duplicate the keys of `flexAlignments` (`token-contract.ts:133-140`)
  - `core/Flex.vue:31` — `["nowrap","wrap","wrapReverse"]` duplicates `flexWraps` keys (`token-contract.ts:143`)
  - `core/Flex.vue:37` — `["column","columnReversed","row","rowReversed"]` duplicates `flexDirections` keys (`token-contract.ts:146-151`)
  - `ui/Tooltip.vue:13` — `["top","bottom","left","right"]`; `ui/Tooltip.vue:20` — `["start","end","center"]` (no contract entry — pure local literals)
- Evidence: the canonical lists already exist as `as const` maps in `token-contract.ts`; these components copy the member names as string literals into runtime validators. Each `validator(value)` param is also implicit-`any`, cast `value as string` inside (`Flex.vue:19-37`).
- Why it harms future change: add a flex alignment to the contract and three validators silently reject it; the validator and the union drift with no test linking them. Classic two-places-to-edit.
- Refactoring: Extract Constant — derive the validator membership and the prop type from the same `Object.keys(flexAlignments)`/union, so the array IS the contract.
- Effort: hours
- Confidence: high

### Q5 Per-variant semantic-color CSS maps duplicated ×4 with divergent vocabularies
- Smell: Duplicate Code + Primitive Obsession on status colors (no shared severity token)
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 4 components, 4 incompatible status vocabularies
- Instances:
  - `ui/Badge.vue:22-40` — `.info / .warning / .error / .purple`
  - `ui/Banner.vue:83-115` — `.info / .done / .warning / .error`
  - `ui/Toast.vue:44-46` — `.toast--ok / --error / --info`
  - `ui/ToastManagerBase.vue:21-27` (JS `variantClass` mapping `red→variant_red`, `green`, `orange`) + `ui/ToastManagerBase.vue:91-101` (the `.variant_*` rules)
- Evidence: four components each invent a status→color mapping by hand (`warning`→`--orange`, `error`→`--red`, `done`/`ok`/`green`→`--green`/`--mint`) with **no shared status-token set**. The vocabularies don't even agree (`done` vs `ok` vs `green`; `warning` vs `orange`).
- Why it harms future change: a brand decision like "warnings are amber now" requires finding and editing every component's private map; a new severity has no canonical name. Shotgun-surgery on any status-color change.
- Refactoring: Extract a `statusColors` map into `token-contract.ts` (e.g. `{ info, success, warning, error }` → CSS vars) and a shared `Severity` union; collapse the four hand-maps onto it.
- Effort: days
- Confidence: moderate (the visual treatments differ — border vs bg vs left-rule — so unify the *vocabulary + token*, not necessarily the CSS)

### Q6 Two parallel toast systems with divergent color vocabularies
- Smell: Duplicate Code / Divergent Change (documented as intentional, still costs)
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 2 components + 1 composable
- Instances:
  - `ui/Toast.vue` — dismissible faucet item, `Kind = "ok"|"error"|"info"` (`Toast.vue:2-11`)
  - `ui/ToastManagerBase.vue` + `composables/toast.ts` — extension transient singleton, color `"red"|"green"|"orange"` (`ToastManagerBase.vue:21-27`, `toast.ts:13-44`)
- Evidence: two toast surfaces with no shared type, no shared color vocabulary (`ok|error|info` vs `red|green|orange`), and `ToastOptions.color` (`toast.ts:16`) is bare `string` (Q1 again). README and `index.ts:38-40` document the split as deliberate (faucet item vs extension region).
- Why it harms future change: a future "unify toasts" or "add a warning toast" touches two type systems; the color/`Kind` divergence guarantees a translation layer. Confirm with owner whether the split is permanent before merging.
- Refactoring: at minimum share a `Severity`/`Kind` union (overlaps Q5) and type `ToastOptions.color`; full merge only if the owner agrees the two surfaces should converge.
- Effort: days
- Confidence: moderate

### Q7 Extension wrappers re-declare + re-forward the entire base prop contract (cross-package)
- Smell: Shotgun Surgery + Boilerplate-per-consumer (cross-package prop duplication)
- Lens: dedup + typing
- Maintenance impact: structural
- Blast radius: 2 wrapper files mirroring 2 design bases; any base-prop change is a 3-place edit
- Instances (owned by the extension cluster; flagged here because the duplication is *of this package's surface*):
  - `packages/extension/src/components/ui/Button.vue:18-30` re-declares the full base contract (`size, variant, wide, disabled, loading, leftIcon, leftIconColor, rightIcon, rightIconColor, target` + local `link`) and re-forwards each prop verbatim **in both `v-if`/`v-else` branches** (`Button.vue:35-66`). `<script setup>` has **no `lang="ts"`** → `type: String` again, no union — Q1/Q3's typing regresses across the seam.
  - `packages/extension/src/components/ui/SubPageHeader.vue:7-29` re-declares + re-forwards `title, showBack, leadingIcon, leadingIconColor` (+ `backTo`) — same verbatim dup, untyped JS (`SubPageHeader.vue:48-54`).
  - `packages/extension/src/components/ui/ToastManager.vue` — thin (renders base, no prop dup); fine, kept as the contrast case.
- Evidence: adding one base prop to `@nulo/design`'s `Button`/`SubPageHeaderBase` requires hand-mirroring it in the wrapper's `defineProps` **and** in each forwarding branch, with no compiler help because the wrapper is untyped JS.
- Why it harms future change: the wrapper silently drops any base prop it forgets to mirror; the typed base contract becomes `string`-typed at the wrapper boundary, erasing the Q1/Q3 fix for the extension's most common button.
- Refactoring: export a `ButtonBaseProps` type from `@nulo/design` and have the wrappers `defineProps<ButtonBaseProps & { link?: string }>()` + `v-bind="props"` (or `v-bind="$attrs"`-through), killing the verbatim per-prop forwarding and restoring type parity. Switch the wrappers to `lang="ts"`.
- Effort: hours
- Confidence: high

---

## Minor / borderline (cited, not scored as primary — included so instances are on record)

- **`Input` modelValue-union cast cascade** — `ui/Input.vue:103` types `text` as `string|number|null|undefined`, forcing ~10 `as string` casts at string-op sites (`Input.vue:140,146,147,150,159,162,163,211,214,215,216`) plus `window as unknown as { clipboardData }` (`Input.vue:210`). Primitive Obsession on the modelValue union. The pin comment (`Input.vue:101-102`) marks it intentional/verbatim-preserved → leave unless the modelValue contract is revisited. Confidence: high it's a smell, low it's worth touching given the explicit pin.
- **Color-string `--`-prefix reinterpretation scattered** — `ui/Spinner.vue:18` (`startsWith("--") ? var() : verbatim`), `core/Icon.vue:36-47` (currentColor default + `fill--` class), `theme-contrast.ts:69-93` (`resolveColor`). Each reinterprets a color string independently; only loosely duplicative (runtime inline-style vs test-time resolver) — Extract a tiny `cssColor(str)` helper *only* if a third runtime consumer appears, else incidental. Confidence: moderate.
- **Class-builder boilerplate shape in `Flex`/`Text`/`Icon`** — `core/Flex.vue:49-72`, `core/Text.vue:38-70`, `core/Icon.vue:41-45` share the `computed(() => { const c=[]; if (prop) c.push(\`pfx--${prop}\`)… })` shape with different prefixes/conditionals. **Do NOT abstract** — this is incidental similarity (different prefixes, different prop sets); a shared helper would be Speculative Generality and harder to read than the inline pushes. Listed only to pre-empt a false "dedup this" instinct. Confidence: high (that it should be left alone).

## Out-of-focus notes (correctness — for the bugs focus, not scored here)
- `ui/Popover.vue:14,84` — documented (BUG PIN) NPE: `removeOutside` is `null` until the open-branch `nextTick`; if `open` flips false first, `(removeOutside as () => void)()` throws. Already pinned verbatim.
- `composables/outside.ts:55` — `remove()` calls `removeEventListener(element.value as EventTarget)` unconditionally; throws if the ref cleared first. Verbatim-preserved, noted in the file.

## Summary
8 findings (Q1-Q7 + a minor tail). Highest-value: **Q1 — ~9 primitives type every variant/size/color
as bare `string`, ignoring the `ColorToken`/`FontSize`/`FontWeight`/`LineHeight` unions the package
already ships in `tokens.ts`, leaving 542 `color=` + 59 `variant=` call sites with zero compile-time
protection.**
