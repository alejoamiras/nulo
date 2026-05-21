/*
 * Typed reflection of CSS variables declared in design/base.css.
 *
 * Vendored from packages/extension/src/design/tokens.ts and trimmed to the
 * subset the faucet actually uses. Values are CSS variable NAMES, not
 * `var(...)` wrappers. Use `cssVar()` to wrap when needed.
 */

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

export const brand = {
	accent: "--nulo-accent",
	secondary: "--nulo-secondary",
	outline: "--nulo-outline",
	border: "--nulo-border",
} as const

export const text = {
	primary: "--txt-primary",
	secondary: "--txt-secondary",
	body: "--txt-body",
	tertiary: "--txt-tertiary",
	support: "--txt-support",
	white: "--txt-white",
	inverse: "--txt-inverse",
} as const

export const borders = {
	default: "--border",
	hovered: "--border-hovered",
} as const

export const button = {
	primaryBg: "--btn-primary-bg",
	redBg: "--btn-red-bg",
} as const

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
	gray: "--gray",
	sand: "--sand",
} as const

export const fonts = {
	headline: "--font-headline",
	body: "--font-body",
	mono: "--font-mono",
} as const

export const motion = {
	bezier: "--bezier",
} as const

export type CssVarName =
	| (typeof surfaces)[keyof typeof surfaces]
	| (typeof brand)[keyof typeof brand]
	| (typeof text)[keyof typeof text]
	| (typeof borders)[keyof typeof borders]
	| (typeof button)[keyof typeof button]
	| (typeof colors)[keyof typeof colors]
	| (typeof fonts)[keyof typeof fonts]
	| (typeof motion)[keyof typeof motion]

export function cssVar(name: CssVarName): string {
	return `var(${name})`
}
