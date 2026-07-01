import type { flexAlignments, flexDirections, flexGaps, flexWraps, textAligns } from "./token-contract"

/**
 * Layout prop unions for the core `Flex` / `Text` primitives, derived from the
 * hand-source `token-contract.ts` maps (NOT the generated `tokens.ts`). Kept in a
 * hand-file — same pattern as `severity.ts` / `color-names.ts` — because the
 * generator only emits color + font scalars, not these layout key sets.
 */

/** `Flex align` / `Flex justify` — the flexbox main/cross alignment keys (`center`, `between`, …). */
export type FlexAlign = keyof typeof flexAlignments
export type FlexJustify = keyof typeof flexAlignments

/** `Flex wrap` — `nowrap` | `wrap` | `wrapReverse`. */
export type FlexWrap = keyof typeof flexWraps

/** `Flex direction` — `row` | `column` | `rowReversed` | `columnReversed`. */
export type FlexDirection = keyof typeof flexDirections

/** `Flex gap` — a spacing-scale step (numeric token, e.g. `10`). Static Vue attrs arrive as strings, so
 *  call sites also accept the stringified form (`gap="10"`); see the prop type in `Flex.vue`. */
export type FlexGap = (typeof flexGaps)[number]

/** `Text align` — `center` | `left` | `right`. */
export type TextAlign = keyof typeof textAligns
