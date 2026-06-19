import { describe, expect, test } from "vitest"
import biome from "../../../biome.json"

/**
 * Belt-and-suspenders for the `@nulo/design` platform-agnostic floor:
 *  1. No chrome.* reaches the source, including the indirections Biome's `noRestrictedGlobals`
 *     misses (`window.chrome`, `globalThis["chrome"]`, `webextension-polyfill`).
 *  2. The Biome floor for `packages/design/src/**` still bans `@nulo/*` + `chrome` — so a PR can't
 *     silently weaken the boundary in the same diff that exploits it.
 */

type BiomeOverride = {
	includes?: string[]
	linter?: {
		rules?: {
			style?: {
				noRestrictedImports?: { options?: { patterns?: Array<{ group?: string[] }> } }
				noRestrictedGlobals?: { options?: { deniedGlobals?: Record<string, string> } }
			}
		}
	}
}

const sources = import.meta.glob("./**/*.{ts,vue}", { query: "?raw", eager: true, import: "default" }) as Record<string, string>

describe("@nulo/design platform-agnostic boundary", () => {
	test("source has no chrome.* access (direct or via window/globalThis/webextension-polyfill)", () => {
		const banned: Array<[string, RegExp]> = [
			["chrome.", /\bchrome\s*\./],
			["window.chrome", /\bwindow\s*\.\s*chrome\b/],
			["globalThis[chrome]", /globalThis\s*\[\s*["']chrome["']\s*\]/],
			["webextension-polyfill", /webextension-polyfill/],
		]
		const offenders: string[] = []
		for (const [path, src] of Object.entries(sources)) {
			if (path.includes(".test.")) continue
			for (const [label, re] of banned) if (re.test(src)) offenders.push(`${path}: ${label}`)
		}
		expect(offenders).toEqual([])
	})

	test("biome floor for packages/design/src/** still bans @nulo/* and chrome", () => {
		const overrides = (biome as unknown as { overrides: BiomeOverride[] }).overrides
		const floor = overrides.find((o) => o.includes?.includes("packages/design/src/**"))
		expect(floor, "floor override for packages/design/src/** must exist").toBeDefined()

		const style = floor?.linter?.rules?.style
		const patterns = style?.noRestrictedImports?.options?.patterns ?? []
		expect(patterns.some((p) => p.group?.includes("@nulo/*"))).toBe(true)
		expect(style?.noRestrictedGlobals?.options?.deniedGlobals?.chrome).toBeTruthy()
	})
})
