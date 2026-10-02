/// <reference types="node" />
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { contrast, resolveColor, themeMap } from "./theme-contrast"
import { borders, brand, colors, easings, fonts, layout, scrims, surfaces, text } from "./tokens"

/**
 * WCAG-AA contrast gate (asserted token-pairing table — see theme-contrast.ts for why it is NOT a
 * cascade resolver). Dark pairs are REQUIRED (freeze-guard). Light "palette" pairs are expected-RED
 * until the Phase-2 palette lands: they run under `test.fails` while LIGHT_ENFORCED is false, then
 * flip to required `test` when it is set true in Phase 2.
 */

const AA_TEXT = 4.5

// Phase 2 set this true: `[theme="light"]` now has the 8 brand tokens + the explicit --border, so the
// light palette pairs are REQUIRED (no longer xfail). Flipping back to false would re-expect-fail them.
const LIGHT_ENFORCED = true

type Pair = { fg: string; bg: string; min: number; label: string }

// Pairs that pass in BOTH themes today — they don't touch the 8 missing light tokens.
const STABLE: Pair[] = [
	{ fg: "--txt-primary", bg: "--card-bg", min: AA_TEXT, label: "primary text on card" },
	{ fg: "--txt-secondary", bg: "--card-bg", min: AA_TEXT, label: "secondary text on card" },
	{ fg: "--txt-primary", bg: "--app-bg", min: AA_TEXT, label: "primary text on app-bg" },
	{ fg: "--txt-body", bg: "--nulo-surface-highest", min: AA_TEXT, label: "tooltip text on its bubble" },
]

// Pairs that are genuinely contrast-RED in light today: a CORRECT light text token over a token that
// falls through to dark → dark-on-dark / white-on-cream. GREEN in dark, RED in light until Phase 2.
const PALETTE: Pair[] = [
	{ fg: "--txt-primary", bg: "--nulo-surface", min: AA_TEXT, label: "primary text on surface" },
	{ fg: "--txt-secondary", bg: "--nulo-surface", min: AA_TEXT, label: "secondary text on surface" },
	{ fg: "--txt-primary", bg: "--nulo-surface-low", min: AA_TEXT, label: "primary text on inset" },
	{ fg: "--txt-inverse", bg: "--nulo-accent", min: AA_TEXT, label: "accent fill <-> foreground (Button landmine)" },
]

// Pairs whose contrast is OK today only because BOTH tokens fall through to dark together (dark-on-dark
// looks fine to a contrast check but is wrong colours in light). They must STAY >= AA once the light
// palette lands, so they are required in dark always + in light only once Phase 2 enforces it.
const ENFORCE_ONLY: Pair[] = [{ fg: "--nulo-secondary", bg: "--nulo-surface", min: AA_TEXT, label: "muted (--nulo-secondary) on surface" }]

describe("theme contrast — dark (required, freeze-guard)", () => {
	for (const p of [...STABLE, ...PALETTE, ...ENFORCE_ONLY]) {
		test(`dark: ${p.label} >= ${p.min}:1`, () => {
			expect(contrast(p.fg, p.bg, "dark")).toBeGreaterThanOrEqual(p.min)
		})
	}
})

describe("theme contrast — light, stable pairs (required)", () => {
	for (const p of STABLE) {
		test(`light: ${p.label} >= ${p.min}:1`, () => {
			expect(contrast(p.fg, p.bg, "light")).toBeGreaterThanOrEqual(p.min)
		})
	}
})

describe("theme contrast — light, palette pairs", () => {
	const lightTest = LIGHT_ENFORCED ? test : test.fails
	for (const p of PALETTE) {
		lightTest(`light: ${p.label} >= ${p.min}:1${LIGHT_ENFORCED ? "" : " (xfail until Phase 2)"}`, () => {
			expect(contrast(p.fg, p.bg, "light")).toBeGreaterThanOrEqual(p.min)
		})
	}
})

describe("theme contrast — light, enforce-only pairs", () => {
	const lightTest = LIGHT_ENFORCED ? test : test.skip
	for (const p of ENFORCE_ONLY) {
		lightTest(`light: ${p.label} >= ${p.min}:1 (enforced at Phase 2)`, () => {
			expect(contrast(p.fg, p.bg, "light")).toBeGreaterThanOrEqual(p.min)
		})
	}
})

// Muted-text tokens carry real + SECURITY copy (the scam-token trust prompt, the "irreversible"
// confirm, reset guidance — IncomingTrustPopup/ConfirmPopup/reset). They MUST clear AA in BOTH themes
// on every surface they sit on.
const MUTED_TOKENS = ["--txt-body", "--txt-tertiary", "--txt-support"]
const MUTED_SURFACES = ["--card-bg", "--nulo-surface", "--nulo-surface-low", "--nulo-surface-high"]
for (const theme of ["light", "dark"] as const) {
	describe(`theme contrast — ${theme} muted text on surfaces (required)`, () => {
		for (const fg of MUTED_TOKENS) {
			for (const bg of MUTED_SURFACES) {
				test(`${theme}: ${fg} on ${bg} >= ${AA_TEXT}:1`, () => {
					expect(contrast(fg, bg, theme)).toBeGreaterThanOrEqual(AA_TEXT)
				})
			}
		}
	})
}

