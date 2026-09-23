import { describe, expect, test } from "vitest"
import { PARSE_LIMIT_BYTES, overParseLimit } from "./parse-limit-guard"

describe("overParseLimit", () => {
	test("flags a parsed file at the limit, not one byte under it", () => {
		const files = [
			{ file: "assets/at.js", bytes: PARSE_LIMIT_BYTES },
			{ file: "assets/under.js", bytes: PARSE_LIMIT_BYTES - 1 },
		]
		expect(overParseLimit(files).map(({ file }) => file)).toEqual(["assets/at.js"])
	})

	test("covers every extension the linter parses, whatever its case", () => {
		const parsed = ["a.html", "a.htm", "a.js", "a.jsm", "a.mjs", "a.json", "a.properties", "a.ftl", "a.dtd", "A.JS"]
		const flagged = overParseLimit(parsed.map((file) => ({ file, bytes: PARSE_LIMIT_BYTES })))
		expect(flagged.map(({ file }) => file)).toEqual(parsed)
	})

	// The linter's binary scanner has no size limit, and the prover's WASM is far over this one.
	test("ignores what the linter treats as binary", () => {
		const binary = ["assets/barretenberg.wasm.gz", "assets/acvm_js_bg.wasm", "assets/app.css", "icons/icon.png"]
		expect(overParseLimit(binary.map((file) => ({ file, bytes: PARSE_LIMIT_BYTES * 10 })))).toEqual([])
	})

	test("stays under the linter's own 5 MiB", () => {
		expect(PARSE_LIMIT_BYTES).toBeLessThan(5 * 1024 * 1024)
	})
})
