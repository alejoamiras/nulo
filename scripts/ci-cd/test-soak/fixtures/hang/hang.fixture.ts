import { test } from "vitest"

test("never resolves", async () => {
	await new Promise(() => {})
})
