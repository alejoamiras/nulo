import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

/**
 * Which amounts read compact: every capped call whose token the wallet knows, and none of the
 * calls that guess decimals 0 for an unknown token or a dApp mint, where one 18-decimal token
 * would read as >999T. Textual on purpose: a new call fails here until someone picks its kind, and
 * an option other than `{ compact: true }` is refused. A parenthesis inside a string or comment
 * within a call's arguments defeats it; review catches that.
 */

const SRC = resolve(__dirname, "..")
/** File → [compact calls, plain calls]. The snack's plain call is its uncapped full amount. */
const CALLS: Record<string, [number, number]> = {
	"components/composite/activity/TransactionIncomingCard.vue": [1, 0],
	"popup/components/modules/general/BalanceView.vue": [3, 0],
	"popup/components/modules/general/RecentActivityView.vue": [2, 0],
	"popup/components/modules/general/TokenCard.vue": [3, 0],
	"popup/pages/journal/[id].vue": [1, 0],
	"utils/journal-state.ts": [1, 0],
	"utils/snack-amount.ts": [1, 1],
	"popup/components/modules/activity/TransactionCard.vue": [0, 2],
	"popup/components/popups/IncomingTrustPopup.vue": [0, 1],
	"popup/pages/received/[id].vue": [0, 1],
	"popup/pages/tx/[id].vue": [0, 2],
}

/** Each call's argument text up to its closing parenthesis, so a call split over lines counts;
 *  a mention on a comment line is not a call. */
function callArgs(text: string): string[] {
	const args: string[] = []
	for (const match of text.matchAll(/\bbalanceFormatted\(/g)) {
		const open = match.index + match[0].length
		if (/^\s*(\/\/|\*)/.test(text.slice(text.lastIndexOf("\n", match.index) + 1, match.index))) continue
		let depth = 1
		let end = open
		while (depth > 0 && end < text.length) {
			const ch = text[end++]
			if (ch === "(") depth++
			else if (ch === ")") depth--
		}
		args.push(text.slice(open, end - 1))
	}
	return args
}

/** A call's arguments, split at the commas outside any bracket. */
function topLevelArgs(args: string): string[] {
	const parts: string[] = []
	let depth = 0
	let start = 0
	for (let i = 0; i < args.length; i++) {
		const ch = args.charAt(i)
		if ("([{".includes(ch)) depth++
		else if (")]}".includes(ch)) depth--
		else if (ch === "," && depth === 0) {
			parts.push(args.slice(start, i).trim())
			start = i + 1
		}
	}
	parts.push(args.slice(start).trim())
	return parts.filter((part) => part !== "")
}

/** [compact, plain]: plain has no fourth argument, compact passes exactly `{ compact: true }`. */
function kinds(text: string): [number, number] {
	let compact = 0
	let plain = 0
	for (const args of callArgs(text)) {
		const parts = topLevelArgs(args)
		if (parts.length <= 3) plain++
		else if (parts.length === 4 && parts[3] === "{ compact: true }") compact++
		else throw new Error(`unsupported option in balanceFormatted(${args})`)
	}
	return [compact, plain]
}

describe("balanceFormatted's callers", () => {
	test("every known-token capped amount reads compact, and no guessed-decimals one does", () => {
		const found: Record<string, [number, number]> = {}
		for (const path of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
			if (!/\.(ts|vue)$/.test(path) || path.endsWith(".test.ts")) continue
			const [compact, plain] = kinds(readFileSync(resolve(SRC, path), "utf8"))
			if (compact + plain > 0) found[path] = [compact, plain]
		}
		expect(found).toEqual(CALLS)
	})

	test("a call split over lines is read whole", () => {
		const split = "return balanceFormatted(\n\tamount,\n\tdecimals,\n\t8,\n\t{ compact: true },\n).value\n"
		expect(kinds(split)).toEqual([1, 0])
		expect(kinds("\t// `balanceFormatted(raw, decimals, length)`.\n\t * balanceFormatted(x)\n")).toEqual([0, 0])
		expect(kinds("const a = balanceFormatted(f(x), d, 8).value\n")).toEqual([0, 1])
	})

	test.each([
		"balanceFormatted(a, d, 8, opts)",
		'balanceFormatted(a, d, 8, { "compact": true })',
		"balanceFormatted(a, d, 8, { compact: false })",
	])("an option other than { compact: true } is refused: %s", (call) => {
		expect(() => kinds(call)).toThrow("unsupported")
	})
})
