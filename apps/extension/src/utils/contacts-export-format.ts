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

/** Import files are hostile input: an unbounded row count would amplify
 *  downstream work (per-row storage upserts, and PXE sender registrations
 *  for `isSender` rows). Reject oversized files at the boundary. */
export const MAX_CONTACT_IMPORT_ROWS = 512

/** Byte ceiling checked BEFORE JSON.parse, so an oversized file is
 *  rejected without materializing its object graph. 512 maximal rows fit
 *  in well under 100 KB; 1 MB leaves generous formatting headroom. */
export const MAX_CONTACT_IMPORT_BYTES = 1_000_000

/** Strict parser. Throws on any shape that isn't a v1 array or
 *  a v2 envelope, and on files exceeding the byte or row bounds.
 *  Caller surfaces a generic import-failure toast. */
export function parseContactsExport(raw: string): ParsedExport {
	if (raw.length > MAX_CONTACT_IMPORT_BYTES) {
		throw new Error(`Contacts file too large (max ${MAX_CONTACT_IMPORT_BYTES} bytes)`)
	}
	const parsed: unknown = JSON.parse(raw)
	let result: ParsedExport | null = null
	if (Array.isArray(parsed)) {
		result = { version: 1, contacts: parsed as ImportedContactV2[] }
	} else if (
		parsed !== null &&
		typeof parsed === "object" &&
		(parsed as { version?: unknown }).version === 2 &&
		Array.isArray((parsed as { contacts?: unknown }).contacts)
	) {
		result = { version: 2, contacts: (parsed as { contacts: ImportedContactV2[] }).contacts }
	}
	if (!result) throw new Error("Unrecognized contacts export format")
	if (result.contacts.length > MAX_CONTACT_IMPORT_ROWS) {
		throw new Error(`Too many contacts in file (max ${MAX_CONTACT_IMPORT_ROWS})`)
	}
	return result
}
