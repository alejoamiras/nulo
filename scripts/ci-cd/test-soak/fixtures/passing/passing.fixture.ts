import { expect, test } from "vitest"

test("passes", () => {
	expect(1 + 1).toBe(2)
})

test.skip("skipped on purpose", () => {})

test.todo("todo on purpose")
