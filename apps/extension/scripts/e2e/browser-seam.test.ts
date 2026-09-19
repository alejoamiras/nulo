import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, test } from "vitest"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const E2E_ROOT = path.resolve(__dirname, "../../tests/e2e")

/**
 * Files allowed to name a browser directly. `fixtures/browser/{chrome,firefox}.ts` ARE the seam;
 * `scripts/check-derivation-parity.ts` is a standalone tool that launches its own Chrome,
 * owns no `ExtensionContext` and is never run by a suite, so it has nothing to keep in step.
 */
const EXEMPT = new Set(["fixtures/browser/chrome.ts", "fixtures/browser/firefox.ts", "scripts/check-derivation-parity.ts"])

const SCHEME = "chrome-extension://"
const WORKER_TYPE = "service_worker"
const WORKER_LOADER = "service-worker-loader"

/**
 * Chrome-only target assumptions that predate the seam. Firefox MV3 runs a background *script* and
 * produces no `service_worker` target at all, so each of these is a place a ported suite stops —
 * as `settleLaunchedExtension` did, silently, until a probe spent thirty seconds proving it.
 * The counts are exact and only shrink: a new site fails this test instead of joining the list.
 */
const WORKER_DEBT: Record<string, number> = {
	"fixtures/helpers.ts": 2,
	"fixtures/journal.ts": 1,
	"helpers/rpc-intercept.ts": 1,
	"network/cold-wake-discovery.test.ts": 1,
}

/**
 * The scan walks the TypeScript AST rather than the text. A regex literal ending in `\//` — one
 * exists at `fixtures/extension.ts` — makes any line-based comment strip swallow the rest of its
 * line, so a violation appended there would go unreported. A guard that silently stops matching
 * is worse than no guard, so the parser decides what is code.
 *
 * Two limits it does have. A `const` bound to a browser is followed only within the file, and the
 * name set is file-wide rather than scope-aware — so a shadowed binding of the same name can
 * produce a false positive, which rejects a legitimate test rather than admitting a violation.
 * Anything reached across a file, a parameter or a property needs type information this scan
 * deliberately does not build.
 */

/** Wrappers that change nothing at runtime, and so must not change what the scan sees. */
function unwrap(node: ts.Expression): ts.Expression {
	let current = node
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isSatisfiesExpression(current) ||
		ts.isNonNullExpression(current) ||
		ts.isTypeAssertionExpression(current)
	) {
		current = current.expression
	}
	return current
}

const isBrowserProperty = (node: ts.Node): boolean => ts.isPropertyAccessExpression(node) && node.name.text === "browser"

/** `x.browser` or `x.browser()` — the two shapes that yield a Browser without naming a driver. */
function yieldsBrowser(node: ts.Expression): boolean {
	const bare = unwrap(node)
	return isBrowserProperty(bare) || (ts.isCallExpression(bare) && isBrowserProperty(unwrap(bare.expression)))
}

function localBrowserAliases(file: ts.SourceFile): Set<string> {
	const aliases = new Set<string>()
	const visit = (node: ts.Node): void => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && yieldsBrowser(node.initializer)) {
			aliases.add(node.name.text)
		}
		// `const { browser: b } = ctx` — the plain `{ browser }` form already reads as `browser`.
		if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.propertyName && ts.isIdentifier(node.propertyName)) {
			if (node.propertyName.text === "browser") aliases.add(node.name.text)
		}
		ts.forEachChild(node, visit)
	}
	ts.forEachChild(file, visit)
	return aliases
}

function closesABrowser(receiver: ts.Expression, aliases: Set<string>): boolean {
	const bare = unwrap(receiver)
	if (yieldsBrowser(bare)) return true
	return ts.isIdentifier(bare) && (bare.text === "browser" || aliases.has(bare.text))
}

const literalText = (node: ts.Node): string | undefined =>
	ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined

const EQUALITY = new Set([
	ts.SyntaxKind.EqualsEqualsEqualsToken,
	ts.SyntaxKind.EqualsEqualsToken,
	ts.SyntaxKind.ExclamationEqualsEqualsToken,
	ts.SyntaxKind.ExclamationEqualsToken,
])
const STRING_TESTS = new Set(["includes", "startsWith", "endsWith", "indexOf", "match", "search"])

/** `x.method(...)` or `x["method"](...)` — the member a call invokes, however it was spelled. */
function calledMember(call: ts.CallExpression): { receiver: ts.Expression; name: string } | undefined {
	const callee = unwrap(call.expression)
	if (ts.isPropertyAccessExpression(callee)) return { receiver: callee.expression, name: callee.name.text }
	const key = ts.isElementAccessExpression(callee) ? literalText(unwrap(callee.argumentExpression)) : undefined
	return key !== undefined && ts.isElementAccessExpression(callee) ? { receiver: callee.expression, name: key } : undefined
}

