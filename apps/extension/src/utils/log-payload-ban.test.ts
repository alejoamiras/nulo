// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the fixtures below are code SAMPLES fed to the scanner as plain strings — the `${...}` in them is the very thing under test, not an unintended interpolation.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import { REDACTED_KEYS, SECRET_KEY_SUFFIX, URL_KEYS } from "@/wallet/logger/utils"

/**
 * Static ban: a log call must not flatten a sensitive value into its message.
 *
 * `console.*` is globally hijacked (`utils/console-sniffer.ts`) and every log funnels into
 * `LoggerStore`, whose only redaction is `trim()` — an OBJECT walker. A finished string is opaque
 * to it, so `` `key=${masterKey}` `` is unredactable no matter how good `trim()` becomes, and so is
 * `"key=" + masterKey` and a bare `masterKey` argument (a string primitive passes `trim()`
 * through untouched). Passing the OBJECT — `{ masterKey }` — is the safe form, because `trim()`
 * blanks it by key name. That asymmetry is the whole rule, and this test is its control. Biome
 * cannot help: no rule inspects call arguments for identifier content.
 *
 * KNOWN FALSE-NEGATIVE, stated up front (same class as `storage-facade-ban.test.ts`): this is
 * textual. Aliasing (`const p = password`), destructuring, and helper indirection all defeat it.
 * It catches the direct mistake, which is the one people actually make.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..", "..")

/**
 * Everything that compiles into the extension, not just the app.
 *
 * The transport layer logs the most dangerous payloads in the codebase (whole RPC envelopes, whose
 * `params` carry passwords and whose `result` carries export returns) and lives in
 * `packages/extension-messaging`; `packages/wallet-bridge` logs dApp traffic. Scanning only
 * `apps/extension/src` would leave the guard blind to exactly the code the branches below it spent
 * the most effort on.
 */
const SCAN_ROOTS = [
	"apps/extension/src",
	"packages/extension-messaging/src",
	"packages/wallet-bridge/src",
	"packages/wallet-core/src",
	"packages/wallet-crypto/src",
	"packages/aztec-runtime/src",
]

const SCANNED_EXT = /\.(ts|js|vue)$/

/**
 * Names extra to the runtime denylist: values `trim()` reduces by SHAPE rather than by key, so
 * they carry no denied key name of their own, but flattening them into a string still leaks.
 *
 * Deliberately excludes `secret` and `token`: both are ambiguous in this codebase (ciphertext on
 * `Profile`, a token contract nearly everywhere) and would fire constantly on safe lines.
 */
const EXTRA_NAMES = ["masterSecret", "rawContent", "privateBalance", "publicBalance"]

/**
 * Every denied name, taken FROM the runtime denylists rather than restated beside them.
 *
 * The two lists were previously kept in sync by a comment saying they were, and they were not:
 * `dek`, `bearer`, `submittedEndpointUrl`, `claim-secret` and the whole proof-material set were
 * denied at runtime and unguarded here. Importing the sets makes the parity structural — adding a
 * key to `REDACTED_KEYS` now extends this scanner in the same commit, with nothing to remember.
 */
const SENSITIVE_NAMES = [...REDACTED_KEYS, ...URL_KEYS, ...EXTRA_NAMES]

/**
 * Log-call openers.
 *
 * Receiver-agnostic on purpose: the dominant idiom in the packages is `this.logger.log(...)`, and
 * services also reach it as `deps.logger.log` / `this.deps.logError`. Anchoring on the METHOD name
 * catches every receiver; `Math.log` is the one collision worth excluding.
 */
const LOG_CALL =
	/(?<!\bMath)\s*\??\.\s*(?:log|logDebug|logInfo|logWarn|logError)\s*\(|\bconsole\s*\??\.\s*(?:log|warn|error|info|debug|trace)\s*\(/

/** Files allowed to name these identifiers near a log call. */
const ALLOWLIST: RegExp[] = [
	// The redactor and its denylist — it must name what it redacts.
	/^apps\/extension\/src\/wallet\/logger\//,
	// This test and its siblings.
	/\.test\.(ts|js)$/,
	// Build-time-excluded e2e instrumentation.
	/^apps\/extension\/src\/e2e\//,
	// Generated shims.
	/^apps\/extension\/src\/types\//,
]

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === "dist") continue
		const full = join(dir, name)
		if (statSync(full).isDirectory()) walk(full, out)
		else if (SCANNED_EXT.test(name)) out.push(full)
	}
	return out
}

