// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the fixtures below are code SAMPLES fed to the scanner as plain strings — the `${...}` in them is the very thing under test, not an unintended interpolation.

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"

/**
 * Static ban: a log call must not interpolate a sensitive value into its message string.
 *
 * `console.*` is globally hijacked (`utils/console-sniffer.ts`) and every log funnels into
 * `LoggerStore`, whose only redaction is `trim()` — an OBJECT walker. A finished string is opaque
 * to it, so `` `key=${masterKey}` `` is unredactable no matter how good `trim()` becomes. That
 * makes the string-building idiom the one hazard no runtime layer can close, and this test is the
 * control for it. Biome cannot help: no rule inspects call arguments for identifier content.
 *
 * KNOWN FALSE-NEGATIVE, stated up front (same class as `storage-facade-ban.test.ts`): this is
 * textual. Aliasing (`const p = password`), destructuring, and helper indirection all defeat it.
 * It catches the direct mistake, which is the one people actually make.
 */

const SRC_ROOT = join(__dirname, "..")
const SCANNED_EXT = /\.(ts|js|vue)$/

/**
 * Identifiers that must never be interpolated into a log message. Kept in sync with the runtime
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
	"mnemonic",
	"seedPhrase",
	"entropy",
	"password",
	"passhash",
	"passphrase",
	"rawContent",
	"privateBalance",
	"publicBalance",
	"rpcUrl",
]

/** Log-call openers. `this.log*` covers every service; `logger.log`/`console.*` the rest. */
const LOG_CALL = /(?:console\.(?:log|warn|error|info|debug|trace)|this\.log(?:Debug|Info|Warn|Error)?|logger\??\.log)\s*\(/

/** Files allowed to name these identifiers near a log call. */
const ALLOWLIST: RegExp[] = [
	// The redactor and its denylist — it must name what it redacts.
	/^wallet\/logger\//,
	// This test and its siblings.
	/\.test\.(ts|js)$/,
	// Build-time-excluded e2e instrumentation.
	/^e2e\//,
	// Generated shims.
	/^types\//,
]

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) walk(full, out)
		else if (SCANNED_EXT.test(name)) out.push(full)
	}
	return out
}

/**
 * How many lines past a log-call opener still count as that call's arguments.
 *
 * Ten real multi-line log calls already exist in `wallet/services/**`, and their interpolations
 * sit on continuation lines — a line-at-a-time scan sees the opener without a `${…}` and the
 * argument without a call, so it reports nothing. The window is what closes that.
 */
const MAX_CALL_WINDOW_LINES = 12

const COMMENT_LINE = /^(\/\/|\/?\*|<!--)/

/**
 * Lines belonging to the log call opened at `start`, up to the balanced closing paren.
 *
 * Depth is counted over raw characters, so a paren inside a string literal can hold the window
 * open past the real end of the call. That direction is deliberate: an over-long window costs a
 * false POSITIVE — loud, and fixed by rewriting one line — while a short one costs a false
 * negative, which is silent and is the entire failure mode this test exists to prevent.
 */
function callWindow(lines: string[], start: number): number {
	let depth = 0
	for (let i = start; i < lines.length && i - start < MAX_CALL_WINDOW_LINES; i++) {
		for (const ch of lines[i]) {
			if (ch === "(") depth++
			else if (ch === ")") depth--
		}
		if (depth <= 0) return i
	}
	return Math.min(start + MAX_CALL_WINDOW_LINES - 1, lines.length - 1)
}

/** Returns `file:line` for every log call interpolating a sensitive identifier. */
function findLoggedSecrets(files: Array<{ path: string; content: string }>): string[] {
	const offenders: string[] = []
	for (const { path, content } of files) {
		if (ALLOWLIST.some((re) => re.test(path))) continue
		const lines = content.split("\n")
		const reported = new Set<string>()
		for (let i = 0; i < lines.length; i++) {
			// Comments may legitimately name these; only code lines open a call.
			if (COMMENT_LINE.test(lines[i].trim()) || !LOG_CALL.test(lines[i])) continue
			const end = callWindow(lines, i)
			for (let j = i; j <= end; j++) {
				const trimmed = lines[j].trim()
				if (COMMENT_LINE.test(trimmed)) continue
				for (const id of SENSITIVE_IDENTIFIERS) {
					// Interpolated into a template literal, which is what defeats `trim()`.
					if (!new RegExp(`\\$\\{[^}]*\\b${id}\\b`).test(trimmed)) continue
					const offense = `${path}:${j + 1} → ${id} interpolated into a log string`
					if (!reported.has(offense)) {
						reported.add(offense)
						offenders.push(offense)
					}
					break
				}
			}
		}
	}
	return offenders
}

