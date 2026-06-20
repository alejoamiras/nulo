/**
 * `normalizeError` — captures a raw thrown value as a stable {@link JobError} envelope.
 *
 * Why this exists: `EntityStorage` writes with `JSON.stringify(entity)` and
 * the messaging layer sanitizes responses, but our error fields land in
 * the persisted record AND traverse the wire. Anything we put in
 * `JobError.normalizedRaw` must survive both. Audit findings:
 *
 *   - Arbitrary `Error` subclasses with hostile `toJSON()` can throw on stringify
 *   - Proxy traps that throw from `get`, getters that throw, circular refs,
 *     BigInt values not handled by `JSON.stringify` natively
 *   - Huge nested objects can blow `chrome.storage.session`'s quota
 *
 * Strategy:
 *   1. Outer try/catch covers EVERYTHING — even reading `.message` from a
 *      hostile Proxy. Fallback envelope is always returnable.
 *   2. `JSON.stringify` with a BigInt-safe replacer; inner try/catch for the
 *      hostile-input case (returns `null` for `normalizedRaw`).
 *   3. Hard {@link NORMALIZED_RAW_MAX_CHARS} cap with a `…[truncated]` suffix.
 *
 * The result is always a valid `JobError` — `kind` is the caller-supplied
 * category, `message` is human-readable (or `"<unrenderable error>"` in the
 * worst case), `normalizedRaw` is JSON-or-`null`.
 */

import { baseErrorJson } from "../utils/error-json"
import { NORMALIZED_RAW_MAX_CHARS } from "./types"
import type { JobError } from "./types"

const TRUNCATED_SUFFIX = "…[truncated]"

/**
 * Build a {@link JobError} from any thrown value. Never throws.
 *
 * @param raw   the value that was caught (any type)
 * @param kind  category for retry/resume policy (e.g. `"network"`, `"prover"`)
 */
export function normalizeError(raw: unknown, kind = "unknown"): JobError {
	try {
		return {
			kind,
			message: extractMessage(raw),
			normalizedRaw: trySerialize(raw),
		}
	} catch {
		// Outer guard: ANY part of the normalization above threw (typically
		// a Proxy getter trap on `.message` or `.toJSON`). Return a stable
		// fallback rather than re-throwing.
		return { kind, message: "<unrenderable error>", normalizedRaw: null }
	}
}

function extractMessage(raw: unknown): string {
	if (raw instanceof Error) return raw.message
	if (typeof raw === "string") return raw
	if (raw === null) return "null"
	if (raw === undefined) return "undefined"
	return String(raw)
}

function trySerialize(raw: unknown): string | null {
	try {
		const json = JSON.stringify(raw, jsonReplacer)
		if (json === undefined) return null
		if (json.length <= NORMALIZED_RAW_MAX_CHARS) return json
		return json.slice(0, NORMALIZED_RAW_MAX_CHARS - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX
	} catch {
		return null
	}
}

function jsonReplacer(_key: string, value: unknown): unknown {
	if (typeof value === "bigint") return `${value.toString()}n`
	// `__error` is jobs/error's discriminant; bigint keeps the trailing-`n`
	// suffix — both deliberate divergences from `utils/serialization`. Only the
	// name/message/stack projection is shared via `baseErrorJson`.
	if (value instanceof Error) return { __error: true, ...baseErrorJson(value) }
	return value
}
