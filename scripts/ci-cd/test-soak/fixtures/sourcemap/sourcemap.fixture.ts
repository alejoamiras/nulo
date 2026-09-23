import { expect, test } from "vitest"

test("fails on a known line", () => {
	const location = "sourcemap.fixture.ts:5"
	expect(location).toBe("reported by the stack trace") // line 5 — asserted by cli.test.ts
})
