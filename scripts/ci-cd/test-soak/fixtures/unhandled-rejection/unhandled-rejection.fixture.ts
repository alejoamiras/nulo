import { expect, test } from "vitest"

test("passes while a rejection escapes", async () => {
	setTimeout(() => {
		Promise.reject(new Error("escaped rejection"))
	}, 0)
	await new Promise((resolve) => setTimeout(resolve, 50))
	expect(true).toBe(true)
})
