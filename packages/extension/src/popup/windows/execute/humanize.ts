/**
 * Operation-kind humanizer for the execute popup window.
 *
 * Pure function — no Vue, no chrome.*, no service clients. Tested
 * directly via `humanize.test.ts`.
 *
 * Cases:
 *   - `aztec_*` prefix: strip prefix, split camelCase, lowercase, then
 *     capitalize first letter. Preserves "PXE" + "AuthWit" tokens via
 *     pre-replacement so they don't get split mid-word.
 *   - `snake_case`: split underscore.
 *
 *   "aztec_sendTx"            → "Send tx"
 *   "aztec_simulateTx"        → "Simulate tx"
 *   "aztec_executeUtility"    → "Execute utility"
 *   "aztec_createAuthWit"     → "Create authwit"
 *   "aztec_getContractMetadata" → "Get contract metadata"
 *   "aztec_getPrivateEvents"  → "Get private events"
 *   "send_transaction"        → "Send transaction"
 *   "register_contract"       → "Register contract"
 */
export function humanizeOperationKind(kind: string): string {
	let out = kind
	if (out.startsWith("aztec_")) {
		out = out
			.substring(6)
			.replace("PXE", "Pxe")
			.replace("AuthWit", "Authwit")
			.replace(/([A-Z])/g, " $1")
			.toLowerCase()
	} else {
		// snake_case → space-separated words. Use `replaceAll` so
		// multi-underscore kinds render cleanly rather than leaving
		// later underscores intact.
		out = out.replaceAll("_", " ")
	}
	if (out.length === 0) return out
	return `${out[0].toUpperCase()}${out.substring(1)}`
}
