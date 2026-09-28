import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"

/**
 * A snack's kind is a per-site decision nothing types: a call that leaves it out lands as an error,
 * and a stray icon, colour or duration is a site the rewrite missed. Textual on purpose — aliasing
 * defeats it, which is what review is for.
 */

const SRC = resolve(__dirname, "..")

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) return walk(path)
		const source = /\.(ts|js|vue)$/.test(entry.name) && !/\.(test|stories|d)\.ts$/.test(entry.name)
		return source ? [path] : []
	})
}

const files = walk(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }))
const filesMatching = (pattern: RegExp) => files.filter((file) => pattern.test(file.text)).map((file) => file.path)

const QUOTES = new Set(['"', "'", "`"])
const CLOSER: Record<string, string> = { "(": ")", "{": "}", "[": "]" }

/** Index just past the string literal opening at `i`. Template holes are not parsed: no call site
 *  puts a quote inside one. */
function pastString(text: string, i: number): number {
	const quote = text[i]
	for (let j = i + 1; j < text.length; j++) {
		if (text[j] === "\\") j++
		else if (text[j] === quote) return j + 1
	}
	throw new Error(`unterminated string at ${i}`)
}

/** Index of the bracket closing the one that opens at `start`. */
function closing(text: string, start: number): number {
	const stack = [CLOSER[text[start] ?? ""]]
	let i = start + 1
	while (i < text.length && stack.length > 0) {
		const ch = text[i] ?? ""
		if (QUOTES.has(ch)) {
			i = pastString(text, i)
			continue
		}
		if (ch in CLOSER) stack.push(CLOSER[ch])
		else if (ch === stack.at(-1)) stack.pop()
		i++
	}
	if (stack.length > 0) throw new Error(`unbalanced bracket at ${start}`)
	return i - 1
}

interface Call {
	site: string
	args: string
}

function callsIn(file: { path: string; text: string }): Call[] {
	return [...file.text.matchAll(/\bopenToast\(/g)].map((match) => {
		const open = match.index + match[0].length - 1
		const line = file.text.slice(0, open).split("\n").length
		return { site: `${file.path}:${line}`, args: file.text.slice(open + 1, closing(file.text, open)) }
	})
}

const LITERAL_KIND = /\bkind:\s*(?:"(?:success|error)"|[^,{}?]+\?\s*"(?:success|error)"\s*:\s*"(?:success|error)")\s*[,}\n]/

/** One object literal, nothing after it, with a literal `kind`. */
function oneLiteralWithKind(args: string): boolean {
	const text = args.trim()
	if (!text.startsWith("{")) return false
	const end = closing(text, 0)
	const rest = text.slice(end + 1).trim()
	return (rest === "" || rest === ",") && LITERAL_KIND.test(text.slice(0, end + 1))
}

describe("every snack names its kind", () => {
	const calls = files.flatMap(callsIn)

	test("there are enough calls for the scan to mean something", () => {
		expect(calls.length).toBeGreaterThanOrEqual(100)
	})

	test("each call passes one object literal whose kind is success, error, or a ternary of the two", () => {
		expect(calls.filter((call) => !oneLiteralWithKind(call.args)).map((call) => call.site)).toEqual([])
	})

	test("no call carries an icon or a colour, and nothing reads a duration", () => {
		expect(calls.filter((call) => /\b(?:icon|color):/.test(call.args)).map((call) => call.site)).toEqual([])
		expect(filesMatching(/\bTOAST_DURATION\b/)).toEqual([])
	})
})
