/**
 * Byte-identical copy of the extension's `utils/string.ts` `sanitizeString`, for `Input`'s opt-in
 * `sanitize` prop ONLY. The extension keeps its own copy (used by service-layer callers — backup +
 * contact import); this package can't import the extension, so it carries its own. Internal (not a
 * public export). A bounded TEXT normalizer (allowed set: letters of any script, digits, space,
 * hyphen, dot, underscore) — NOT an HTML or URL sanitizer. Behavior is pinned byte-for-byte by
 * `sanitize.test.ts`; do not "improve" the regex.
 */
export function sanitizeString(s: string, length = 0): string {
	if (!s) return ""

	let cleaned = s.replace(/[^\p{L}0-9 \-._]/gu, "")
	if (length && cleaned.length > length) {
		cleaned = cleaned.slice(0, length)
	}

	return cleaned
}
