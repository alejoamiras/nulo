import { describe, expect, test } from "vitest"
import { isNewPasswordValid, newPasswordHint } from "./password"

describe("new-password rule", () => {
	test("short, mismatched, long and strong pairs", () => {
		expect(isNewPasswordValid("short", "short")).toBe(false)
		expect(newPasswordHint("short", "short")).toBe("At least 8 characters")
		expect(isNewPasswordValid("longenough", "longenougx")).toBe(false)
		expect(newPasswordHint("longenough", "longenougx")).toBe("Passwords don't match")
		const long = "a".repeat(25)
		expect(isNewPasswordValid(long, long)).toBe(true)
		expect(newPasswordHint(long, long)).toBe("Long enough. Don't forget it.")
		expect(isNewPasswordValid("longenough", "longenough")).toBe(true)
		expect(newPasswordHint("longenough", "longenough")).toBe("Strong password")
	})
	test("an empty repeat never validates, whatever the password", () => {
		expect(isNewPasswordValid("", "")).toBe(false)
		expect(isNewPasswordValid("longenough", "")).toBe(false)
		expect(newPasswordHint("", "")).toBe("At least 8 characters")
	})
})
