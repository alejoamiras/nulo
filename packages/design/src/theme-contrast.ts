/// <reference types="node" />
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Theme contrast helper — resolves the design-system token graph for a given theme and computes
 * WCAG contrast ratios for an ASSERTED pairing table. This is deliberately NOT a CSS-cascade
 * resolver: jsdom can't resolve the var cascade across SFC styles + specificity, so we resolve only
 * the token-reference graph inside `base.css` (token -> token -> literal, with `:root` + `[theme]`
 * override on one element) and pair foreground tokens against EXPLICITLY-NAMED background tokens.
 * It is only as complete as its pairing table — that is the accepted trade-off, with the Storybook
 * matrix + manual smoke covering what an assertion table cannot.
 */

export type Rgba = { r: number; g: number; b: number; a: number }
export type Theme = "light" | "dark"

const BASE_CSS_PATH = join(process.cwd(), "src/base.css")

const TOKEN_SELECTORS = new Set([":root", '[theme="light"]', '[theme="dark"]'])

const NESTING: Record<string, number> = { "[": 1, "(": 1, "]": -1, ")": -1 }

/** Split a selector list at its top-level commas. A quoted value holding a bracket, comma or semicolon
 *  would misparse; base.css has none, and this reads base.css only. */
function splitSelectors(prelude: string): string[] {
	const parts = [""]
	let depth = 0
	for (const c of prelude) {
		depth += NESTING[c] ?? 0
		if (c === "," && depth === 0) parts.push("")
		else parts[parts.length - 1] += c
	}
	return parts.map((part) => part.trim())
}

/**
 * The token map of a root element carrying `theme` (or none): every block whose selector list names
 * `:root` or that theme selector exactly, applied in source order, as the cascade does for
 * equal-specificity rules. The grammar is base.css's own: token rules sit at the top level, never in
 * an at-rule, and no string holds a brace; a token rule nested in an at-rule throws.
 */
export function themeMap(theme: Theme | null, css = readFileSync(BASE_CSS_PATH, "utf8")): Record<string, string> {
	const matching = new Set([":root", ...(theme ? [`[theme="${theme}"]`] : [])])
	const out: Record<string, string> = {}
	const flat = css.replace(/\/\*[\s\S]*?\*\//g, "")
	for (const block of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const prelude = block[1].slice(block[1].lastIndexOf(";") + 1)
		const selectors = splitSelectors(prelude)
		const before = flat.slice(0, block.index)
		const nested = before.split("{").length > before.split("}").length
		if (nested && selectors.some((s) => TOKEN_SELECTORS.has(s))) {
			throw new Error(`token rule inside an at-rule: ${selectors.join(", ")}`)
		}
		if (!selectors.some((s) => matching.has(s))) continue
		for (const m of block[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim()
	}
	return out
}

const HEX = /^#([0-9a-f]{3,8})$/i
const RGB = /^rgba?\(([^)]+)\)$/i
const COLOR_MIX = /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/i

function parseHex(hex: string): Rgba {
	let h = hex.slice(1)
	if (h.length === 3) h = [...h].map((c) => c + c).join("")
	if (h.length === 4) h = [...h].map((c) => c + c).join("")
	const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16)
	return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
}

function parseRgb(str: string): Rgba {
	const parts = str
		.replace(RGB, "$1")
		// Tolerate both comma syntax `rgb(1, 2, 3)` and CSS Color 4 space syntax `rgb(1 2 3 / 95%)`.
		.split(/[,/\s]+/)
		.map((s) => s.trim())
		.filter(Boolean)
	const chan = (s: string) => (s.endsWith("%") ? Math.round((Number.parseFloat(s) / 100) * 255) : Number.parseFloat(s))
	const alpha = (s?: string) => (s == null ? 1 : s.endsWith("%") ? Number.parseFloat(s) / 100 : Number.parseFloat(s))
	return { r: chan(parts[0]), g: chan(parts[1]), b: chan(parts[2]), a: alpha(parts[3]) }
}

/**
 * Resolve a token NAME (or raw value) to an Rgba for the given theme, following `var(--x, fallback)`
 * chains, `color-mix(in srgb, C P%, transparent)` (≡ C at P% alpha — the repo idiom, see Spinner.vue),
 * hex, and rgb/rgba. Cycle-guarded. Throws on a genuinely unresolvable reference (a ghost token).
 */
export function resolveColor(token: string, map: Record<string, string>, seen = new Set<string>()): Rgba {
	let value = token.startsWith("--") ? map[token] : token
	if (value == null) throw new Error(`unresolved token: ${token}`)
	value = value.trim()

	const mix = value.match(COLOR_MIX)
	if (mix) {
		const base = resolveColor(mix[1].trim(), map, seen)
		return { ...base, a: base.a * (Number.parseFloat(mix[2]) / 100) }
	}

	const varMatch = value.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i)
	if (varMatch) {
		const name = varMatch[1]
		if (seen.has(name)) throw new Error(`var cycle at ${name}`)
		seen.add(name)
		if (map[name] != null) return resolveColor(name, map, seen)
		if (varMatch[2] != null) return resolveColor(varMatch[2].trim(), map, seen)
		throw new Error(`undefined var with no fallback: ${name}`)
	}

	if (HEX.test(value)) return parseHex(value)
	if (RGB.test(value)) return parseRgb(value)
	throw new Error(`uncolor value for ${token}: "${value}"`)
}

/** Composite a (possibly translucent) foreground over an opaque background → opaque Rgba. */
export function flatten(fg: Rgba, bg: Rgba): Rgba {
	const a = fg.a
	return {
		r: Math.round(fg.r * a + bg.r * (1 - a)),
		g: Math.round(fg.g * a + bg.g * (1 - a)),
		b: Math.round(fg.b * a + bg.b * (1 - a)),
		a: 1,
	}
}

function relativeLuminance({ r, g, b }: Rgba): number {
	const lin = (c: number) => {
		const s = c / 255
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 2.x contrast ratio between two colors. Foreground alpha is flattened over the background. */
export function contrast(fgToken: string, bgToken: string, theme: Theme, css = readFileSync(BASE_CSS_PATH, "utf8")): number {
	const map = themeMap(theme, css)
	const bg = resolveColor(bgToken, map)
	if (bg.a !== 1) throw new Error(`background ${bgToken} must be opaque for a contrast check`)
	const fg = flatten(resolveColor(fgToken, map), bg)
	const l1 = relativeLuminance(fg)
	const l2 = relativeLuminance(bg)
	const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
	return (hi + 0.05) / (lo + 0.05)
}
