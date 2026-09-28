import { describe, expect, test } from "vitest"
import { formatSnackAmount } from "./snack-amount"

describe("formatSnackAmount", () => {
	test.each([
		["fits the row's 8 characters", 1_500_000n, 6, "1.5"],
		["decimals cut, every whole digit kept", 12_345_670_000n, 6, "12,345.6"],
		["a whole number the 8 characters would cut", 123_456_789n * 10n ** 18n, 18, "123,456,789"],
		["whole digits that end inside the cut", 1_234_567_890_123n, 6, "1,234,567.890123"],
		["a whole u128 prints in full", 2n ** 128n - 1n, 0, "340,282,366,920,938,463,463,374,607,431,768,211,455"],
		["dust keeps the row's hint", 1n, 18, "<0.000001"],
		["zero", 0n, 18, "0"],
	])("%s", (_name, amount, decimals, expected) => {
		expect(formatSnackAmount(amount, decimals)).toBe(expected)
	})
})
