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
	"masterSecret",
	"importedKeysDek",
	"dekSealed",
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

/** Returns `file:line` for every log call interpolating a sensitive identifier. */
function findLoggedSecrets(files: Array<{ path: string; content: string }>): string[] {
	const offenders: string[] = []
	for (const { path, content } of files) {
		if (ALLOWLIST.some((re) => re.test(path))) continue
		content.split("\n").forEach((line, i) => {
			const trimmed = line.trim()
			// Comments may legitimately name these; only code lines count.
			if (/^(\/\/|\/?\*|<!--)/.test(trimmed)) return
			if (!LOG_CALL.test(trimmed)) return
			for (const id of SENSITIVE_IDENTIFIERS) {
				// Interpolated into a template literal, which is what defeats `trim()`.
				if (new RegExp(`\\$\\{[^}]*\\b${id}\\b`).test(trimmed)) {
					offenders.push(`${path}:${i + 1} → ${id} interpolated into a log string`)
					break
				}
			}
		})
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
