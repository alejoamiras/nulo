/** First 8 / last 8 with one ellipsis glyph — the app's glance form of an address; short strings pass through. */
export function maskAddress(address: string | undefined): string {
	const a = address ?? ""
	return a.length <= 16 ? a : `${a.slice(0, 8)}…${a.slice(-8)}`
}
