/**
 * Canonical source of truth for Nulo's design-token NAMES, scales, and durations.
 *
 * Authored from `packages/extension/src/assets/styles/_base.scss` (the live CSS-var set) and the
 * extension's `design/tokens.ts` (the canonical typed API shape). The public typed reflection in
 * `src/tokens.ts` is GENERATED from this file by `scripts/gen-tokens.ts` — never hand-edit the
 * generated file; run `bun run gen:tokens`. `tokens.drift.test.ts` fails CI on divergence.
 *
 * Per-theme VALUES (used to generate `base.css`) are added in round-1 Phase 2 (the base takeover)
 * and validated there by the base-parity check; Phase 1 needs only names + scales + durations.
 *
 * Members are CSS-variable NAMES (e.g. `"--txt-primary"`), not `var(...)` wrappers.
 */

/** Ordered token groups. Each is emitted as a top-level `export const <group>` in tokens.ts. */
export const tokenGroups = {
	surfaces: {
		appBg: "--app-bg",
		cardBg: "--card-bg",
		tooltipBg: "--tooltip-bg",
		dropdownBg: "--dropdown-bg",
		nuloSurface: "--nulo-surface",
		nuloSurfaceLow: "--nulo-surface-low",
		nuloSurfaceHigh: "--nulo-surface-high",
		nuloSurfaceHighest: "--nulo-surface-highest",
	},
	brand: {
		accent: "--nulo-accent",
		secondary: "--nulo-secondary",
		outline: "--nulo-outline",
		border: "--nulo-border",
	},
	text: {
		primary: "--txt-primary",
		secondary: "--txt-secondary",
		body: "--txt-body",
		tertiary: "--txt-tertiary",
		support: "--txt-support",
		white: "--txt-white",
		inverse: "--txt-inverse",
	},
	borders: {
		default: "--border",
		hovered: "--border-hovered",
	},
	button: {
		primaryBg: "--btn-primary-bg",
		redBg: "--btn-red-bg",
	},
	colors: {
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
	},
	fonts: {
		headline: "--font-headline",
		body: "--font-body",
		mono: "--font-mono",
	},
	easings: {
		bezier: "--bezier",
	},
	layout: {
		baseWidth: "--base-width",
		baseHeight: "--base-height",
		navClearance: "--nav-clearance",
	},
} as const

/** Font-size scale (px). Matches `.fz--N` in the extension's `_text.scss`. */
export const fontSizes = [8, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 26, 28, 32, 36, 38, 40] as const

/** Font weights. Matches `.fw--N`. */
export const fontWeights = [400, 500, 600, 700] as const

/** Line-height scale: key is the `N` in `.lh--N`; value is the unitless multiplier. */
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

/** Informal transition-duration scale (literal values, not CSS vars). */
export const durations = {
	short: "150ms",
	medium: "200ms",
	long: "300ms",
} as const
