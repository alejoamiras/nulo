import { describe, expect, test } from "vitest"
import { type AmountEdit, type AmountHint, caretAfter, nextAmountText, restingAmount } from "./amount-field"

describe("composite/send/restingAmount", () => {
	test.each([
		["1234567.5", 18, "1,234,567.5"],
		["1.50", 18, "1.5"],
		["1.", 18, "1"],
		["007", 18, "7"],
		[".5", 18, "0.5"],
		["0.00", 18, "0"],
		[" 12.5 ", 18, "12.5"],
		// Whatever the parser refuses comes back as typed, so the validator judges what was typed.
		["1,234,567.5", 18, "1,234,567.5"],
		["1.234,56", 6, "1.234,56"],
		["abc", 18, "abc"],
		["1.2.3", 18, "1.2.3"],
		["-1", 18, "-1"],
		["1e-7", 18, "1e-7"],
		["1.1234567", 6, "1.1234567"],
	])("%s at %i decimals rests as %s, and stays there", (value, decimals, rest) => {
		expect(restingAmount(value, decimals)).toBe(rest)
		expect(restingAmount(rest, decimals)).toBe(rest)
	})
})

describe("composite/send/nextAmountText", () => {
	const PASTE = { inputType: "insertFromPaste" }
	const typed = (prior: string, key: string) => ({ prior, value: prior + key, inputType: "insertText", data: key })

	const cases: [string, Partial<AmountEdit>, string, AmountHint, boolean][] = [
		["a paste of 1.234,56 reads as it stands", { ...PASTE, value: "1.234,56" }, "1.234,56", null, false],
		["e5 pasted after 12 stays, and says so at once", { ...PASTE, prior: "12", value: "12e5" }, "12e5", "unreadable", false],
		["1.1234567 pasted at 6 decimals is clamped", { ...PASTE, value: "1.1234567", decimals: 6 }, "1.123456", "clamp", false],
		["a paste of 1,234 is held, and says so at once", { ...PASTE, value: "1,234" }, "1,234", "ambiguous", false],
		["a paste of 1.234 reads", { ...PASTE, value: "1.234" }, "1.234", null, false],
		['"a" typed after 12 goes', typed("12", "a"), "12", null, false],
		['"," typed after 1 is the point', typed("1", ","), "1.", null, true],
		['"." after the comma point of 1.234 re-reads the comma', { ...typed("1.234", "."), commaPoint: true }, "1234.", null, false],
		['"." after the comma point of 1.5 is dropped', { ...typed("1.5", "."), commaPoint: true }, "1.5", null, true],
		['"." after the comma point of 0.123 is dropped', { ...typed("0.123", "."), commaPoint: true }, "0.123", null, true],
		['"." after a typed point in 1.234 is dropped', typed("1.234", "."), "1.234", null, false],
		['"," after the comma point of 1.234 is dropped', { ...typed("1.234", ","), commaPoint: true }, "1.234", null, true],
		['a first "," opens the decimals', typed("", ","), "0.", null, true],
		['"0" typed into the kept 12e5 stays as typed', { ...typed("12e5", "0"), hint: "unreadable" }, "12e50", "unreadable", false],
		[
			"a deletion inside the kept 12e5 stays as typed",
			{ prior: "12e5", value: "1e5", inputType: "deleteContentBackward", hint: "unreadable" },
			"1e5",
			"unreadable",
			false,
		],
	]

	test.each(cases)("%s", (_name, edit, text, hint, commaPoint) => {
		expect(nextAmountText({ prior: "", value: "", decimals: 18, commaPoint: false, hint: null, ...edit })).toEqual({
			text,
			hint,
			commaPoint,
		})
	})
})

describe("composite/send/caretAfter", () => {
	test.each([
		["a comma typed inside 12 is the point, and the caret stays after it", "1,2", 2, "1.2", 2],
		["a key typed inside the rest 1,234,567 lands after the key", "10,234,567", 2, "10234567", 2],
		["a key typed after the comma of the rest 1,234 lands after the key", "1,5234", 3, "15234", 2],
		["a letter typed inside 12 goes, and the caret stays between the digits", "1x2", 2, "12", 1],
		["a point re-read at the end leaves the caret at the end", "1.234.", 6, "1234.", 5],
		["a key typed before the point of the rest 1,234.56 keeps the caret before the point", "1,2340.56", 6, "12340.56", 5],
		['a key typed before the point of "$12.34" keeps the caret before the point', "$125.34", 4, "125.34", 3],
		["a key typed before the kept comma of 1 234,56 keeps the caret before the comma", "1 2340,56", 6, "12340,56", 5],
	])("%s", (_name, value, caret, text, at) => {
		expect(caretAfter(value, caret, text)).toBe(at)
	})
})