/**
 * A target test, never a log line: the type compared for (in)equality, or the loader URL handed
 * to a string test. A negated comparison assumes a service-worker target exists just as much.
 */
function testsForWorkerTarget(node: ts.Node): boolean {
	if (ts.isBinaryExpression(node)) {
		return EQUALITY.has(node.operatorToken.kind) && [node.left, node.right].some((side) => literalText(unwrap(side)) === WORKER_TYPE)
	}
	if (!ts.isCallExpression(node) || !STRING_TESTS.has(calledMember(node)?.name ?? "")) return false
	return node.arguments.some((arg) => literalText(unwrap(arg))?.includes(WORKER_LOADER) ?? false)
}

/**
 * Direct `browser.waitForTarget` calls left outside the seam, exact and shrink-only. Over BiDi no
 * event reports the URL a new window loads, so a URL predicate there waits out its whole timeout.
 * The fixture entry waits for the service worker, which is Chrome-only by nature.
 */
const WAIT_DEBT: Record<string, number> = {
	"fixtures/helpers.ts": 1,
}

/** 1-based line numbers of executable seam violations in one file's source. */
function violations(source: string): { scheme: number[]; close: number[]; worker: number[]; wait: number[]; page: number[] } {
	const file = ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true)
	// Source the parser could not read is source the scan cannot vouch for: an unterminated regex
	// swallows whatever follows it, so accepting a partial tree would fail open.
	const parseErrors = (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
	if (parseErrors.length > 0) {
		throw new Error(`seam scan could not parse the source: ${ts.flattenDiagnosticMessageText(parseErrors[0].messageText, " ")}`)
	}
	const aliases = localBrowserAliases(file)
	const scheme: number[] = []
	const close: number[] = []
	const worker: number[] = []
	const wait: number[] = []
	const page: number[] = []
	const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1

	/** Calls the seam owns, by the member name a test would reach for on a browser. */
	const onBrowser = new Map([
		["close", close],
		["waitForTarget", wait],
		["newPage", page],
	])

	const visit = (node: ts.Node): void => {
		if (isSchemeText(node)) scheme.push(lineOf(node))
		if (testsForWorkerTarget(node)) worker.push(lineOf(node))
		const member = ts.isCallExpression(node) ? calledMember(node) : undefined
		if (member && closesABrowser(member.receiver, aliases)) onBrowser.get(member.name)?.push(lineOf(node))
		ts.forEachChild(node, visit)
	}
	ts.forEachChild(file, visit)
	const dedupe = (lines: number[]) => [...new Set(lines)].sort((a, b) => a - b)
	return { scheme: dedupe(scheme), close: dedupe(close), worker: dedupe(worker), wait: dedupe(wait), page: dedupe(page) }
}

const BROWSER_FLAGS = new Set(["isFirefox", "BROWSER"])

/**
 * 1-based lines where a file asks which browser it is on. A shared helper that does is a second,
 * unlisted driver: the behaviour it forks never shows up on `BrowserDriver`, so the next browser —
 * or the next reader — cannot find it. A test may ask, to skip or to state a real difference.
 */
function browserBranches(source: string): number[] {
	const file = ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true)
	const flags = new Set([...BROWSER_FLAGS, ...importedFlagAliases(file)])
	const namespaces = importedNamespaces(file)
	const lines: number[] = []
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node)) return
		const asks = asksTheDriverOrTheEnv(node) || (ts.isIdentifier(node) && flags.has(node.text) && !isMemberName(node, namespaces))
		if (asks) lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
		ts.forEachChild(node, visit)
	}
	ts.forEachChild(file, visit)
	return [...new Set(lines)]
}

/** `import { isFirefox as ff }` — the local name is the flag for the rest of the file. */
function importedFlagAliases(file: ts.SourceFile): string[] {
	return file.statements
		.filter(ts.isImportDeclaration)
		.flatMap((declaration) => {
			const named = declaration.importClause?.namedBindings
			return named && ts.isNamedImports(named) ? [...named.elements] : []
		})
		.filter((spec) => spec.propertyName !== undefined && BROWSER_FLAGS.has(spec.propertyName.text))
		.map((spec) => spec.name.text)
}

/** `import * as seam` — `seam.isFirefox` is the flag itself, reached through the module. */
function importedNamespaces(file: ts.SourceFile): Set<string> {
	const names = file.statements.filter(ts.isImportDeclaration).flatMap((declaration) => {
		const bindings = declaration.importClause?.namedBindings
		return bindings && ts.isNamespaceImport(bindings) ? [bindings.name.text] : []
	})
	return new Set(names)
}

