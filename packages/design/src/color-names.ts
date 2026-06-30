import { textColors } from "./token-contract"

/**
 * Utility color NAMES accepted by `color` props (Icon, MaterialIcon, Toggle,
 * SubPageHeader, Text, …) — the KEYS of {@link textColors} (`"primary"`,
 * `"secondary"`, `"red"`, …).
 *
 * Distinct from `ColorToken` (the CSS-var VALUES like `"--red"`): components pass
 * the NAME, not the var, so `ColorToken` is the wrong type for these props.
 */
export type TextColorName = keyof typeof textColors
