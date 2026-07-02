import { describe, expect, test } from "vitest"
import { validateSendAmount } from "./send-amount"

const balance = (units: string | bigint = "1000000000") => units

describe("send-amount/validateSendAmount", () => {
	test("returns valid + integerized bigint for a clean input", () => {
		const r = validateSendAmount({ input: "1.5", tokenDecimals: 6, balanceRaw: balance() })
		expect(r).toEqual({ valid: true, integerized: 1500000n })
	})

	test("accepts bigint balance directly", () => {
		const r = validateSendAmount({ input: "0.000001", tokenDecimals: 6, balanceRaw: 1000000n })
		expect(r).toEqual({ valid: true, integerized: 1n })
	})

	test("rejects empty input", () => {
		expect(validateSendAmount({ input: "", tokenDecimals: 6, balanceRaw: balance() })).toEqual({
			valid: false,
			reason: "empty",
		})
	})

	test("rejects undefined input", () => {
		expect(validateSendAmount({ input: undefined, tokenDecimals: 6, balanceRaw: balance() })).toEqual({
			valid: false,
			reason: "empty",
		})
	})

	test("rejects whitespace-only input", () => {
		expect(validateSendAmount({ input: "   ", tokenDecimals: 6, balanceRaw: balance() })).toEqual({
			valid: false,
			reason: "empty",
		})
	})

	test("rejects a lone dot as empty", () => {
		expect(validateSendAmount({ input: ".", tokenDecimals: 6, balanceRaw: balance() })).toEqual({
			valid: false,
			reason: "empty",
		})
	})

	test("returns decimalsUnknown when token decimals missing (loading)", () => {
		expect(validateSendAmount({ input: "1.5", tokenDecimals: undefined, balanceRaw: balance() })).toEqual({
			valid: false,
			reason: "decimalsUnknown",
		})
	})

	test("returns tooManyDecimals for the bug repro (14.0234375 on a 6-dec token)", () => {
		expect(validateSendAmount({ input: "14.0234375", tokenDecimals: 6, balanceRaw: balance() })).toEqual({
			valid: false,
			reason: "tooManyDecimals",
		})
	})

	test("returns invalid for non-numeric garbage", () => {
		expect(validateSendAmount({ input: "abc", tokenDecimals: 6, balanceRaw: balance() })).toEqual({
			valid: false,
			reason: "invalid",
		})
	})

	test("returns invalid for scientific notation", () => {
		expect(validateSendAmount({ input: "1e5", tokenDecimals: 6, balanceRaw: balance() })).toEqual({
			valid: false,
			reason: "invalid",
		})
	})

	test("returns invalid for negative input", () => {
		expect(validateSendAmount({ input: "-1", tokenDecimals: 6, balanceRaw: balance() })).toEqual({
			valid: false,
			reason: "invalid",
		})
	})

	test("returns belowMinimum for zero amount", () => {
		expect(validateSendAmount({ input: "0", tokenDecimals: 6, balanceRaw: balance() })).toEqual({
			valid: false,
			reason: "belowMinimum",
		})
	})

	test("returns exceedsBalance when amount > balance", () => {
		expect(validateSendAmount({ input: "100", tokenDecimals: 6, balanceRaw: "1" })).toEqual({
			valid: false,
			reason: "exceedsBalance",
		})
	})

	test("returns exceedsBalance when balance is undefined (not loaded)", () => {
		expect(validateSendAmount({ input: "1.5", tokenDecimals: 6, balanceRaw: undefined })).toEqual({
			valid: false,
			reason: "exceedsBalance",
		})
	})

	test("returns exceedsBalance when balance is non-numeric (defensive)", () => {
		expect(validateSendAmount({ input: "1.5", tokenDecimals: 6, balanceRaw: "abc" })).toEqual({
			valid: false,
			reason: "exceedsBalance",
		})
	})

	test("accepts when amount equals balance exactly (max-spend)", () => {
		expect(validateSendAmount({ input: "1", tokenDecimals: 6, balanceRaw: 1000000n })).toEqual({
			valid: true,
			integerized: 1000000n,
		})
	})

	test("strips commas (thousand-separator paste like '1,000')", () => {
		// `.replace(",", "")` matches existing send.vue behavior — commas are
		// treated as thousand separators, not decimal separators.
		expect(validateSendAmount({ input: "1,000", tokenDecimals: 6, balanceRaw: 1000000000n })).toEqual({
			valid: true,
			integerized: 1000000000n,
		})
	})

	test("0-decimal token rejects fractional input as tooManyDecimals", () => {
		expect(validateSendAmount({ input: "1.5", tokenDecimals: 0, balanceRaw: 100n })).toEqual({
			valid: false,
			reason: "tooManyDecimals",
		})
	})

	test("18-decimal token (Fee Juice) handles small fractions", () => {
		expect(validateSendAmount({ input: "0.000000000000000001", tokenDecimals: 18, balanceRaw: 100n })).toEqual({
			valid: true,
			integerized: 1n,
		})
	})
})
