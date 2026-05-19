/**
 * Contacts JSON export schema.
 *
 * Two accepted shapes on import:
 *
 *   v1 (flat array — pre-isSender)
 *     [{ name, address }, ...]
 *
 *   v2 (envelope — adds sender persistence)
 *     {
 *       version: 2,
 *       contacts: [{ name, address, isSender }, ...]
 *     }
 *
 * The parser accepts EXACTLY these two shapes and rejects everything
 * else (`version: 99`, `version: "abc"`, `contacts: null`, `null`,
 * primitives, etc.) so a malformed or future file fails fast at the
 * popup boundary rather than silently dropping data downstream.
 */

export type ImportedContactV1 = {
	name?: unknown
	address?: unknown
}

export type ImportedContactV2 = ImportedContactV1 & {
	isSender?: unknown
}

export type ParsedExport = {
	version: 1 | 2
	contacts: ImportedContactV2[]
}

/** Strict parser. Throws on any shape that isn't a v1 array or
 *  a v2 envelope. Caller surfaces a generic import-failure toast. */
export function parseContactsExport(raw: string): ParsedExport {
	const parsed: unknown = JSON.parse(raw)
	if (Array.isArray(parsed)) {
		return { version: 1, contacts: parsed as ImportedContactV2[] }
	}
	if (
		parsed !== null &&
		typeof parsed === "object" &&
		(parsed as { version?: unknown }).version === 2 &&
		Array.isArray((parsed as { contacts?: unknown }).contacts)
	) {
		return { version: 2, contacts: (parsed as { contacts: ImportedContactV2[] }).contacts }
	}
	throw new Error("Unrecognized contacts export format")
}
