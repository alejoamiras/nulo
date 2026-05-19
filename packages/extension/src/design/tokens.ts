/**
 * Design tokens — typed reflection of the CSS variables declared in
 * `src/assets/styles/_base.scss` and `src/popup/index.scss`.
 *
 * This file is the SINGLE SOURCE OF TRUTH for token names. It does NOT
 * rewrite any CSS — every value still lives in the SCSS file as
 * `--var: value`. This file just gives TypeScript callers a typed
 * handle on those names so they can:
 *
 *   1. Autocomplete token names instead of guessing/copying strings.
 *   2. Catch typos at compile time (`var(--txt-primry)` would compile
 *      today; with these tokens, `text.primry` doesn't).
 *   3. Discover the available token surface via type lookup.
 *
 * Conventions:
 *   - Every export is `as const` so values are literal types.
 *   - String values are CSS variable NAMES (e.g., `"--txt-primary"`),
 *     not `var(...)` wrappers. Use `cssVar()` to wrap when you need
 *     the inline-style form.
 *   - `numericSizes` etc. are the actual numeric scales (used by the
 *     `.fz--N` / `.fw--N` / `.lh--N` utility classes in `_text.scss`).
 *
 * Usage:
 *   import { text, cssVar } from "@/design/tokens"
 *   const style = { color: cssVar(text.primary) }   // → "var(--txt-primary)"
 *
 * Theme awareness:
 *   The light/dark theme switch is implemented at the CSS layer in
 *   _base.scss via `[theme="light"]` / `[theme="dark"]` overrides.
 *   These tokens are intentionally theme-agnostic — they reference the
 *   variable name; the CSS resolves to the right value per theme.
 */

// ─── Surfaces ─────────────────────────────────────────────────────────────────

/** Background and surface colors (panels, cards, popovers). */
export const surfaces = {
	appBg: "--app-bg",
	cardBg: "--card-bg",
	tooltipBg: "--tooltip-bg",
	dropdownBg: "--dropdown-bg",
	nuloSurface: "--nulo-surface",
	nuloSurfaceLow: "--nulo-surface-low",
	nuloSurfaceHigh: "--nulo-surface-high",
	nuloSurfaceHighest: "--nulo-surface-highest",
} as const

// ─── Brand ────────────────────────────────────────────────────────────────────

/** Brand identity tokens (accent, outlines, borders specific to the
 *  Nulo brutalist palette). */
export const brand = {
	accent: "--nulo-accent",
	secondary: "--nulo-secondary",
	outline: "--nulo-outline",
	border: "--nulo-border",
} as const

// ─── Text ─────────────────────────────────────────────────────────────────────

/** Foreground text colors, organized by emphasis. */
export const text = {
	primary: "--txt-primary",
	secondary: "--txt-secondary",
	body: "--txt-body",
	tertiary: "--txt-tertiary",
	support: "--txt-support",
	white: "--txt-white",
	inverse: "--txt-inverse",
} as const

// ─── Borders ──────────────────────────────────────────────────────────────────

export const borders = {
	default: "--border",
	hovered: "--border-hovered",
} as const

// ─── Buttons (legacy primaries) ───────────────────────────────────────────────

/**
 * Legacy button-bg tokens. Listed here so the inventory stays complete;
 * `Button.vue`'s variant system supersedes them for new call sites.
 */
export const button = {
	primaryBg: "--btn-primary-bg",
	redBg: "--btn-red-bg",
} as const

// ─── Semantic / accent colors ─────────────────────────────────────────────────

/**
 * Brand-neutral hue tokens. Used for status / category accents
 * (transaction success/fail badges, log levels, etc.).
 */
export const colors = {
	white: "--white",
	black: "--black",
	blue: "--blue",
	green: "--green",
	mint: "--mint",
	neutralMint: "--neutral-mint",
	orange: "--orange",
	yellow: "--yellow",
	red: "--red",
	purple: "--purple",
	gray: "--gray",
	sand: "--sand",
} as const

// ─── Typography ───────────────────────────────────────────────────────────────

/** Font family tokens. */
export const fonts = {
	headline: "--font-headline",
	body: "--font-body",
	mono: "--font-mono",
} as const

/**
 * Font size scale (matches `.fz--N` utility classes in _text.scss).
 * Values are pixel sizes; the utility class is applied to elements.
 */
export const fontSizes = [8, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 26, 28, 32, 36, 38, 40] as const

/**
 * Font weights (matches `.fw--N` utility classes in _text.scss).
 */
export const fontWeights = [400, 500, 600, 700] as const

/**
 * Line height scale (matches `.lh--N` utility classes in _text.scss).
 * Keys are the `N` in `.lh--N` (where 100 → line-height: 1.0); values
 * are the actual unitless line-height multiplier.
 */
export const lineHeights = {
	100: 1,
	110: 1.1,
	120: 1.2,
	130: 1.3,
	140: 1.4,
	150: 1.5,
	160: 1.6,
	180: 1.8,
} as const

// ─── Motion ───────────────────────────────────────────────────────────────────

/** Custom cubic-bezier easing curve used across the brutalist redesign. */
export const easings = {
	bezier: "--bezier",
} as const

/**
 * Transition durations sampled from existing CSS (see `_base.scss`
 * `.slide-*-active`, `.fade-*-active`, etc.). Listed here as the
 * informal duration scale; not consumed by typed callers yet.
 */
export const durations = {
	short: "150ms",
	medium: "200ms",
	long: "300ms",
} as const

// ─── Layout ───────────────────────────────────────────────────────────────────

/**
 * Popup viewport / chrome dimensions. Used by `popup/index.scss` to
 * size the body element.
 */
export const layout = {
	baseWidth: "--base-width",
	baseHeight: "--base-height",
	navClearance: "--nav-clearance",
} as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wrap a CSS-variable name in `var(...)` for use in inline styles or
 * computed style objects.
 *
 * @example
 *   cssVar(text.primary)        // → "var(--txt-primary)"
 *   cssVar(text.primary, "#0a0908") // → "var(--txt-primary, #0a0908)" (with fallback)
 */
export const cssVar = (name: string, fallback?: string): string => (fallback === undefined ? `var(${name})` : `var(${name}, ${fallback})`)

// ─── Type exports (for consumers that want to constrain inputs) ──────────────

export type SurfaceToken = (typeof surfaces)[keyof typeof surfaces]
export type BrandToken = (typeof brand)[keyof typeof brand]
export type TextToken = (typeof text)[keyof typeof text]
export type ColorToken = (typeof colors)[keyof typeof colors]
export type FontToken = (typeof fonts)[keyof typeof fonts]
export type FontSize = (typeof fontSizes)[number]
export type FontWeight = (typeof fontWeights)[number]
export type LineHeight = keyof typeof lineHeights
