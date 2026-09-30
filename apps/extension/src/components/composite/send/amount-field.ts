import { type AmountRead, clampDecimals, formatBaseUnits, normalizeAmount, parseAmountToBaseUnits, readAmountText } from "@/utils/amount"

/** The amount field's resting form: a plain decimal the token can hold comes back grouped with
 *  every digit kept; anything else, a comma included, comes back as typed, so the validator reads
 *  the same amount it would have, and a second call changes nothing. */
export function restingAmount(value: string, decimals: number): string {
	try {
		return formatBaseUnits(parseAmountToBaseUnits(value.trim(), decimals), decimals, { thousandsSep: ",", decimalSep: "." })
	} catch {
		return value
	}
}

/** The line under the field: the clamp, or why the text reads as no one amount. */
export type AmountHint = "clamp" | Extract<AmountRead, { ok: false }>["reason"] | null

/** One input event on the amount field, and the field's state before it. */
export type AmountEdit = {
	prior: string
	value: string
	inputType?: string | null
	data?: string | null
	/** The token's decimals; none for the USD field, which is not clamped here. */
	decimals?: number
	rested?: string | null
	commaPoint: boolean
	/** The hint showing before the edit. */
	hint: AmountHint
	currency?: "$"
}

const PLAIN = /^\d*\.?\d*$/
const NOT_AMOUNT = /[^\d.,]/g
/** A point whose comma can be grouping: one to three digits before it, the first not 0, and whole
 *  groups of three after it. */
const GROUPING_POINT = /^([1-9]\d{0,2})\.((?:\d{3})+)$/

const isPasteLike = (inputType: string | null | undefined): boolean =>
	!!inputType && (inputType.startsWith("insertFrom") || inputType === "insertReplacementText")

const clean = (text: string): string => text.replace(NOT_AMOUNT, "")

/** `value` as the part before the edit, what the edit inserted, and the part after it. */
function splitEdit(prior: string, value: string): [head: string, inserted: string, tail: string] {
	let start = 0
	while (start < prior.length && start < value.length && prior[start] === value[start]) start++
	let end = 0
	const room = Math.min(prior.length, value.length) - start
	while (end < room && prior[prior.length - 1 - end] === value[value.length - 1 - end]) end++
	return [value.slice(0, start), value.slice(start, value.length - end), value.slice(value.length - end)]
}

/** Where an inserted point goes: the text's only point, a re-read of the comma point as grouping,
 *  or nowhere. */
function placePoint(head: string, inserted: string, tail: string, typedComma: boolean, commaPoint: boolean) {
	if (!inserted.includes(".")) return { text: head + inserted + tail, commaPoint }
	if (!(head + tail).includes(".")) return { text: head + inserted + tail, commaPoint: typedComma }
	const grouping = inserted === "." && !typedComma && commaPoint ? GROUPING_POINT.exec(head) : null
	if (grouping) return { text: `${grouping[1]}${grouping[2]}.${tail}`, commaPoint: false }
	return { text: head + inserted.replaceAll(".", "") + tail, commaPoint }
}

/** A keystroke's text: a lone comma is the point, other characters go, and a text that stays plain
 *  takes `normalizeAmount`'s rules. */
function typedText(edit: AmountEdit): { text: string; commaPoint: boolean } {
	let [head, inserted, tail] = splitEdit(edit.prior, edit.value)
	if (edit.prior === edit.rested && edit.prior.includes(",")) {
		head = head.replaceAll(",", "")
		tail = tail.replaceAll(",", "")
	}
	const typedComma = inserted === ","
	const placed = placePoint(clean(head), clean(typedComma ? "." : inserted), clean(tail), typedComma, edit.commaPoint)
	const normalized = PLAIN.test(placed.text) ? normalizeAmount(placed.text) : undefined
	return { text: normalized ?? placed.text, commaPoint: placed.commaPoint }
}

/** The text after the clamp, and its hint: a read hint shows at once after a paste and, after a
 *  keystroke, only while one already shows. */
function settle(text: string, edit: AmountEdit, pasteLike: boolean): { text: string; hint: AmountHint } {
	if (text === "") return { text, hint: null }
	const read = readAmountText(text, { currency: edit.currency })
	if (!read.ok) return { text, hint: pasteLike || (edit.hint !== null && edit.hint !== "clamp") ? read.reason : null }
	const clamped = edit.decimals === undefined ? read.plain : clampDecimals(read.plain, edit.decimals)
	return clamped === read.plain ? { text, hint: null } : { text: clamped, hint: "clamp" }
}

/** Where the caret goes once the input's `value`, its caret at `caret`, shows `text` instead: before
 *  as many digits as followed it, so the next key lands where the person typed the last. */
export function caretAfter(value: string, caret: number, text: string): number {
	let digits = value.slice(caret).replace(/\D/g, "").length
	let at = text.length
	while (at > 0 && digits > 0) {
		at -= 1
		if (/\d/.test(text[at])) digits -= 1
	}
	return at
}

/**
 * The field's text after one input event. A paste (or any `insertFrom*` or replacing edit) and an
 * edit of a kept text that does not read stay as they stand; a keystroke keeps digits, points and
 * commas, and a lone comma writes the point. Only a text that reads is clamped, on its reading.
 */
export function nextAmountText(edit: AmountEdit): { text: string; commaPoint: boolean; hint: AmountHint } {
	const pasteLike = isPasteLike(edit.inputType)
	const kept = pasteLike || (edit.prior !== "" && !readAmountText(edit.prior, { rested: edit.rested, currency: edit.currency }).ok)
	const typed = kept ? { text: edit.value, commaPoint: false } : typedText(edit)
	const settled = settle(typed.text, edit, pasteLike)
	// After the clamp, so a first "0" opens the decimals even for a token without them.
	const text = !pasteLike && edit.data === "0" && edit.value === "0" ? "0." : settled.text
	return { text, commaPoint: typed.commaPoint && text.includes("."), hint: settled.hint }
}
