export const capitalize = (s: string): string => {
	if (!s) return ""
	return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Truncate an address to `start`…`end` chars around a separator. The
 *  separator parameter exists because the UI currently renders THREE styles
 *  ("..", "...", "…") at different sites — each site states its own, so the
 *  slicing policy still has one implementation. Unifying the visual style is
 *  a deliberate owner decision, not a refactor side effect. */
export const trimAddress = (address: string, start = 8, end = 4, separator = ".."): string => {
	if (!address || address.length <= start + end) return address
	return `${address.substring(0, start)}${separator}${address.substring(address.length - end)}`
}

/**
 * Initials for an entity name: first letters of the first two words, or the
 * first 1–2 characters of a single word, uppercased. Empty/whitespace → "".
 * Shared by contact `abbr` derivation and the account avatar so the two agree.
 */
export function getInitials(name: string): string {
	const words = (name || "").trim().split(/\s+/).filter(Boolean)
	if (words.length === 0) return ""
	if (words.length === 1) return words[0].substring(0, Math.min(words[0].length, 2)).toUpperCase()
	return (words[0][0] + words[1][0]).toUpperCase()
}

export function isValidHex(hex: string, length = 64): boolean {
	const regex = new RegExp(`^0x[a-fA-F0-9]{${length}}$`)
	return regex.test(hex)
}

export function sanitizeString(s: string, length = 0): string {
	if (!s) return ""

	let cleaned = s.replace(/[^\p{L}0-9 \-._]/gu, "")
	if (length && cleaned.length > length) {
		cleaned = cleaned.slice(0, length)
	}

	return cleaned
}

export function stringCompare(a: string, b: string): number {
	return (a || "").localeCompare(b || "", undefined, { sensitivity: "base", numeric: true })
}
