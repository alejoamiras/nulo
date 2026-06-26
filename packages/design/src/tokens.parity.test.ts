/// <reference types="node" />
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { borders, brand, colors, easings, fonts, layout, surfaces, text } from "./tokens"

/**
 * Look-same guard: every CSS-var the typed token surface exposes MUST be declared in base.css —
 * a token whose value declaration is missing would render unresolved in a consumer.
 * Read via node:fs because vitest stubs `.css` imports to empty.
 */
describe("token / base.css parity", () => {
	test("every typed token var name is declared in base.css", () => {
		const baseCss = readFileSync(join(process.cwd(), "src/base.css"), "utf8")
		const declared = new Set([...baseCss.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))
		const referenced = [surfaces, brand, text, borders, colors, fonts, easings, layout].flatMap((group) => Object.values(group))
		const missing = referenced.filter((name) => !declared.has(name))
		expect(missing).toEqual([])
	})
})