/**
 * The scannable text of a file, as lines, with line numbers preserved.
 *
 * A `.vue` file's `<template>` is markup, not code: scanning it produced neither findings nor
 * meaning, only the chance of a false positive on prose. Only `<script>` bodies are code, so
 * everything outside them is blanked rather than dropped — blanking keeps every subsequent line
 * number equal to its number in the real file, which is what makes an offender report navigable.
 */
function scannableLines(path: string, content: string): string[] {
	const lines = content.split("\n")
	if (!path.endsWith(".vue")) return lines
	const out = lines.map(() => "")
	let inScript = false
	lines.forEach((line, i) => {
		if (/<script[\s>]/.test(line)) {
			inScript = true
			return
		}
		if (/<\/script>/.test(line)) {
			inScript = false
			return
		}
		if (inScript) out[i] = line
	})
	return out
}

/**
 * Lexer state that outlives a line: a template literal and a block comment both span them, and a
 * scanner that reset at every newline would read a continued template's `)` as real code — which
 * is precisely the early-window-close this stripping exists to prevent.
 */
type Interpolation = { depth: number; outerQuote: string }
type LexState = { inBlockComment: boolean; quote: string | null; interp: Interpolation[] }

const FRESH_LEX: LexState = { inBlockComment: false, quote: null, interp: [] }

/**
 * The line with string contents and comments blanked, so parens inside them cannot be counted.
 *
 * `${…}` bodies survive: inside a template literal they are CODE, and they are the single most
 * important thing this scanner reads. Everything else between quotes becomes spaces — same length,
 * so column positions still line up. `braceDepth` is a stack, not a counter: a `${…}` body can
 * contain its own object literals and nested templates, and treating the first `}` as the end of
 * the interpolation would silently blank the rest of the expression.
 */
function stripNoise(line: string, state: LexState): { code: string; state: LexState } {
	let out = ""
	let inBlock = state.inBlockComment
	let quote = state.quote
	const interp = state.interp.map((f) => ({ ...f }))
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]
		const next = line[i + 1]
		if (inBlock) {
			if (ch === "*" && next === "/") {
				inBlock = false
				out += "  "
				i++
			} else out += " "
			continue
		}
		if (quote) {
			// Inside a template literal, `${` opens a code region that must be kept verbatim — and
			// the enclosing quote goes on the stack, because the body is no longer inside it.
			if (quote === "`" && ch === "$" && next === "{") {
				interp.push({ depth: 0, outerQuote: quote })
				quote = null
				out += "${"
				i++
				continue
			}
			if (ch === "\\") {
				// A nested string inside an interpolation is kept, so bracket keys stay readable;
				// a plain string's contents are blanked.
				out += interp.length > 0 ? line.slice(i, i + 2) : "  "
				i++
				continue
			}
			if (ch === quote) {
				quote = null
				out += ch
				continue
			}
			out += interp.length > 0 ? ch : " "
			continue
		}
		if (interp.length > 0) {
			const frame = interp[interp.length - 1]
			if (ch === '"' || ch === "'" || ch === "`") {
				quote = ch
				out += ch
				continue
			}
			if (ch === "{") frame.depth++
			else if (ch === "}") {
				if (frame.depth === 0) {
					// Closes the interpolation: back inside the template literal it came from.
					interp.pop()
					quote = frame.outerQuote
				} else frame.depth--
			}
			out += ch
			continue
		}
		if (ch === "/" && next === "/") {
			out += " ".repeat(line.length - i)
			break
		}
		if (ch === "/" && next === "*") {
			inBlock = true
			out += "  "
			i++
			continue
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch
			out += ch
			continue
		}
		out += ch
	}
	return { code: out, state: { inBlockComment: inBlock, quote, interp } }
}