describe("log-payload ban (static)", () => {
	test("no sensitive identifier is interpolated into a log message", () => {
		const files = walk(SRC_ROOT).map((full) => ({
			path: relative(SRC_ROOT, full),
			content: readFileSync(full, "utf8"),
		}))
		const offenders = findLoggedSecrets(files)
		expect(
			offenders,
			`Sensitive value interpolated into a log string — pass the object instead so trim() can redact it:\n${offenders.join("\n")}`,
		).toEqual([])
	})

	test("the scanner actually catches a violation (self-test)", () => {
		const offenders = findLoggedSecrets([
			{ path: "wallet/services/foo/service.ts", content: "this.logWarn(`unlock failed for ${password}`)" },
		])
		expect(offenders).toHaveLength(1)
		expect(offenders[0]).toContain("wallet/services/foo/service.ts:1")
		expect(offenders[0]).toContain("password")
	})

	test("catches an interpolation on a CONTINUATION line of a multi-line call", () => {
		// The shape that already exists ten times over in wallet/services/**: the opener carries no
		// `${…}` and the argument carries no call, so a line-at-a-time scan sees neither.
		const offenders = findLoggedSecrets([
			{
				path: "wallet/services/foo/service.ts",
				content: ["this.logWarn(", "\t`restore failed for ${password}`,", "\tcount,", ")"].join("\n"),
			},
		])
		expect(offenders).toHaveLength(1)
		expect(offenders[0]).toContain("service.ts:2")
	})

	test("does not extend the window past the call that closes on its own line", () => {
		const offenders = findLoggedSecrets([
			{
				path: "wallet/services/foo/service.ts",
				content: ["this.logWarn('starting')", "const hash = await derive(`${password}:${salt}`)"].join("\n"),
			},
		])
		expect(offenders).toEqual([])
	})

	test("reports a repeated offender once per line, not once per enclosing call", () => {
		const offenders = findLoggedSecrets([
			{
				path: "wallet/services/foo/service.ts",
				content: ["this.logWarn(fmt(", "\t`${mnemonic}`,", "))"].join("\n"),
			},
		])
		expect(offenders).toHaveLength(1)
	})

	test("catches the kebab spelling reached by bracket access, as backup JSON names it", () => {
		const offenders = findLoggedSecrets([
			{ path: "utils/full-backup-helpers.ts", content: 'console.warn(`row: ${backup["master-key"]}`)' },
		])
		expect(offenders).toHaveLength(1)
	})

	test("catches a bare console call too", () => {
		const offenders = findLoggedSecrets([{ path: "popup/pages/x.vue", content: "console.error(`seed=${mnemonic}`)" }])
		expect(offenders).toHaveLength(1)
	})

	test("catches a member expression, not just a bare identifier", () => {
		const offenders = findLoggedSecrets([{ path: "wallet/services/foo/service.ts", content: "this.logDebug(`url=${network.rpcUrl}`)" }])
		expect(offenders).toHaveLength(1)
	})

	test("passing the OBJECT is allowed — trim() can redact that", () => {
		const offenders = findLoggedSecrets([
			{ path: "wallet/services/foo/service.ts", content: "this.logWarn('unlock failed', { password })" },
		])
		expect(offenders).toEqual([])
	})

	test("comment lines naming a sensitive field are not violations", () => {
		const offenders = findLoggedSecrets([
			{ path: "wallet/services/foo/service.ts", content: "// never log `${password}` — see the log-payload ban" },
		])
		expect(offenders).toEqual([])
	})

	test("a non-log line mentioning the identifier is not a violation", () => {
		const offenders = findLoggedSecrets([
			{ path: "wallet/services/foo/service.ts", content: "const hash = await derive(`${password}:${salt}`)" },
		])
		expect(offenders).toEqual([])
	})

	test("the allowlist admits the redactor, which must name what it redacts", () => {
		const offenders = findLoggedSecrets([{ path: "wallet/logger/utils.ts", content: "acc[k] = `[${masterKey}]`" }])
		expect(offenders).toEqual([])
	})
})
