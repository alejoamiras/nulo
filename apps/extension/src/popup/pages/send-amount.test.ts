import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { defineComponent, ref } from "vue"
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
	// The page validates with the rest the card last reported, as `send.vue` binds it.
	const rested = (w.emitted("update:rested")?.at(-1)?.[0] as string | null | undefined) ?? null
	w.unmount()
	return { rest, again, sent: validateSendAmount({ input: rest, rested, tokenDecimals: decimals, balanceRaw: 10n ** 40n }) }
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
		["1,5", null, 1_500_000n],
		// A lone group of three reads two ways, and a misplaced comma no way: neither sends.
		["1,000", null, "invalid"],
		["1,234", null, "invalid"],
		["12,34.5", null, "invalid"],
		// The field's own rest reads its commas as the wallet's grouping.
		["1,000", "1,000", 1_000_000_000n],
		["1,000,000", null, 1_000_000_000_000n],
		["123,456,789.5", null, 123_456_789_500_000n],
		// Stray commas are not grouping: removing every comma would read this as 1.2345.
		["1.234,5,", null, "invalid"],
		["1.234", null, 1_234_000n],
	])("reads %s (at rest as %s) at 6 decimals as %s", (input, rested, expected) => {
		const r = validateSendAmount({ input, rested, tokenDecimals: 6, balanceRaw: 10n ** 40n })
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
		// One event holding the whole text keeps its commas for the reader; leaving the field rests it.
		["1,234,567.55", 18, "1,234,567.55", 1_234_567_550_000_000_000_000_000n],
		// Past the token's decimals the reading is clamped; letters never reach the text.
		["1,234,567.1234567", 6, "1,234,567.123456", 1_234_567_123_456n],
		["12ab.1234567", 6, "12.123456", 12_123_456n],
		// A comma decimal after point grouping reads as one amount; text that reads no way stays and sends nothing.
		["1.234,5678901", 6, "1,234.56789", 1_234_567_890n],
		["1.234,5,678901", 6, "1.234,5,678901", "invalid"],
	])("%s at %i decimals rests as %s and sends %s", async (typed, decimals, rest, sent) => {
		const field = await sendsFromField(typed, decimals)
		expect(field.rest).toBe(rest)
		expect(field.again).toBe(rest)
		expect(field.sent).toEqual(typeof sent === "bigint" ? { valid: true, integerized: sent } : { valid: false, reason: sent })
	})
})

