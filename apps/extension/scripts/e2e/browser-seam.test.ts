import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
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

/**
 * The scan walks the TypeScript AST rather than the text. A regex literal ending in `\//` — one
 * exists at `fixtures/extension.ts` — makes any line-based comment strip swallow the rest of its
 * line, so a violation appended there would go unreported. A guard that silently stops matching
 * is worse than no guard, so the parser decides what is code.
 *
 * What it still cannot see: an alias assigned across files, or one reached through a parameter or
 * a property. Local aliases (`const b = ctx.browser`) ARE caught; the rest needs type information
 * this scan deliberately does not build.
 */
const isBrowserProperty = (node: ts.Node): boolean => ts.isPropertyAccessExpression(node) && node.name.text === "browser"

/** `x.browser` or `x.browser()` — the two shapes that yield a Browser without naming a driver. */
const yieldsBrowser = (node: ts.Expression): boolean =>
	isBrowserProperty(node) || (ts.isCallExpression(node) && isBrowserProperty(node.expression))

function localBrowserAliases(file: ts.SourceFile): Set<string> {
	const aliases = new Set<string>()
	const visit = (node: ts.Node): void => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && yieldsBrowser(node.initializer)) {
			aliases.add(node.name.text)
		}
		ts.forEachChild(node, visit)
	}
	ts.forEachChild(file, visit)
	return aliases
}

function closesABrowser(receiver: ts.Expression, aliases: Set<string>): boolean {
	if (yieldsBrowser(receiver)) return true
	if (ts.isParenthesizedExpression(receiver)) return closesABrowser(receiver.expression, aliases)
	if (ts.isIdentifier(receiver)) return receiver.text === "browser" || aliases.has(receiver.text)
	return false
}

/** 1-based line numbers of executable seam violations in one file's source. */
function violations(source: string): { scheme: number[]; close: number[] } {
	const file = ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true)
	const aliases = localBrowserAliases(file)
	const scheme: number[] = []
	const close: number[] = []
	const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1

	const visit = (node: ts.Node): void => {
		if (isSchemeText(node)) scheme.push(lineOf(node))
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "close") {
			if (closesABrowser(node.expression.expression, aliases)) close.push(lineOf(node))
		}
		ts.forEachChild(node, visit)
	}
	ts.forEachChild(file, visit)
	return { scheme: [...new Set(scheme)].sort((a, b) => a - b), close: [...new Set(close)].sort((a, b) => a - b) }
}

/** String and template *text* only — a comment or a regex literal is never one of these nodes. */
function isSchemeText(node: ts.Node): boolean {
	const textual =
		ts.isStringLiteral(node) ||
		ts.isNoSubstitutionTemplateLiteral(node) ||
		ts.isTemplateHead(node) ||
		ts.isTemplateMiddle(node) ||
		ts.isTemplateTail(node)
	return textual && (node as ts.LiteralLikeNode).text.includes(SCHEME)
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
	const visited: string[] = []
	for (const { rel, source } of e2eSources(E2E_ROOT)) {
		visited.push(rel)
		const found = violations(source)
		scheme.push(...found.scheme.map((n) => `${rel}:${n}`))
		close.push(...found.close.map((n) => `${rel}:${n}`))
	}
	return { scheme, close, visited }
}

/**
 * Every browser-specific detail reaches the e2e suite through `fixtures/browser/`. A hardcoded
 * scheme makes a test Chrome-only without saying so, and closing the browser directly leaks
 * whatever else a driver owns — a WebDriver process, a profile directory — because only the
 * driver's own `close()` knows about them.
 */
describe("browser seam", () => {
	const found = scan()

	// A count alone would still pass with the whole network tree missing, so name one file from
	// each subtree the scan must reach.
	test("the scan reaches the smoke tree, the network tree and the fixtures", () => {
		expect(found.visited).toEqual(expect.arrayContaining(["fixtures/extension.ts", "fixtures/popups.ts", "migration.test.ts"]))
		expect(found.visited.filter((f) => f.startsWith("network/")).length).toBeGreaterThan(20)
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
	test("flags a scheme literal and a direct close", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, not a template.
		const src = ["await page.goto(`chrome-extension://${id}/src/popup/index.html`)", "await ctx.browser.close()"].join("\n")
		expect(violations(src)).toEqual({ scheme: [1], close: [2] })
	})

	// A regex ending in `\//` reads as a line comment to any text-based strip, which silently hid
	// everything after it on that line. This is the real construct, from fixtures/extension.ts.
	test("a violation after a regex literal ending in an escaped slash is still seen", () => {
		const src = ["const RE = /^(?:text|xpath|aria|pierce)\\//; await ctx.browser.close()"].join("\n")
		expect(violations(src).close).toEqual([1])
	})

	test.each([
		["split across lines", "await ctx.browser\n\t.close()"],
		["optional chaining", "await ctx.browser?.close()"],
		["a local alias", "const b = ctx.browser\nawait b.close()"],
		["parenthesised", "await (ctx).browser.close()"],
		["a browser() accessor", "await page.browser().close()"],
	])("flags a close reached by %s", (_label, src) => {
		expect(violations(src).close.length).toBe(1)
	})

	test("ignores both inside line and block comments", () => {
		const src = ["// chrome-extension:// and browser.close()", "/* chrome-extension://", "   browser.close() */", "const ok = 1"].join(
			"\n",
		)
		expect(violations(src)).toEqual({ scheme: [], close: [] })
	})

	test("does not flag the seam's own call shapes", () => {
		const src = 'await page.goto(extensionUrl(id, "/src/popup/index.html"))\nawait ctx.close()'
		expect(violations(src)).toEqual({ scheme: [], close: [] })
	})

	test("a scheme inside a string still counts, and one inside a regex does not", () => {
		expect(violations('const u = "chrome-extension://abc/x"').scheme).toEqual([1])
		expect(violations("const re = /chrome-extension:\\/\\//").scheme).toEqual([])
	})
})
