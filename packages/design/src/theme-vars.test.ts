/// <reference types="node" />
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { collectStyleFiles, declaredVars, findUndefinedThemeVars, isOwnedToken } from "./theme-vars"

describe("undefined-var guard (design self-scan)", () => {
	test("every owned var referenced in @nulo/design SFCs is declared in base.css", () => {
		const declared = declaredVars(join(process.cwd(), "src/base.css"))
		const files = collectStyleFiles(join(process.cwd(), "src"))
		const ghosts = findUndefinedThemeVars(files, declared)
		expect(ghosts).toEqual([])
	})

	test("classifies owned vs local namespaces", () => {
		expect(isOwnedToken("--nulo-accent")).toBe(true)
		expect(isOwnedToken("--txt-primary")).toBe(true)
		expect(isOwnedToken("--nulo-bg")).toBe(true) // a known faucet ghost — owned namespace, undeclared
		expect(isOwnedToken("--red")).toBe(true)
		expect(isOwnedToken("--local-spacing")).toBe(false)
		expect(isOwnedToken("--my-component-x")).toBe(false)
	})

	test("detects a ghost token against a known declared set", () => {
		const declared = new Set(["--nulo-accent", "--txt-primary"])
		const ghosts = findUndefinedThemeVarsFromSource("a { color: var(--nulo-accent); border-color: var(--nulo-primary); }", declared)
		expect(ghosts).toEqual(["--nulo-primary"])
	})
})

// Small inline variant so the detector is unit-tested without touching disk.
function findUndefinedThemeVarsFromSource(src: string, declared: Set<string>): string[] {
	const out: string[] = []
	for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
		if (isOwnedToken(m[1]) && !declared.has(m[1])) out.push(m[1])
	}
	return out
}