/** `x.BROWSER` and `{ BROWSER: … }` name a member of something else — unless `x` is a module. */
function isMemberName(node: ts.Identifier, namespaces: Set<string>): boolean {
	const parent = node.parent
	if (ts.isPropertyAssignment(parent)) return parent.name === node
	if (!ts.isPropertyAccessExpression(parent) || parent.name !== node) return false
	const receiver = unwrap(parent.expression)
	return !(ts.isIdentifier(receiver) && namespaces.has(receiver.text))
}

/** The same question put to `driver.kind`, or to the variable the seam itself resolves from. */
function asksTheDriverOrTheEnv(node: ts.Node): boolean {
	if (literalText(node) === "NULO_E2E_BROWSER") return true
	if (!ts.isPropertyAccessExpression(node)) return false
	if (node.name.text === "NULO_E2E_BROWSER") return true
	const receiver = unwrap(node.expression)
	return node.name.text === "kind" && ts.isIdentifier(receiver) && receiver.text === "driver"
}

const isSharedHelper = (rel: string): boolean =>
	(rel.startsWith("fixtures/") && !rel.startsWith("fixtures/browser/")) || rel.startsWith("helpers/")

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
	const worker: Record<string, number> = {}
	const wait: Record<string, number> = {}
	const page: string[] = []
	const branch: string[] = []
	const visited: string[] = []
	for (const { rel, source } of e2eSources(E2E_ROOT)) {
		visited.push(rel)
		if (isSharedHelper(rel)) branch.push(...browserBranches(source).map((n) => `${rel}:${n}`))
		const found = violations(source)
		scheme.push(...found.scheme.map((n) => `${rel}:${n}`))
		close.push(...found.close.map((n) => `${rel}:${n}`))
		if (found.worker.length) worker[rel] = found.worker.length
		if (found.wait.length) wait[rel] = found.wait.length
		page.push(...found.page.map((n) => `${rel}:${n}`))
	}
	return { scheme, close, worker, wait, page, branch, visited }
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

	test("the service-worker target debt is exactly what Firefox still has to unpick", () => {
		expect(found.worker).toEqual(WORKER_DEBT)
	})

	test("no new direct browser.waitForTarget — use the seam's waitForTarget()", () => {
		expect(found.wait).toEqual(WAIT_DEBT)
	})

	// Firefox puts a new tab in the most recently focused window, which is the wallet's minimized
	// PXE window: a page opened there is never visible, never animates and cannot run WebAuthn.
	test("no page is opened outside the seam — use newPage()", () => {
		expect(found.page).toEqual([])
	})

	test("no shared helper branches on the browser — put the difference on BrowserDriver", () => {
		expect(found.branch).toEqual([])
	})
})

