import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, test, vi } from "vitest"
import AmountCard from "@/components/composite/send/AmountCard.vue"
import { validateSendAmount } from "./send-amount"

const balance = (units: string | bigint = "1000000000") => units

const STUBS = {
	Flex: { template: '<div v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
	Tooltip: { template: "<span><slot /></span>" },
}

async function sendsFromField(typed: string, decimals: number) {
	const w = mount(AmountCard, {
		props: { tokenBalanceByType: 100, modelValue: "", token: { symbol: "TST", decimals } },
		global: { stubs: STUBS },
	})
	const input = w.get("[data-testid='send-amount-input']")
	await input.setValue(typed)
	await input.trigger("blur")
	const rest = (input.element as HTMLInputElement).value
	await input.trigger("blur")
	const again = (input.element as HTMLInputElement).value
	w.unmount()
	return { rest, again, sent: validateSendAmount({ input: rest, tokenDecimals: decimals, balanceRaw: 10n ** 40n }) }
}

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

	test.each([
		["1,000", 1_000_000_000n],
		["1,000,000", 1_000_000_000_000n],
		["123,456,789.5", 123_456_789_500_000n],
		// Stray commas are not grouping: removing every comma would read this as 1.2345.
		["1.234,5,", "invalid"],
		["12,34.5", 1_234_500_000n],
	])("reads %s at 6 decimals as %s", (input, expected) => {
		const r = validateSendAmount({ input, tokenDecimals: 6, balanceRaw: 10n ** 40n })
		expect(r).toEqual(typeof expected === "bigint" ? { valid: true, integerized: expected } : { valid: false, reason: expected })
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

describe("send-amount/what the amount field sends", () => {
	beforeEach(() => {
		// jsdom's focus throws for an input outside the layout; AmountCard focuses on mount.
		vi.spyOn(HTMLInputElement.prototype, "focus").mockImplementation(() => {})
	})

	test.each([
		["1234567.123456789012345678", 18, "1,234,567.123456789012345678", 1_234_567_123_456_789_012_345_678n],
		["12345678901.123456", 6, "12,345,678,901.123456", 12_345_678_901_123_456n],
		["1234567890123.12345678", 8, "1,234,567,890,123.12345678", 123_456_789_012_312_345_678n],
		["1234567", 0, "1,234,567", 1_234_567n],
		// A keystroke in a grouped amount drops its commas; leaving the field puts them back.
		["1,234,567.55", 18, "1,234,567.55", 1_234_567_550_000_000_000_000_000n],
		// A paste past the token's decimals keeps only its digits and the point, then is clamped.
		["1,234,567.1234567", 6, "1,234,567.123456", 1_234_567_123_456n],
		["1.234,5678901", 6, "1.234567", 1_234_567n],
		["12ab.1234567", 6, "12.123456", 12_123_456n],
		["1.234,5,678901", 6, "1.234567", 1_234_567n],
	])("%s at %i decimals rests as %s and sends %s", async (typed, decimals, rest, sent) => {
		const field = await sendsFromField(typed, decimals)
		expect(field.rest).toBe(rest)
		expect(field.again).toBe(rest)
		expect(field.sent).toEqual(typeof sent === "bigint" ? { valid: true, integerized: sent } : { valid: false, reason: sent })
	})
})
