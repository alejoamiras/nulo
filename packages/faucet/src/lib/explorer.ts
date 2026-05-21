/**
 * Build explorer URLs for tx hashes + contract addresses, targeting
 * https://testnet.aztecscan.xyz (configurable via VITE_EXPLORER_BASE_URL).
 *
 * aztecscan URL shapes:
 *   - Transactions live at `/tx-effects/<hash>`
 *   - Contracts live at `/contracts/<address>` (Dripper, USDC, ETH)
 *
 * Returns "" when no base URL is configured — callers suppress the link
 * in that case so the surrounding text still reads cleanly.
 */

function base(): string {
	const url = import.meta.env.VITE_EXPLORER_BASE_URL
	if (!url) return ""
	return url.endsWith("/") ? url.slice(0, -1) : url
}

export function explorerTxUrl(hash: string): string {
	const b = base()
	if (!b || !hash) return ""
	return `${b}/tx-effects/${hash}`
}

export function explorerAddressUrl(addr: string): string {
	const b = base()
	if (!b || !addr) return ""
	return `${b}/contracts/${addr}`
}