describe("send-amount/the field under a page that binds it as the Send page does", () => {
	beforeEach(() => {
		vi.spyOn(HTMLInputElement.prototype, "focus").mockImplementation(() => {})
	})

	const E18 = 10n ** 18n
	const sends = (integerized: bigint) => ({ valid: true, integerized })
	const HELD = { valid: false, reason: "invalid" }

	function mountPage(balance = 10n ** 40n) {
		const text = ref<string | null>("")
		const rested = ref<string | null>(null)
		const w = mount(
			defineComponent({
				components: { AmountCard },
				setup: () => ({ text, rested, token: { symbol: "TST", decimals: 18 }, balance: balance.toString() }),
				template:
					'<AmountCard v-model="text" v-model:rested="rested" :token="token" :tokenBalanceByType="100" :balanceRawByType="balance" />',
			}),
			{ global: { stubs: STUBS } },
		)
		const field = () => w.get("[data-testid='send-amount-input']")
		const shown = () => (field().element as HTMLInputElement).value
		const edit = async (value: string, inputType: string, data: string | null = null) => {
			;(field().element as HTMLInputElement).value = value
			await field().trigger("input", { inputType, data })
		}
		/** What the review sheet would show and the page would submit. */
		const state = () => ({
			field: shown(),
			review: text.value,
			sent: validateSendAmount({ input: text.value, rested: rested.value, tokenDecimals: 18, balanceRaw: balance }),
		})
		return {
			shown,
			edit,
			state,
			/** Every text the card handed the page, in order. */
			writes: () => (w.findComponent(AmountCard).emitted("update:modelValue") ?? []).map(([text]) => text),
			/** Each key typed at the end of the text; what the field shows after each. */
			async type(keys: string) {
				const after: string[] = []
				for (const key of keys) {
					await edit(shown() + key, "insertText", key)
					after.push(shown())
				}
				return after
			},
			paste: (value: string) => edit(value, "insertFromPaste"),
			async backspaceAll() {
				while (shown()) await edit(shown().slice(0, -1), "deleteContentBackward")
			},
			max: () => w.get("[data-testid='send-amount-max']").trigger("click"),
			focus: () => field().trigger("focus"),
			/** The press on Send leaves the field first. */
			async leave() {
				await field().trigger("blur")
				return state()
			},
			holds: () => w.find("[data-testid='send-amount-ambiguous-hint']").exists(),
		}
	}

	test('typed "1,234.56": the comma is the point as typed, a point after it re-reads it, and 1234.56 sends', async () => {
		const page = mountPage()
		expect(await page.type("1,234.56")).toEqual(["1", "1.", "1.2", "1.23", "1.234", "1234.", "1234.5", "1234.56"])
		expect(await page.leave()).toEqual({ field: "1,234.56", review: "1,234.56", sent: sends(1_234_560n * 10n ** 15n) })
	})

	// A browser flushes microtasks between two listeners of one keystroke, so a raw key text the page
	// held first would come back through the card's model watcher before the card read its prior.
	test("a keystroke reaches the page only as the card's text, once, never as the raw key", async () => {
		const page = mountPage()
		await page.type("1,234.56")
		expect(page.writes()).toEqual(["1", "1.", "1.2", "1.23", "1.234", "1234.", "1234.5", "1234.56"])
	})

	test('typed "1,234" reads 1.234, and shows it', async () => {
		const page = mountPage()
		expect((await page.type("1,234")).at(-1)).toBe("1.234")
		expect(await page.leave()).toEqual({ field: "1.234", review: "1.234", sent: sends(1_234n * 10n ** 15n) })
	})

	test('"12" left at rest, then ",5" typed, reads 12.5', async () => {
		const page = mountPage()
		await page.type("12")
		await page.leave()
		expect(await page.type(",5")).toEqual(["12.", "12.5"])
		expect(await page.leave()).toEqual({ field: "12.5", review: "12.5", sent: sends(125n * 10n ** 17n) })
	})

	test.each([
		[",", ["1234."], "1,234", 1_234n * E18],
		["5", ["12345"], "12,345", 12_345n * E18],
	])('the rest "1,234" and a typed %j show %j, and rest as %s', async (key, after, rest, units) => {
		const page = mountPage()
		await page.type("1234")
		expect((await page.leave()).field).toBe("1,234")
		expect(await page.type(key)).toEqual(after)
		expect(await page.leave()).toEqual({ field: rest, review: rest, sent: sends(units) })
	})

	test('"1,234" pasted over the rest "1,234" is held, and sends nothing', async () => {
		const page = mountPage()
		await page.type("1234")
		await page.leave()
		await page.paste("1,234")
		expect(page.holds()).toBe(true)
		expect(await page.leave()).toEqual({ field: "1,234", review: "1,234", sent: HELD })
	})

	test("Max at a balance of 1,234 tokens writes 1,234 and sends 1234, with no blur", async () => {
		const page = mountPage(1_234n * E18)
		await page.max()
		expect(page.state()).toEqual({ field: "1,234", review: "1,234", sent: sends(1_234n * E18) })
	})

	test('Max at 1,234, Backspace to empty, then "1,234" pasted is held', async () => {
		const page = mountPage(1_234n * E18)
		await page.max()
		await page.backspaceAll()
		await page.paste("1,234")
		expect(page.holds()).toBe(true)
		expect(await page.leave()).toEqual({ field: "1,234", review: "1,234", sent: HELD })
	})

	test('typed "1,234", left and returned to, then "." re-reads the comma: 1234', async () => {
		const page = mountPage()
		expect((await page.type("1,234")).at(-1)).toBe("1.234")
		expect((await page.leave()).field).toBe("1.234")
		await page.focus()
		expect(await page.type(".")).toEqual(["1234."])
		expect(await page.leave()).toEqual({ field: "1,234", review: "1,234", sent: sends(1_234n * E18) })
	})

	test('typed "1,234", then "1.234" pasted over it: a "." after the paste is dropped, not a re-read', async () => {
		const page = mountPage()
		expect((await page.type("1,234")).at(-1)).toBe("1.234")
		await page.paste("1.234")
		expect(await page.type(".")).toEqual(["1.234"])
		expect(await page.leave()).toEqual({ field: "1.234", review: "1.234", sent: sends(1_234n * 10n ** 15n) })
	})

	test('typed "1,234", its point deleted and a "." typed in its place: a "." at the end is dropped, not a re-read', async () => {
		const page = mountPage()
		expect((await page.type("1,234")).at(-1)).toBe("1.234")
		await page.edit("1234", "deleteContentBackward")
		await page.edit("1.234", "insertText", ".")
		expect(page.shown()).toBe("1.234")
		expect(await page.type(".")).toEqual(["1.234"])
		expect(await page.leave()).toEqual({ field: "1.234", review: "1.234", sent: sends(1_234n * 10n ** 15n) })
	})
})
