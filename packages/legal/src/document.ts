const HEADER_PATTERN = /^\*\*Version (\d+\.\d+(?:\.\d+)?) — effective (.+?)\*\*\s*$/
const PLACEHOLDER = "«FILL"

export interface DocumentHeader {
	readonly version: string
	/** The effective date as written, or `null` while it is still a placeholder. */
	readonly effective: string | null
}

/** The `**Version X — effective Y**` line is the documents' one machine-readable fact. */
export function parseDocumentHeader(markdown: string): DocumentHeader {
	// Position matters: the line directly under the title, not a look-alike quoted further down.
	const [title, versionLine] = markdown.split(/\r?\n/).filter((line) => line.trim() !== "")
	const match = title?.startsWith("# ") ? HEADER_PATTERN.exec(versionLine ?? "") : null
	if (!match?.[1] || !match[2]) throw new Error("legal document has no `**Version X — effective Y**` line")
	return { version: match[1], effective: match[2].includes(PLACEHOLDER) ? null : match[2] }
}

/** Versions listed in the document's `## Version history` table, in table order. */
export function parseVersionHistory(markdown: string): readonly string[] {
	const section = markdown.split(/^## Version history$/m)[1] ?? ""
	const rows = section.split("\n").filter((line) => /^\|\s*\d/.test(line))
	return rows.map((row) => row.split("|")[1]?.trim() ?? "")
}

export function hasPlaceholders(markdown: string): boolean {
	return markdown.includes(PLACEHOLDER)
}
