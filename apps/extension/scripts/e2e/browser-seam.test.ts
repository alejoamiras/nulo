import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const E2E_ROOT = path.resolve(__dirname, "../../tests/e2e")

/**
 * Files allowed to name a browser directly. `fixtures/browser/chrome.ts` IS the seam's Chrome
 * half; `scripts/check-derivation-parity.ts` is a standalone tool that launches its own Chrome,
 * owns no `ExtensionContext` and is never run by a suite, so it has nothing to keep in step.
 */
const EXEMPT = new Set(["fixtures/browser/chrome.ts", "scripts/check-derivation-parity.ts"])

const SCHEME = "chrome-extension://"
const BROWSER_CLOSE = /\bbrowser(\(\))?\.close\s*\(/

/** Strings first, so a scheme literal is consumed before its `//` can open a comment. */
const STRING_OR_COMMENT = /("(?:[^"\\\n]|\\.)*")|('(?:[^'\\\n]|\\.)*')|(`(?:[^`\\]|\\.)*`)|(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)/g

/** Blank out comments, keeping code, string contents and every newline so line numbers hold. */
function stripComments(source: string): string {
	return source.replace(STRING_OR_COMMENT, (match, dq, sq, tpl) => (dq || sq || tpl ? match : match.replace(/[^\n]/g, " ")))
}

/** 1-based line numbers of executable seam violations in one file's source. */
function violations(source: string): { scheme: number[]; close: number[] } {
	const scheme: number[] = []
	const close: number[] = []
	stripComments(source)
		.split("\n")
		.forEach((line, idx) => {
			if (line.includes(SCHEME)) scheme.push(idx + 1)
			if (BROWSER_CLOSE.test(line)) close.push(idx + 1)
		})
	return { scheme, close }
}

function* e2eSources(dir: string): Generator<{ rel: string; source: string }> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			yield* e2eSources(full)
		} else if (entry.name.endsWith(".ts")) {
			const rel = path.relative(E2E_ROOT, full)
			if (!EXEMPT.has(rel)) yield { rel, source: readFileSync(full, "utf8") }
		}
	}
}

function scan() {
	const scheme: string[] = []
	const close: string[] = []
	let files = 0
	for (const { rel, source } of e2eSources(E2E_ROOT)) {
		files++
		const found = violations(source)
		scheme.push(...found.scheme.map((n) => `${rel}:${n}`))
		close.push(...found.close.map((n) => `${rel}:${n}`))
	}
	return { scheme, close, files }
}

/**
 * Every browser-specific detail reaches the e2e suite through `fixtures/browser/`. A hardcoded
 * scheme makes a test Chrome-only without saying so, and closing the browser directly leaks
 * whatever else a driver owns — a WebDriver process, a profile directory — because only the
 * driver's own `close()` knows about them.
 */
describe("browser seam", () => {
	const found = scan()

	test("the suite is actually being scanned", () => {
		expect(found.files).toBeGreaterThan(50)
	})

	test("no extension-URL scheme is written outside the seam — use extensionUrl()/EXTENSION_SCHEME", () => {
		expect(found.scheme).toEqual([])
	})

	test("no browser is closed outside the seam — use ctx.close()", () => {
		expect(found.close).toEqual([])
	})
})

/** A guard whose scanner silently matched nothing would pass forever; these pin that it bites. */
describe("browser seam guard", () => {
	test("flags an executable scheme literal and a direct close", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, not a template.
		const src = ["await page.goto(`chrome-extension://${id}/src/popup/index.html`)", "await ctx.browser.close()"].join("\n")
		expect(violations(src)).toEqual({ scheme: [1], close: [2] })
	})

	test("ignores both inside line and block comments", () => {
		const src = ["// chrome-extension:// and browser.close()", "/* chrome-extension://", "   browser.close() */", "const ok = 1"].join(
			"\n",
		)
		expect(violations(src)).toEqual({ scheme: [], close: [] })
	})

	test("does not flag the seam's own call shapes", () => {
		const src = ['await page.goto(extensionUrl(id, "/src/popup/index.html"))\nawait ctx.close()'].join("\n")
		expect(violations(src)).toEqual({ scheme: [], close: [] })
	})

	test("a scheme inside a string still counts — the comment strip must not swallow code", () => {
		expect(violations('const u = "chrome-extension://abc/x"')).toEqual({ scheme: [1], close: [] })
	})
})
