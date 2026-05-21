/**
 * Build explorer URLs for tx hashes + addresses. The base URL is
 * configurable per environment via VITE_EXPLORER_BASE_URL.
 *
 * Returns the empty string if no base URL is configured — callers
 * suppress the "view" link in that case (the toast still shows the
 * full text; users can copy the hash manually).
 */

function base(): string {
	const url = import.meta.env.VITE_EXPLORER_BASE_URL
	if (!url) return ""
	return url.endsWith("/") ? url.slice(0, -1) : url
}

export function explorerTxUrl(hash: string): string {
	const b = base()
	if (!b || !hash) return ""
	return `${b}/tx/${hash}`
}

export function explorerAddressUrl(addr: string): string {
	const b = base()
	if (!b || !addr) return ""
	return `${b}/address/${addr}`
}
