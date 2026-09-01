/**
 * RP ID drift detector + manifest validator.
 *
 * Pure functions. The CLI runner at `scripts/check-rp-id.ts` wires
 * these against the real source manifest config + the
 * passkey-touching source files. Tests at `check-rp-id.test.ts`
 * exercise both with synthetic fixtures.
 *
 * Invariants:
 * 1. `manifest.host_permissions` contains `https://${RP_ID}/`.
 * 2. No string literal `"nulo.sh"` (or whatever RP_ID is) appears in
 *    a passkey-touching source file outside `RP_ID`'s definition site.
 *
 * Why we read the SOURCE manifest, not the built one: pre-build
 * `dist/{chrome,firefox}/manifest.json` either don't exist yet or
 * are stale from an earlier run (false-pass risk). Both browser
 * configs spread `...ManifestConfig` so reading the source is
 * sufficient.
 */

export type ValidationResult = { ok: true } | { ok: false; error: string; details?: Record<string, unknown> }

/** Verify the manifest's `host_permissions` contains the expected
 *  `https://${rpId}/` entry. Pure: takes the parsed manifest object,
 *  not a file path. Caller imports the manifest module and passes
 *  its export. */
export function validateHostPermissions(manifest: { host_permissions?: readonly string[] }, rpId: string): ValidationResult {
	const expected = `https://${rpId}/`
	const hostPermissions = manifest.host_permissions
	if (!Array.isArray(hostPermissions)) {
		return {
			ok: false,
			error: "manifest.host_permissions is missing or not an array",
			details: { manifestKeys: Object.keys(manifest as Record<string, unknown>) },
		}
	}
	if (!hostPermissions.includes(expected)) {
		return {
			ok: false,
			error: `manifest.host_permissions does not contain "${expected}"`,
			details: { expected, hostPermissions: [...hostPermissions] },
		}
	}
	return { ok: true }
}

export interface DriftFinding {
	/** Source file path (relative or absolute, caller's choice). */
	file: string
	/** 1-based line number of the offending literal. */
	line: number
	/** The literal string content that matched (without quotes). */
	literal: string
	/** Surrounding context (the offending line itself). */
	context: string
}

/**
 * Scan a source file for string literals matching the RP ID value.
 *
 * Catches the case where a future contributor types
 * `rpId: "nulo.sh"` or `id: "nulo.sh"` directly instead of importing
 * `RP_ID`. The scan deliberately matches LITERAL VALUES, not just
 * `rpId:` keys — that catches both the `rp.id:` and `rpId:` forms
 * without an AST walk.
 *
 * Skips:
 *   - Lines inside `// ` line comments.
 *   - Lines inside `/* ... *​/` block comments (best-effort).
 *   - The line where `RP_ID = "..."` is defined (caller passes
 *     `excludeDefinition: true` for the spec.ts file).
 *
 * Returns an array of drift findings. Empty array means "clean."
 *
 * NOTE: This is an intentionally simple text scan, not a TypeScript
 * AST walk. The scope is narrow: passkey-touching files (which are
 * 2-3 files total) where the cost of false positives is low and the
 * cost of false negatives is high. If the scope ever broadens to
 * lots of files, swap in a proper AST walk.
 */
export function scanRpIdLiteralDrift(
	file: string,
	content: string,
	rpIdValue: string,
	options: { excludeDefinition?: boolean } = {},
): DriftFinding[] {
	const findings: DriftFinding[] = []
	const literals = [`"${rpIdValue}"`, `'${rpIdValue}'`, `\`${rpIdValue}\``]

	const lines = content.split("\n")
	let inBlockComment = false

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]
		const step = stripCommentsForScan(raw, inBlockComment)
		inBlockComment = step.inBlockComment
		if (step.skip) continue

		// Skip the RP_ID definition line (caller opted in).
		if (options.excludeDefinition && /\bRP_ID\s*=\s*["'`]/.test(step.line)) {
			continue
		}

		if (findLiteral(step.line, literals)) {
			findings.push({
				file,
				line: i + 1,
				literal: rpIdValue,
				context: raw.trim(),
			})
		}
	}

	return findings
}

/** One comment-stripping step of the scan. Best-effort block-comment tracking: doesn't
 *  handle pathological cases like nested `/* /*` strings inside comments, but the
 *  passkey-touching files we scan don't have those. `skip` = the whole line is inside a
 *  block comment. */
function stripCommentsForScan(raw: string, inBlockComment: boolean): { line: string; inBlockComment: boolean; skip: boolean } {
	let line = raw
	let inside = inBlockComment
	if (inside) {
		const close = line.indexOf("*/")
		if (close === -1) return { line: "", inBlockComment: true, skip: true }
		line = line.slice(close + 2)
		inside = false
	}
	const open = line.indexOf("/*")
	if (open !== -1 && line.indexOf("*/", open) === -1) {
		line = line.slice(0, open)
		inside = true
	}
	// Strip trailing line comments.
	const lineCommentIdx = stripLineComment(line)
	if (lineCommentIdx !== -1) {
		line = line.slice(0, lineCommentIdx)
	}
	return { line, inBlockComment: inside, skip: false }
}

/** Returns the index of `//` comment start, or -1 if no line comment.
 *  Naive — doesn't fully tokenize, but catches the common cases in
 *  Vue/TS source. */
function stripLineComment(line: string): number {
	// Find `//` not inside a string.
	let inStr: '"' | "'" | "`" | null = null
	for (let i = 0; i < line.length - 1; i++) {
		const ch = line[i]
		const next = line[i + 1]
		if (inStr) {
			if (ch === "\\") {
				i++ // skip escape
				continue
			}
			if (ch === inStr) inStr = null
			continue
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inStr = ch
			continue
		}
		if (ch === "/" && next === "/") return i
	}
	return -1
}

function findLiteral(line: string, needles: string[]): string | null {
	for (const n of needles) {
		if (line.includes(n)) return n
	}
	return null
}
