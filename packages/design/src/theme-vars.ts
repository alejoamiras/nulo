/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Undefined-var guard — a reusable check that every design-system `var(--token)` reference is
 * actually declared in base.css. The token tests (`tokens.parity`) are one-way (contract -> base.css),
 * so a "ghost" var referenced by a component but declared NOWHERE (e.g. `--nulo-primary`, `--nulo-bg`)
 * slips past every existing structural check. This catches that class. Wired per-package: design scans
 * its own SFCs here; the extension + faucet scan theirs in their own test suites (Phases 1 + 3).
 */

// Namespaces OWNED by the design system. A `var(--x)` in one of these MUST be declared in base.css;
// anything else is treated as a component-local custom property and ignored.
const OWNED_PREFIXES = [
	"--nulo-",
	"--txt-",
	"--app-",
	"--card-",
	"--tooltip-",
	"--dropdown-",
	"--btn-",
	"--font-",
	"--base-",
	"--nav-",
	"--border",
	"--bezier",
	"--surface-",
	"--warn",
]
const OWNED_EXACT = new Set([
	"--white",
	"--black",
	"--blue",
	"--green",
	"--mint",
	"--neutral-mint",
	"--orange",
	"--yellow",
	"--red",
	"--purple",
	"--gray",
	"--sand",
])

export function isOwnedToken(name: string): boolean {
	return OWNED_EXACT.has(name) || OWNED_PREFIXES.some((p) => name.startsWith(p))
}

export function declaredVars(baseCssPath: string): Set<string> {
	const css = readFileSync(baseCssPath, "utf8")
	return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))
}

export function collectStyleFiles(dir: string, exts = [".vue", ".css", ".scss"]): string[] {
	const out: string[] = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue
			out.push(...collectStyleFiles(full, exts))
		} else if (exts.some((e) => entry.name.endsWith(e))) {
			out.push(full)
		}
	}
	return out
}

/** Owned `var(--x)` references in `files` that are NOT declared in base.css (the ghosts). */
export function findUndefinedThemeVars(files: string[], declared: Set<string>): { file: string; token: string }[] {
	const out: { file: string; token: string }[] = []
	for (const file of files) {
		const src = readFileSync(file, "utf8")
		const seen = new Set<string>()
		for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
			const name = m[1]
			// A trailing `-` means the regex stopped at a template interpolation, e.g. `var(--txt-${x})`
			// (Icon.vue builds hover-color vars dynamically) — not a statically resolvable token.
			if (name.endsWith("-")) continue
			const key = `${file}::${name}`
			if (seen.has(key)) continue
			seen.add(key)
			if (isOwnedToken(name) && !declared.has(name)) out.push({ file, token: name })
		}
	}
	return out
}
