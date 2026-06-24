/// <reference types="node" />
import { join } from "node:path"
import { collectStyleFiles, declaredVars, findUndefinedThemeVars } from "@nulo/design/testing"
import { describe, expect, test } from "vitest"

// The canonical token set lives in @nulo/design/base.css (one dir up from the extension package root).
const DESIGN_BASE_CSS = join(process.cwd(), "../design/src/base.css")

/**
 * Undefined-var guard (extension scan). Every design-system `var(--token)` referenced in an extension
 * SFC must be declared in `@nulo/design/base.css`. Catches "ghost" tokens that resolve to nothing —
 * e.g. the `--nulo-primary` focus ring this work removed. `tokens.parity` is one-way and can't see these.
 */
describe("undefined-var guard (extension)", () => {
	test("no extension SFC references an owned --token that is undeclared in base.css", () => {
		const declared = declaredVars(DESIGN_BASE_CSS)
		const files = collectStyleFiles(join(process.cwd(), "src"))
		const ghosts = findUndefinedThemeVars(files, declared)
		const report = ghosts.map((g) => `${g.token} in ${g.file.replace(process.cwd(), "")}`)
		expect(report).toEqual([])
	})
})