/** A guard whose scanner silently matched nothing would pass forever; these pin that it bites. */
describe("browser seam guard", () => {
	test("flags a scheme literal and a direct close", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text under scan, not a template.
		const src = ["await page.goto(`chrome-extension://${id}/src/popup/index.html`)", "await ctx.browser.close()"].join("\n")
		expect(violations(src)).toEqual({ scheme: [1], close: [2], worker: [], wait: [], page: [] })
	})

	// A regex ending in `\//` reads as a line comment to any text-based strip, which silently hid
	// everything after it on that line. This is the real construct, from fixtures/extension.ts.
	test("a violation after a regex literal ending in an escaped slash is still seen", () => {
		const src = ["const RE = /^(?:text|xpath|aria|pierce)\\//; await ctx.browser.close()"].join("\n")
		expect(violations(src).close).toEqual([1])
	})

	// Wrapped the way real test code is written. It matters: at the top level of a module TS reads
	// `await (x)` as a call to a function named `await`, so an unwrapped fixture would exercise a
	// different tree than the one the suite actually contains.
	const inAsync = (body: string) => `async function spec() {\n${body}\n}`

	// Each of these reaches the same Browser by a route that changes nothing at runtime, so each
	// has to reach the same verdict.
	test.each([
		["split across lines", "await ctx.browser\n\t.close()"],
		["optional chaining", "await ctx.browser?.close()"],
		["a local alias", "const b = ctx.browser\nawait b.close()"],
		["a parenthesised alias initializer", "const b = (ctx.browser)\nawait b.close()"],
		["parentheses", "await (ctx.browser).close()"],
		["a browser() accessor", "await page.browser().close()"],
		["an as-assertion", "await (ctx.browser as Browser).close()"],
		["a satisfies expression", "await (ctx.browser satisfies Browser).close()"],
		["a non-null assertion", "await ctx.browser!.close()"],
	])("flags a close reached by %s", (_label, body) => {
		expect(violations(inAsync(body)).close.length).toBe(1)
	})

	test("leaves a page close alone", () => {
		expect(violations(inAsync("await page.close()\nawait popup.close()")).close).toEqual([])
	})

	// The gap a probe found the expensive way: neither of the other two rules sees it, and Firefox
	// MV3 never produces the target, so such a wait just burns its whole timeout.
	test.each([
		["a type comparison", 'const live = t.type() === "service_worker"'],
		["the comparison reversed", 'const live = "service_worker" === t.type()'],
		["the loader URL", 'await browser.waitForTarget((t) => t.url().includes("service-worker-loader"))'],
	])("flags a service-worker target test written as %s", (_label, body) => {
		expect(violations(inAsync(body)).worker).toEqual([2])
	})

	// Ordinary spellings of the same call; each was a live bypass of the rule above it.
	test.each([
		["element access", 'await ctx.browser["waitForTarget"]((t) => true)', "wait"],
		["a renamed destructure", "const { browser: b } = ctx\nawait b.waitForTarget((t) => true)", "wait"],
		["element-access close", 'await ctx.browser["close"]()', "close"],
		["a negated type test", 'const others = targets.filter((t) => t.type() !== "service_worker")', "worker"],
	] as const)("flags %s", (_label, body, rule) => {
		expect(violations(inAsync(body))[rule].length).toBe(1)
	})

	test("flags a direct newPage on a browser, and not the seam's own", () => {
		expect(violations(inAsync("const page = await ctx.browser.newPage()")).page).toEqual([2])
		expect(violations(inAsync("const page = await newPage(ctx.browser)")).page).toEqual([])
	})

	test("flags a browser test, and not the import that would feed one", () => {
		expect(browserBranches('import { isFirefox } from "./browser"\nif (isFirefox) stub()')).toEqual([2])
		expect(browserBranches('const dir = BROWSER === "firefox" ? a : b')).toEqual([1])
		expect(browserBranches('import { isFirefox } from "./browser"')).toEqual([])
	})

	test.each([
		["an import alias", 'import { isFirefox as ff } from "./browser"\nif (ff) stub()'],
		["a namespace import", 'import * as seam from "./browser"\nif (seam.isFirefox) stub()'],
		["the driver's kind", 'import { driver } from "./browser"\nif (driver.kind === "firefox") stub()'],
		["the env var", 'const b = 1\nif (process.env.NULO_E2E_BROWSER === "firefox") stub()'],
		["the env var by key", 'const b = 1\nif (process.env["NULO_E2E_BROWSER"] === "firefox") stub()'],
	])("flags a browser test asked through %s", (_label, body) => {
		expect(browserBranches(body)).toEqual([2])
	})

	test("leaves a member that merely shares the flag's name alone", () => {
		expect(browserBranches("const ports = { BROWSER: 9222 }\nlog(ports.BROWSER)")).toEqual([])
	})

	test("flags a direct waitForTarget on a browser, and not the seam's own", () => {
		expect(violations(inAsync("await ctx.browser.waitForTarget((t) => true)")).wait).toEqual([2])
		expect(violations(inAsync("await waitForTarget(ctx.browser, (t) => true, 1000)")).wait).toEqual([])
	})

	test("leaves the words alone outside a target test", () => {
		expect(violations('const msg = "<no service_worker target>"').worker).toEqual([])
		expect(violations('console.log("waiting for service-worker-loader")').worker).toEqual([])
	})

	// Source the parser rejects is source the scan cannot vouch for; accepting a partial tree is
	// how an unterminated regex would swallow a violation and report a clean file.
	test("refuses to vouch for source it cannot parse", () => {
		expect(() => violations("const re = /unterminated\nawait ctx.browser.close()")).toThrow(/could not parse/)
	})

	test("ignores both inside line and block comments", () => {
		const src = ["// chrome-extension:// and browser.close()", "/* chrome-extension://", "   browser.close() */", "const ok = 1"].join(
			"\n",
		)
		expect(violations(src)).toEqual({ scheme: [], close: [], worker: [], wait: [], page: [] })
	})

	test("does not flag the seam's own call shapes", () => {
		const src = 'await page.goto(extensionUrl(id, "/src/popup/index.html"))\nawait ctx.close()'
		expect(violations(src)).toEqual({ scheme: [], close: [], worker: [], wait: [], page: [] })
	})

	test("a scheme inside a string still counts, and one inside a regex does not", () => {
		expect(violations('const u = "chrome-extension://abc/x"').scheme).toEqual([1])
		expect(violations("const re = /chrome-extension:\\/\\//").scheme).toEqual([])
	})
})