// Regression: resolveColor must tolerate both comma and CSS Color 4 space-separated rgb() syntax.
describe("resolveColor rgb() parsing", () => {
	test("parses comma and space-separated rgb/rgba", () => {
		expect(resolveColor("rgba(124, 116, 104, 0.3)", {})).toEqual({ r: 124, g: 116, b: 104, a: 0.3 })
		expect(resolveColor("rgb(255 255 255 / 50%)", {})).toEqual({ r: 255, g: 255, b: 255, a: 0.5 })
		expect(resolveColor("#a8480c", {})).toEqual({ r: 168, g: 72, b: 12, a: 1 })
	})
})

const COLOR_TOKENS = [surfaces, brand, text, borders, scrims, colors].flatMap((group) => Object.values(group))
const VALUE_TOKENS = [fonts, easings, layout].flatMap((group) => Object.values(group))

/** A non-color value with its `var(--x, fallback)` chain followed, fallbacks included; undefined when unresolvable. */
function resolveValue(value: string | undefined, map: Record<string, string>, depth = 0): string | undefined {
	const alias = value?.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i)
	if (!alias) return value
	if (depth > 8) return undefined
	return resolveValue(map[alias[1]] ?? alias[2]?.trim(), map, depth + 1)
}

/** Contract tokens an unthemed root and a dark root resolve differently, or that one of them lacks. */
function paletteDrift(css?: string): string[] {
	const unthemed = themeMap(null, css)
	const dark = themeMap("dark", css)
	const drifted = VALUE_TOKENS.filter((name) => {
		const value = resolveValue(unthemed[name], unthemed)
		return value === undefined || value !== resolveValue(dark[name], dark)
	})
	for (const name of COLOR_TOKENS) {
		try {
			if (JSON.stringify(resolveColor(name, unthemed)) !== JSON.stringify(resolveColor(name, dark))) drifted.push(name)
		} catch {
			drifted.push(name)
		}
	}
	return drifted
}

// The landing renders an unthemed root and the wallet sets theme="dark": the two must read one palette.
describe("dark palette, unthemed vs explicit", () => {
	const css = readFileSync(join(process.cwd(), "src/base.css"), "utf8")

	test("every contract token resolves the same on both roots", () => {
		expect(paletteDrift()).toEqual([])
	})
	test("a token the unthemed root loses is drift", () => {
		expect(paletteDrift(css.replace(':root,\n[theme="dark"] {', '[theme="dark"] {'))).toContain("--app-bg")
	})
	test("a token resolving through a theme-only variable is drift", () => {
		const viaLog = css.replace("--nulo-surface: #141312;", "--nulo-surface: var(--log-background, #141312);")
		expect(paletteDrift(viaLog)).toContain("--nulo-surface")
	})
	test("a size resolving through a theme-only variable is drift", () => {
		const viaDark = `${css.replace("--base-width: 360px;", "--base-width: var(--dark-width, 360px);")}\n[theme="dark"] { --dark-width: 400px; }`
		expect(paletteDrift(viaDark)).toContain("--base-width")
	})
	test("a size resolving through a nested fallback is drift", () => {
		const nested = css.replace("--base-width: 360px;", "--base-width: var(--preferred-width, var(--dark-width, 360px));")
		expect(paletteDrift(`${nested}\n[theme="dark"] { --dark-width: 400px; }`)).toContain("--base-width")
	})
	test("a token rule nested in an at-rule is refused", () => {
		expect(() => themeMap("dark", `${css}\n@media not all { :root { --app-bg: #333; } }`)).toThrow(/at-rule/)
	})
	test("a comma inside an attribute selector does not split the list", () => {
		expect(themeMap(null, '[data-x=",:root,"] { --app-bg: #333; }')).toEqual({})
	})
})

// Phase-2 sanity: the formerly-broken tokens now resolve to their LIGHT values, not the dark fallthrough.
describe("light palette landed (was the root cause)", () => {
	test("nulo-surface is now the light value, not the dark fallthrough", () => {
		expect(resolveColor("--nulo-surface", themeMap("light")).r).toBeGreaterThan(200) // #ffffff
	})
	test("--border is an explicit light value, not the --nulo-surface-highest alias", () => {
		expect(resolveColor("--border", themeMap("light")).r).toBeGreaterThan(100) // rgba(124,116,104,.3)
	})
})
