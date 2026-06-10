/**
 * Build explorer URLs for tx hashes + contract addresses, targeting
 * https://testnet.aztecscan.xyz (configurable via VITE_EXPLORER_BASE_URL).
 *
 * aztecscan URL shapes (verified 2026-05-22):
 *   - Transactions live at `/tx-effects/<hash>`
 *   - Contract instances live at `/contracts/instances/<address>` (Dripper, USDC, ETH)
 *
 * Defaults to https://testnet.aztecscan.xyz; override via VITE_EXPLORER_BASE_URL. The helpers
 * return "" only for an empty hash/address, so callers can still suppress a missing link.
 */

function base(): string {
	const url = import.meta.env.VITE_EXPLORER_BASE_URL ?? "https://testnet.aztecscan.xyz"
	return url.endsWith("/") ? url.slice(0, -1) : url
}

/** Only a strict 32-byte hex hash may reach a URL — journal fields are user-writable storage. */
const TX_HASH_SHAPE = /^0x[0-9a-f]{64}$/i

export function explorerTxUrl(hash: string): string {
	const b = base()
	if (!b || !TX_HASH_SHAPE.test(hash)) return ""
	return `${b}/tx-effects/${hash}`
}

/** Sepolia etherscan link for the bridge's L1 legs (deposit + consume txs). */
export function etherscanTxUrl(hash: string): string {
	if (!TX_HASH_SHAPE.test(hash)) return ""
	return `https://sepolia.etherscan.io/tx/${hash}`
}

export function explorerAddressUrl(addr: string): string {
	const b = base()
	if (!b || !addr) return ""
	return `${b}/contracts/instances/${addr}`
}
