// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the fixtures below are code SAMPLES fed to the scanner as plain strings — the `${...}` in them is the very thing under test, not an unintended interpolation.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"

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
 * Identifiers that must never be flattened into a log message. Kept in sync with the runtime
 * denylist in `wallet/logger/utils.ts` — that one blanks them inside objects, this one stops them
 * being flattened into a string before the logger can see them.
 *
 * Deliberately excludes `secret` and `token`: both are ambiguous in this codebase (ciphertext on
 * `Profile`, a token contract nearly everywhere) and would fire constantly on safe lines.
 */
const SENSITIVE_IDENTIFIERS = [
	"masterKey",
	// Kebab spellings are not bare identifiers, but they ARE how exported backup JSON names these
	// fields — and `${row["master-key"]}` is a template interpolation like any other.
	"master-key",
	"masterSecret",
	"importedKeysDek",
	"imported-keys-dek",
	"dekSealed",
	"imported-keys-dek-sealed",
	"encryptedSigningKey",
	"signingKey",
	"privateKey",
	"claimSecret",
	"wrappedSecret",
	"envelopeMac",
	"mnemonic",
	"seedPhrase",
	"entropy",
	"password",
	"passhash",
	"passphrase",
	"prf",
	"rawContent",
	"privateBalance",
	"publicBalance",
	"rpcUrl",
	"endpointUrl",
]

/** Mirrors the runtime redactor's `SECRET_KEY_SUFFIX`, which covers the whole `*SecretKey` family. */
const SENSITIVE_SUFFIX = /\b[\w$-]*secretkey\b/i

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
 * The line with string contents and comments blanked, so parens inside them cannot be counted.
 *
 * `${…}` bodies survive: inside a template literal they are CODE, and they are the single most
 * important thing this scanner reads. Everything else between quotes becomes spaces — same length,
 * so column positions still line up.
 */
function stripNoise(line: string, startInBlockComment: boolean): { code: string; inBlockComment: boolean } {
	let out = ""
	let inBlock = startInBlockComment
	let quote: string | null = null
	let templateDepth = 0
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
			// Inside a template literal, `${` opens a code region that must be kept verbatim.
			if (quote === "`" && ch === "$" && next === "{") {
				templateDepth++
				out += "${"
				i++
				continue
			}
			if (templateDepth > 0) {
				if (ch === "}") templateDepth--
				out += ch
				continue
			}
			if (ch === "\\") {
				out += "  "
				i++
				continue
			}
			if (ch === quote) quote = null
			out += ch === quote ? ch : " "
			continue
		}
		if (ch === "/" && next === "/") return { code: out, inBlockComment: false }
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
	return { code: out, inBlockComment: inBlock }
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

/** Bodies of every `${…}` in the line — the code regions of a template literal. */
function interpolations(code: string): string[] {
	const out: string[] = []
	const re = /\$\{/g
	let m = re.exec(code)
	while (m) {
		let depth = 1
		let i = m.index + 2
		for (; i < code.length && depth > 0; i++) {
			if (code[i] === "{") depth++
			else if (code[i] === "}") depth--
		}
		out.push(code.slice(m.index + 2, depth === 0 ? i - 1 : code.length))
		re.lastIndex = i
		m = re.exec(code)
	}
	return out
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

function namesSensitive(text: string): string | null {
	const code = blankComparisonLiterals(text)
	for (const id of SENSITIVE_IDENTIFIERS) {
		if (new RegExp(`\\b${id}\\b`).test(code)) return id
	}
	const suffix = SENSITIVE_SUFFIX.exec(code)
	return suffix ? suffix[0] : null
}

/**
 * The three ways a value reaches a log as an unredactable string, checked against `code` (already
 * noise-stripped, so a quoted `"password"` is gone and cannot false-positive).
 *
 * The object forms — `{ password }`, `{ password: p }` — are deliberately NOT hazards: that is the
 * shape `trim()` can redact, and the shape this rule exists to push people toward.
 */
function hazards(code: string): string | null {
	for (const body of interpolations(code)) {
		const hit = namesSensitive(body)
		if (hit) return hit
	}
	for (const id of [...SENSITIVE_IDENTIFIERS, "[\\w$-]*[sS]ecretKey"]) {
		// Concatenated into a message.
		if (new RegExp(`(?:\\+\\s*\\b${id}\\b|\\b${id}\\b\\s*\\+)`).test(code)) return id
		// Handed over as a bare positional argument — a string primitive passes `trim()` intact.
		if (new RegExp(`[(,]\\s*\\b${id}\\b\\s*[,)]`).test(code)) return id
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
		let inBlock = false
		for (const line of raw) {
			const stripped = stripNoise(line, inBlock)
			inBlock = stripped.inBlockComment
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
