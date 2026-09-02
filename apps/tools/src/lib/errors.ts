/**
 * Normalize errors from wallet-sdk, simulation, and tx submission into
 * UI categories with their canonical toast copy.
 *
 * Categories (ordered most-specific first):
 *   user-rejected · capability-rejected · no-wallet · network · tx-reverted
 *   no-fee-asset · account-uninitialized · contract-not-registered · unknown
 */

export type ErrorCategory =
	| "user-rejected"
	| "capability-rejected"
	| "no-wallet"
	| "network"
	| "tx-reverted"
	| "no-fee-asset"
	| "account-uninitialized"
	| "contract-not-registered"
	| "unknown"

export interface NormalizedError {
	readonly category: ErrorCategory
	readonly message: string
	readonly raw: unknown
}

const TOAST_COPY: Record<ErrorCategory, string> = {
	"user-rejected": "Rejected in wallet.",
	"capability-rejected": "You denied the permissions. Click Approve to try again.",
	"no-wallet": "No wallet found. Install Nulo and reload.",
	network: "Alpha-testnet is not responding. Try again.",
	"tx-reverted": "Drip transaction reverted - view tx.",
	"no-fee-asset": "No sponsored fee route available. Wait or report.",
	"account-uninitialized": "Selected account isn't deployed on alpha-testnet. Send any tx from your wallet first.",
	"contract-not-registered": "Couldn't register the app's contracts with your wallet. Reconnect.",
	unknown: "Something went wrong. Try again.",
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: accepted at score 21 — ordered overlapping message predicates are the error-classification precedence policy
export function normalizeError(err: unknown): NormalizedError {
	const msg = err instanceof Error ? err.message : String(err)
	const lc = msg.toLowerCase()

	// Capability rejections are checked BEFORE generic user-rejection because
	// the wallet phrases the capability-denied error as "Capability denied by
	// user" - without this ordering the generic match wins and the UI shows
	// the wrong toast / hides the retry path.
	if (lc.includes("capability") && (lc.includes("denied") || lc.includes("rejected"))) {
		return {
			category: "capability-rejected",
			message: TOAST_COPY["capability-rejected"],
			raw: err,
		}
	}
	// EIP-1193 user rejection
	if (typeof err === "object" && err !== null && "code" in err && err.code === 4001) {
		return { category: "user-rejected", message: TOAST_COPY["user-rejected"], raw: err }
	}
	if (lc.includes("user rejected") || lc.includes("user cancelled") || lc.includes("user canceled") || lc.includes("denied by user")) {
		return { category: "user-rejected", message: TOAST_COPY["user-rejected"], raw: err }
	}
	if (lc.includes("no wallet") || lc.includes("wallet not found") || lc.includes("no provider")) {
		return { category: "no-wallet", message: TOAST_COPY["no-wallet"], raw: err }
	}
	if (lc.includes("existing nullifier") || lc.includes("not initialized") || lc.includes("not deployed")) {
		return {
			category: "account-uninitialized",
			message: TOAST_COPY["account-uninitialized"],
			raw: err,
		}
	}
	if (lc.includes("fee") && (lc.includes("sponsored") || lc.includes("payment"))) {
		return { category: "no-fee-asset", message: TOAST_COPY["no-fee-asset"], raw: err }
	}
	if (lc.includes("revert") || lc.includes("reverted")) {
		return { category: "tx-reverted", message: TOAST_COPY["tx-reverted"], raw: err }
	}
	if (lc.includes("unknown contract") || lc.includes("not registered")) {
		return {
			category: "contract-not-registered",
			message: TOAST_COPY["contract-not-registered"],
			raw: err,
		}
	}
	if (lc.includes("fetch") || lc.includes("network") || lc.includes("timeout") || lc.includes("econnrefused")) {
		return { category: "network", message: TOAST_COPY.network, raw: err }
	}
	return { category: "unknown", message: TOAST_COPY.unknown, raw: err }
}