/**
 * How many lines past a log-call opener still count as that call's arguments.
 *
 * Ten real multi-line log calls already exist under `wallet/services/**`, and their interpolations
 * sit on continuation lines — a line-at-a-time scan sees the opener without a `${…}` and the
 * argument without a call, so it reports nothing.
 */
const MAX_CALL_WINDOW_LINES = 12

/**
 * Lines belonging to the log call opened at `start`, up to the balanced closing paren.
 *
 * Counted over `stripNoise`d text, so a paren in a comment or a string cannot close the window
 * early — the failure mode that would silently drop the payload line from the scan. When the
 * balance never resolves inside the cap the window runs to the cap, which over-scans: a loud false
 * positive rather than the silent false negative this test exists to prevent.
 */
function callWindow(code: string[], start: number): number {
	let depth = 0
	for (let i = start; i < code.length && i - start < MAX_CALL_WINDOW_LINES; i++) {
		for (const ch of code[i]) {
			if (ch === "(") depth++
			else if (ch === ")") depth--
		}
		if (depth <= 0) return i
	}
	return Math.min(start + MAX_CALL_WINDOW_LINES - 1, code.length - 1)
}

/**
 * Blank string literals inside an interpolation body, EXCEPT a bracket-access key.
 *
 * `${profile.type === "password"}` compares against a literal — nothing sensitive escapes, and
 * flagging it is pure noise. `${row["master-key"]}` reads a property, and its value does escape,
 * so that one spelling of a quoted string has to survive.
 */
