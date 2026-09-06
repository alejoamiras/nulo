/**
 * Reads the site-wide (`/*`) block of a Cloudflare Pages `_headers` file so `vite preview` can
 * serve the same response headers Pages does. Path-scoped blocks are ignored: preview only needs
 * the policy that applies to every response.
 */
export function siteHeaders(text: string): Record<string, string> {
	const headers: Record<string, string> = {}
	let inSiteBlock = false
	for (const raw of text.split("\n")) {
		const line = raw.trimEnd()
		if (line === "") continue
		if (!/^\s/.test(line)) {
			inSiteBlock = line.trim() === "/*"
			continue
		}
		if (!inSiteBlock) continue
		const colon = line.indexOf(":")
		if (colon === -1) continue
		headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
	}
	return headers
}
