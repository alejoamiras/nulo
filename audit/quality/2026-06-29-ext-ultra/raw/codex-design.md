### DQ-1 Public prop contracts leave closed domains as `string` / `any`
- Smell: Primitive Obsession / Stringly-Typed
- Lens: typing
- Maintenance impact: structural
- Blast radius: 16 files/modules
- Instances: `token-contract.ts:76`, `token-contract.ts:79`, `token-contract.ts:82`, `token-contract.ts:106`, `token-contract.ts:127`, `token-contract.ts:130`, `token-contract.ts:133`, `token-contract.ts:143`, `token-contract.ts:146`; `internal/render-tokens.ts:48`; loose consumers: `core/Flex.vue:16`, `core/Flex.vue:22`, `core/Flex.vue:28`, `core/Flex.vue:34`, `core/Flex.vue:40`; `core/Text.vue:5`, `core/Text.vue:8`, `core/Text.vue:11`, `core/Text.vue:15`, `core/Text.vue:18`; `core/Icon.vue:11`, `core/Icon.vue:12`, `core/Icon.vue:13`; `core/MaterialIcon.vue:9`, `core/MaterialIcon.vue:13`; `ui/Button.vue:8`, `ui/Button.vue:23`, `ui/Button.vue:56`, `ui/Button.vue:64`; `ui/Input.vue:16`, `ui/Input.vue:24`, `ui/Input.vue:27`, `ui/Input.vue:59`; `ui/Badge.vue:5`; `ui/Banner.vue:12`, `ui/Banner.vue:16`; `ui/Checkbox.vue:5`; `ui/Toggle.vue:8`; `ui/Popover.vue:29`; `ui/Tooltip.vue:9`, `ui/Tooltip.vue:16`, `ui/Tooltip.vue:24`; `ui/Spinner.vue:10`; `ui/SubPageHeaderBase.vue:23`
- Evidence: generated token unions are emitted from the contract (`FontSize`, `FontWeight`, `LineHeight`, `ColorToken`, etc.) at `internal/render-tokens.ts:48-55`, but public SFC props still accept open strings and interpolate them into utility classes (`Flex.vue:52-65`, `Text.vue:41-54`, `Icon.vue:43`, `MaterialIcon.vue:30`). `Button` documents an 8-member variant set in JSDoc (`ui/Button.vue:12-25`) but indexes `$style[props.variant]` unguarded (`ui/Button.vue:77`). `Checkbox` uses array-form props, so `modelValue` / `checked` / `disabled` are implicit `any` (`ui/Checkbox.vue:5`). `Input`’s broad `[String, Number]` model leaks into `text: string | number | null | undefined` (`ui/Input.vue:59-61`, `ui/Input.vue:101-103`) and forces repeated `as string` casts (`ui/Input.vue:140`, `ui/Input.vue:146`, `ui/Input.vue:147`, `ui/Input.vue:150`, `ui/Input.vue:159`, `ui/Input.vue:163`, `ui/Input.vue:213`, `ui/Input.vue:215`, `ui/Input.vue:216`).
- Why it harms future change: renaming a token, adding a size, or changing a variant compiles even when call sites typo the string; the failure becomes a missing CSS class or `style[undefined]` instead of a type error.
- Refactoring: Replace Magic String with Symbolic Constant + Introduce Type Alias -> export prop unions from token-contract/generated token types, type `defineProps<>()`, and give `ButtonVariant` / `ButtonSize` / `TextColor` / `FlexGap` shared aliases.
- Effort: days
- Confidence: high

### DQ-2 Runtime validators re-hardcode token-contract member lists
- Smell: Duplicate Code / Schema-Type Drift
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 4 files/modules
- Instances: canonical lists in `token-contract.ts:133`, `token-contract.ts:143`, `token-contract.ts:146`; generated CSS consumes them at `internal/render-css.ts:40`, `internal/render-css.ts:46`, `internal/render-css.ts:47`; duplicate runtime lists in `core/Flex.vue:19`, `core/Flex.vue:25`, `core/Flex.vue:31`, `core/Flex.vue:37`; local duplicate placement lists in `ui/Tooltip.vue:12`, `ui/Tooltip.vue:19`, with matching switch domains at `ui/Tooltip.vue:66`, `ui/Tooltip.vue:70`, `ui/Tooltip.vue:85`, `ui/Tooltip.vue:88`, `ui/Tooltip.vue:103`, `ui/Tooltip.vue:106`, `ui/Tooltip.vue:121`, `ui/Tooltip.vue:124`
- Evidence: `Flex` repeats the same alignment/wrap/direction keys already owned by `token-contract.ts`; the validator params are loose enough that each validator casts `value as string`. `Tooltip` repeats its side/position domains once in validators and again in switch statements.
- Why it harms future change: adding `stretch`, renaming `wrapReverse`, or adding a tooltip placement requires synchronized edits across the contract, generated utility CSS, validator arrays, and control-flow cases.
- Refactoring: Extract Shared Constants + Replace Conditional with Lookup Table -> one const tuple per domain drives the union type, validator, CSS utility generation, and placement math.
- Effort: hours
- Confidence: high

### DQ-3 Status color semantics are duplicated across notification surfaces
- Smell: Duplicate Code + Primitive Obsession
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 5 files/modules
- Instances: `ui/Badge.vue:5`, `ui/Badge.vue:22`, `ui/Badge.vue:27`, `ui/Badge.vue:32`, `ui/Badge.vue:37`; `ui/Banner.vue:12`, `ui/Banner.vue:83`, `ui/Banner.vue:87`, `ui/Banner.vue:97`, `ui/Banner.vue:107`; `ui/Toast.vue:2`, `ui/Toast.vue:17`, `ui/Toast.vue:44`, `ui/Toast.vue:45`, `ui/Toast.vue:46`; `composables/toast.ts:13`, `composables/toast.ts:16`; `ui/ToastManagerBase.vue:21`, `ui/ToastManagerBase.vue:23`, `ui/ToastManagerBase.vue:24`, `ui/ToastManagerBase.vue:25`, `ui/ToastManagerBase.vue:91`, `ui/ToastManagerBase.vue:95`, `ui/ToastManagerBase.vue:99`
- Evidence: the same severity/color idea appears as `info|warning|error|purple` in `Badge`, `info|done|warning|error` in `Banner`, `ok|error|info` in `Toast`, and raw `red|green|orange` strings in `ToastManagerBase` via `ToastOptions.color?: string`.
- Why it harms future change: a new semantic state like `success`, or a color-token migration for warnings/errors, requires edits in four independent CSS/JS maps plus caller vocabulary translation between “ok/done/green”.
- Refactoring: Consolidate Duplicate Conditional Fragments + Replace Type Code with Union -> introduce one `SeverityTone` / semantic color map and let each renderer choose layout while sharing vocabulary and token mapping.
- Effort: days
- Confidence: high

## Likely False Positives
The two toast renderers themselves look deliberate (`Toast.vue` dismissible item vs `ToastManagerBase` singleton). The scored smell is the divergent severity vocabulary and duplicated color mapping, not the existence of two presentational toast layouts.

## Summary
3 findings; highest-value fix is DQ-1, because typing the public design prop contracts turns many token/variant changes from runtime visual drift into compile-time checks.