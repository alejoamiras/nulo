import { describe, expect, test } from "vitest"
import { contrast, resolveColor, themeMap } from "./theme-contrast"

/**
 * WCAG-AA contrast gate (asserted token-pairing table — see theme-contrast.ts for why it is NOT a
 * cascade resolver). Dark pairs are REQUIRED (freeze-guard). Light "palette" pairs are expected-RED
 * until the Phase-2 palette lands: they run under `test.fails` while LIGHT_ENFORCED is false, then
 * flip to required `test` when it is set true in Phase 2.
 */

const AA_TEXT = 4.5

// Phase 2 flips this to `true` once `[theme="light"]` gets the 8 brand tokens + the explicit --border.
const LIGHT_ENFORCED = false

type Pair = { fg: string; bg: string; min: number; label: string }

// Pairs that pass in BOTH themes today — they don't touch the 8 missing light tokens.
const STABLE: Pair[] = [
	{ fg: "--txt-primary", bg: "--card-bg", min: AA_TEXT, label: "primary text on card" },
	{ fg: "--txt-secondary", bg: "--card-bg", min: AA_TEXT, label: "secondary text on card" },
	{ fg: "--txt-primary", bg: "--app-bg", min: AA_TEXT, label: "primary text on app-bg" },
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

// Root-cause pins: prove WHY light fails (the 8 tokens fall through to dark + the --border mis-alias).
// These get removed/flipped in Phase 2 once the light values land.
describe("light root-cause RED proof (remove at Phase 2)", () => {
	test("nulo-surface falls through to the DARK value in light", () => {
		expect(resolveColor("--nulo-surface", themeMap("light")).r).toBeLessThan(40) // dark #141312
	})
	test("--border mis-aliases to a dark value in light (base.css:132)", () => {
		expect(resolveColor("--border", themeMap("light")).r).toBeLessThan(80) // -> --nulo-surface-highest #363433
	})
})
