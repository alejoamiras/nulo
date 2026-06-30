/// <reference types="node" />
import { join } from "node:path"
import { collectStyleFiles, declaredVars, findUndefinedThemeVars } from "@nulo/design/testing"
import { describe, expect, test } from "vitest"

// Canonical token set = @nulo/design/base.css (one dir up from the faucet package root).
const DESIGN_BASE_CSS = join(process.cwd(), "../../packages/design/src/base.css")

/**
 * Undefined-var guard (faucet scan). Every design-system `var(--token)` referenced in a faucet SFC
 * must be declared in base.css — catches "ghost" tokens like the `--nulo-bg`/`--surface-raised`/`--warn`
 * fallbacks this work removed (they resolved to a hardcoded dark fallback, invisible in light mode).
 */
describe("undefined-var guard (faucet)", () => {
	test("no faucet SFC references an owned --token that is undeclared in base.css", () => {
		const declared = declaredVars(DESIGN_BASE_CSS)
		const files = collectStyleFiles(join(process.cwd(), "src"))
		const ghosts = findUndefinedThemeVars(files, declared)
		const report = ghosts.map((g) => `${g.token} in ${g.file.replace(process.cwd(), "")}`)
		expect(report).toEqual([])
	})
})
