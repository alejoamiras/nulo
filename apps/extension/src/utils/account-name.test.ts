import { describe, expect, test } from "vitest"
import { DEFAULT_ACCOUNT_NAME } from "@/wallet/services/account/spec"
import { nextAccountName } from "./account-name"

describe("nextAccountName", () => {
	test("with no accounts it is the name every network's first account gets", () => {
		expect(nextAccountName([])).toBe(DEFAULT_ACCOUNT_NAME)
		expect(DEFAULT_ACCOUNT_NAME).toBe("Account 1")
	})

	test.each([
		[["Account 1"], "Account 2"],
		[["Account 1", "Account 3"], "Account 2"],
		[["Savings", "Account 2"], "Account 1"],
		[["account 1", "Account 1 "], "Account 1"],
	])("%j → %s", (names, expected) => {
		expect(nextAccountName(names)).toBe(expected)
	})
})