function blankComparisonLiterals(body: string): string {
	return body.replace(/(["'])((?:\\.|(?!\1).)*)\1/g, (match, _q, _inner, offset: number) => {
		const isBracketKey = body[offset - 1] === "[" && body[offset + match.length] === "]"
		return isBracketKey ? match : " ".repeat(match.length)
	})
}

/** Every occurrence of a denied name in `code`, as `{ name, index }`. */
function occurrences(code: string): Array<{ name: string; index: number }> {
	const out: Array<{ name: string; index: number }> = []
	for (const id of SENSITIVE_NAMES) {
		const re = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")
		let m = re.exec(code)
		while (m) {
			out.push({ name: id, index: m.index })
			m = re.exec(code)
		}
	}
	const suffix = new RegExp(`\\b[\\w$-]*${SECRET_KEY_SUFFIX.source.replace(/\$$/, "")}\\b`, "gi")
	let m = suffix.exec(code)
	while (m) {
		out.push({ name: m[0], index: m.index })
		m = suffix.exec(code)
	}
	return out
}

/**
 * The ONE redactable position: the name is an object key, so `trim()` blanks it by name.
 *
 * `{ password }` and `{ password: p }` are safe. Everything else that reaches a log call is not —
 * `{ value: password }` and `[password]` put the primitive where `trim()` walks past it, and a
 * member access (`network.rpcUrl`), a concatenation, a bare argument and an interpolation all
 * flatten it outright. So rather than enumerating hazard shapes — which is how the first two
 * versions of this scanner ended up porous — the check inverts: any occurrence that is not a key
 * is a hazard.
 */
function isObjectKey(code: string, index: number, name: string): boolean {
	const before = code.slice(0, index).replace(/\s+$/, "")
	const after = code.slice(index + name.length).replace(/^\s+/, "")
	// `${password}` wears the same braces as `{ password }` and means the opposite thing.
	const opensObject = (before.endsWith("{") && !before.endsWith("${")) || before.endsWith(",")
	const closesProperty = after.startsWith(":") || after.startsWith("}") || after.startsWith(",")
	return opensObject && closesProperty
}

/**
 * An ARITY read of a denied value — `authWitnesses.length`, `notes.size`.
 *
 * This is the idiom the logging policy actively recommends in place of the payload, so flagging it
 * would push people back toward logging the thing itself. The measurement is not the value.
 */
const ARITY_READ = /^\.(?:length|size|byteLength)\b/

function isArityRead(code: string, index: number, name: string): boolean {
	return ARITY_READ.test(code.slice(index + name.length))
}

/**
 * The denied name this log call flattens, or null.
 *
 * `code` is already noise-stripped, so a quoted `"password"` outside an interpolation is gone;
 * inside one, `blankComparisonLiterals` removes comparison literals while keeping bracket-access
 * keys, so `${profile.type === "password"}` is quiet and `${row["master-key"]}` is not.
 */
function hazards(code: string): string | null {
	const cleaned = blankComparisonLiterals(code)
	for (const { name, index } of occurrences(cleaned)) {
		if (!isObjectKey(cleaned, index, name) && !isArityRead(cleaned, index, name)) return name
	}
	return null
}

/** Returns `file:line` for every log call flattening a sensitive identifier into its message. */
function findLoggedSecrets(files: Array<{ path: string; content: string }>): string[] {
	const offenders: string[] = []
	for (const { path, content } of files) {
		if (ALLOWLIST.some((re) => re.test(path))) continue
		const raw = scannableLines(path, content)
		const code: string[] = []
		let state = FRESH_LEX
		for (const line of raw) {
			const stripped = stripNoise(line, state)
			state = stripped.state
			code.push(stripped.code)
		}
		const reported = new Set<string>()
		for (let i = 0; i < code.length; i++) {
			if (!LOG_CALL.test(code[i])) continue
			const end = callWindow(code, i)
			for (let j = i; j <= end; j++) {
				const hit = hazards(code[j])
				if (!hit) continue
				const offense = `${path}:${j + 1} → ${hit} flattened into a log string`
				if (!reported.has(offense)) {
					reported.add(offense)
					offenders.push(offense)
				}
			}
		}
	}
	return offenders
}

describe("log-payload ban (static)", () => {
	test("no sensitive identifier is flattened into a log message", () => {
		const files = SCAN_ROOTS.flatMap((root) =>
			walk(join(REPO_ROOT, root)).map((full) => ({
				path: relative(REPO_ROOT, full),
				content: readFileSync(full, "utf8"),
			})),
		)
		expect(files.length).toBeGreaterThan(500)
		const offenders = findLoggedSecrets(files)
		expect(
			offenders,
			`Sensitive value flattened into a log string — pass the object instead so trim() can redact it:\n${offenders.join("\n")}`,
		).toEqual([])
	})

	test("the scanner actually catches a violation (self-test)", () => {
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/wallet/services/foo/service.ts", content: "this.logWarn(`unlock failed for ${password}`)" },
		])
		expect(offenders).toHaveLength(1)
		expect(offenders[0]).toContain("service.ts:1")
		expect(offenders[0]).toContain("password")
	})

	test("catches the dominant package idiom, `this.logger.log` on any receiver", () => {
		const offenders = findLoggedSecrets([
			{
				path: "packages/wallet-bridge/src/dispatcher.ts",
				content: 'this.logger.log("wallet-sdk", LogLevel.Warn, `endpoint ${rpcUrl} failed`)',
			},
		])
		expect(offenders).toHaveLength(1)
		expect(offenders[0]).toContain("rpcUrl")
	})

	test("catches a deeper receiver chain", () => {
		const offenders = findLoggedSecrets([{ path: "packages/wallet-core/src/x.ts", content: "this.deps.logError(`seed=${mnemonic}`)" }])
		expect(offenders).toHaveLength(1)
	})

	test("catches string concatenation, not just interpolation", () => {
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/wallet/services/foo/service.ts", content: 'console.error("key=" + masterKey)' },
		])
		expect(offenders).toHaveLength(1)
	})

	test("catches a bare positional argument — a string primitive passes trim() intact", () => {
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/wallet/services/foo/service.ts", content: 'console.warn("unlock failed", password)' },
		])
		expect(offenders).toHaveLength(1)
	})

	test("catches the `*SecretKey` family the runtime redactor covers by suffix", () => {
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/wallet/services/foo/service.ts", content: "this.logWarn(`k=${deployerSecretKey}`)" },
		])
		expect(offenders).toHaveLength(1)
	})

	test("catches a member expression handed over as a positional argument", () => {
		const offenders = findLoggedSecrets([
			{ path: "packages/wallet-bridge/src/x.ts", content: 'logger.log("sdk", LogLevel.Warn, network.rpcUrl)' },
		])
		expect(offenders).toHaveLength(1)
	})

	test("catches a positional argument on its own continuation line", () => {
		const offenders = findLoggedSecrets([
			{ path: "packages/wallet-core/src/x.ts", content: ["this.logWarn(", '\t"failed",', "\tpassword,", ")"].join("\n") },
		])
		expect(offenders).toHaveLength(1)
		expect(offenders[0]).toContain("x.ts:3")
	})

	test("catches concatenation of a member expression", () => {
		const offenders = findLoggedSecrets([
			{ path: "packages/wallet-core/src/x.ts", content: 'console.error("key=" + profile.masterKey)' },
		])
		expect(offenders).toHaveLength(1)
	})

	test("an object whose VALUE is the secret is NOT safe — trim() redacts by key", () => {
		// The safe shape is `{ password }`; `{ value: password }` puts the primitive where the
		// walker reads a benign key name and passes the string straight through.
		const offenders = findLoggedSecrets([
			{ path: "packages/wallet-core/src/x.ts", content: "this.logWarn('failed', { value: password })" },
		])
		expect(offenders).toHaveLength(1)
	})

	test("an array element is not safe either", () => {
		const offenders = findLoggedSecrets([{ path: "packages/wallet-core/src/x.ts", content: "this.logWarn('failed', [password])" }])
		expect(offenders).toHaveLength(1)
	})

	test("an ARITY read is allowed — it is the idiom the policy asks for", () => {
		const offenders = findLoggedSecrets([
			{ path: "packages/wallet-core/src/x.ts", content: "this.logDebug(`authwits added: ${txRequest.authWitnesses.length}`)" },
		])
		expect(offenders).toEqual([])
	})

	test("indexing the same value is not an arity read", () => {
		const offenders = findLoggedSecrets([
			{ path: "packages/wallet-core/src/x.ts", content: "this.logDebug(`first: ${txRequest.authWitnesses[0]}`)" },
		])
		expect(offenders).toHaveLength(1)
	})

	test("a nested object literal inside an interpolation does not end it early", () => {
		const offenders = findLoggedSecrets([
			{ path: "packages/wallet-core/src/x.ts", content: "this.logWarn(`${format({ ok: true }) + masterKey}`)" },
		])
		expect(offenders).toHaveLength(1)
	})

	test("a template literal spanning lines keeps its string state across them", () => {
		// Quote state that reset per line would read the `)` below as real code and close the
		// window before reaching the payload.
		const offenders = findLoggedSecrets([
			{ path: "packages/wallet-core/src/x.ts", content: ["this.logWarn(`multi ) line", "\tcontinues ${masterKey}`)"].join("\n") },
		])
		expect(offenders).toHaveLength(1)
		expect(offenders[0]).toContain("x.ts:2")
	})

	test("the denylist is sourced from the runtime redactor, not restated beside it", () => {
		for (const key of REDACTED_KEYS) expect(SENSITIVE_NAMES).toContain(key)
		for (const key of URL_KEYS) expect(SENSITIVE_NAMES).toContain(key)
		// The names the runtime reduces by shape rather than by key still have to be here.
		expect(SENSITIVE_NAMES).toContain("privateBalance")
	})

	test("catches an interpolation on a CONTINUATION line of a multi-line call", () => {
		// The shape that already exists ten times over in wallet/services/**: the opener carries no
		// `${…}` and the argument carries no call, so a line-at-a-time scan sees neither.
		const offenders = findLoggedSecrets([
			{
				path: "apps/extension/src/wallet/services/foo/service.ts",
				content: ["this.logWarn(", "\t`restore failed for ${password}`,", "\tcount,", ")"].join("\n"),
			},
		])
		expect(offenders).toHaveLength(1)
		expect(offenders[0]).toContain("service.ts:2")
	})

	test("a `)` inside a comment does not close the window early", () => {
		// The window is counted over noise-stripped text precisely so this cannot drop the payload.
		const offenders = findLoggedSecrets([
			{
				path: "apps/extension/src/wallet/services/foo/service.ts",
				content: ["this.logWarn(", "\t// L) legacy arm", "\t`key=${masterKey}`,", ")"].join("\n"),
			},
		])
		expect(offenders).toHaveLength(1)
		expect(offenders[0]).toContain("service.ts:3")
	})

	test("a `)` inside a string does not close the window early either", () => {
		const offenders = findLoggedSecrets([
			{
				path: "apps/extension/src/wallet/services/foo/service.ts",
				content: ["this.logWarn(", '\t"a ) in prose",', "\t`key=${masterKey}`,", ")"].join("\n"),
			},
		])
		expect(offenders).toHaveLength(1)
	})

	test("a quoted occurrence of the name is not a violation", () => {
		// `${profile.type === "password"}` compares against a string literal; the value never leaves.
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/wallet/services/foo/service.ts", content: 'this.logInfo(`kind=${profile.type === "password"}`)' },
		])
		expect(offenders).toEqual([])
	})

	test("does not extend the window past the call that closes on its own line", () => {
		const offenders = findLoggedSecrets([
			{
				path: "apps/extension/src/wallet/services/foo/service.ts",
				content: ["this.logWarn('starting')", "const hash = await derive(`${password}:${salt}`)"].join("\n"),
			},
		])
		expect(offenders).toEqual([])
	})

	test("reports a repeated offender once per line, not once per enclosing call", () => {
		const offenders = findLoggedSecrets([
			{
				path: "apps/extension/src/wallet/services/foo/service.ts",
				content: ["this.logWarn(fmt(", "\t`${mnemonic}`,", "))"].join("\n"),
			},
		])
		expect(offenders).toHaveLength(1)
	})

	test("catches the kebab spelling reached by bracket access, as backup JSON names it", () => {
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/utils/full-backup-helpers.ts", content: 'console.warn(`row: ${backup["master-key"]}`)' },
		])
		expect(offenders).toHaveLength(1)
	})

	test("catches a bare console call too", () => {
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/popup/pages/x.vue", content: "<script>\nconsole.error(`seed=${mnemonic}`)\n</script>" },
		])
		expect(offenders).toHaveLength(1)
	})

	test("catches a member expression, not just a bare identifier", () => {
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/wallet/services/foo/service.ts", content: "this.logDebug(`url=${network.rpcUrl}`)" },
		])
		expect(offenders).toHaveLength(1)
	})

	test("passing the OBJECT is allowed — trim() can redact that", () => {
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/wallet/services/foo/service.ts", content: "this.logWarn('unlock failed', { password })" },
		])
		expect(offenders).toEqual([])
	})

	test("comment lines naming a sensitive field are not violations", () => {
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/wallet/services/foo/service.ts", content: "// never log `${password}` — see the log-payload ban" },
		])
		expect(offenders).toEqual([])
	})

	test("a non-log line mentioning the identifier is not a violation", () => {
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/wallet/services/foo/service.ts", content: "const hash = await derive(`${password}:${salt}`)" },
		])
		expect(offenders).toEqual([])
	})

	test("Math.log is not a log call", () => {
		const offenders = findLoggedSecrets([
			{ path: "apps/extension/src/wallet/services/foo/service.ts", content: "const n = Math.log(`${password}`.length)" },
		])
		expect(offenders).toEqual([])
	})

	test("a .vue template is markup, not code — and blanking it keeps line numbers true", () => {
		const offenders = findLoggedSecrets([
			{
				path: "apps/extension/src/popup/pages/x.vue",
				content: [
					"<template>",
					"\t<p>password</p>",
					"</template>",
					"<script setup>",
					"this.logWarn(`p=${password}`)",
					"</script>",
				].join("\n"),
			},
		])
		expect(offenders).toHaveLength(1)
		expect(offenders[0]).toContain("x.vue:5")
	})

	test("the allowlist admits the redactor, which must name what it redacts", () => {
		const offenders = findLoggedSecrets([{ path: "apps/extension/src/wallet/logger/utils.ts", content: "acc[k] = `[${masterKey}]`" }])
		expect(offenders).toEqual([])
	})
})
