import { describe, expect, test } from "vitest"
import { isSpdxAllowed, parseSpdx } from "./spdx.ts"

const ALLOWED = new Set(["MIT", "Apache-2.0", "Zlib"])
const allowed = (expression: string) => isSpdxAllowed(parseSpdx(expression), ALLOWED)

describe("SPDX evaluation", () => {
	test.each([
		["MIT", true],
		["GPL-3.0-only", false],
		["(MIT OR GPL-3.0-only)", true],
		["(MIT AND Zlib)", true],
		["(MIT AND GPL-3.0-only)", false],
		// AND binds tighter than OR: GPL OR (MIT AND Zlib).
		["GPL-3.0-only OR MIT AND Zlib", true],
		["(GPL-3.0-only OR MIT) AND AGPL-3.0-only", false],
		["((MIT OR GPL-2.0-only) AND (Apache-2.0 OR LGPL-2.1-only))", true],
		// An exception changes the terms, so it never rides in on the base id.
		["Apache-2.0 WITH LLVM-exception", false],
		["MIT+", false],
	])("%s → %s", (expression, expected) => {
		expect(allowed(expression)).toBe(expected)
	})

	test.each(["", "MIT OR", "(MIT", "MIT)", "AND MIT", "MIT Apache-2.0", "MIT WITH", "MIT / ISC", "SEE LICENSE IN x"])(
		"rejects the malformed expression %j",
		(expression) => {
			expect(() => parseSpdx(expression)).toThrow(/unparseable SPDX/)
		},
	)
})
