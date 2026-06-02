import { OriginType } from "@/wallet/services/transaction/spec"
import type { TxOrigin } from "@/wallet/services/transaction/spec"
import { trimAddress } from "@/utils/string"
import { FEE_METHODS, pickPrimaryMethod } from "./primary-method"

export { FEE_METHODS, pickPrimaryMethod }

type TxCall = {
	contract: string
	method: string
	args?: unknown[]
}

const METHOD_LABELS: Record<string, string> = {
	transfer: "Transfer (private)",
	transfer_in_private: "Transfer (private)",
	transfer_in_public: "Transfer (public)",
	transfer_to_private: "Transfer to private",
	transfer_to_public: "Transfer to public",
	// Wonderland standard function names
	transfer_private_to_private: "Transfer (private)",
	transfer_public_to_public: "Transfer (public)",
	transfer_private_to_public: "Transfer (private → public)",
	transfer_public_to_private: "Transfer (public → private)",
	mint_to_public: "Mint (public)",
	mint_to_private: "Mint (private)",
	shield: "Shield",
	unshield: "Unshield",
	redeem_shield: "Redeem shield",
}

/**
 * Look up the wallet-curated friendly label for `method` from
 * `METHOD_LABELS`. Returns `null` for anything not in the allowlist —
 * call sites that need a fallback (e.g. the journal title) use
 * `humanizeMethodName` instead, which title-cases unknowns. The
 * capability popup uses `getMethodLabel` because tautological
 * title-casing of a dApp-controlled function name on a trust-sensitive
 * surface would only add noise.
 */
export function getMethodLabel(method: string): string | null {
	return METHOD_LABELS[method] ?? null
}

/**
 * Maps a method name/selector to a human-readable label.
 * - Known Aztec methods get friendly labels
 * - Hex selectors get truncated
 * - Generic snake_case gets title-cased
 */
export function humanizeMethodName(method: string): string {
	if (!method) return "Unknown"

	const label = METHOD_LABELS[method]
	if (label) return label

	// Hex selector — truncate
	if (/^0x[0-9a-fA-F]+$/.test(method)) {
		return method.length > 10 ? `${method.slice(0, 10)}...` : method
	}

	// Generic snake_case → title case
	return method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Find the user's primary call, skipping fee/entrypoint infrastructure calls.
 * Thin wrapper around the shared `pickPrimaryMethod` helper — the method
 * name comes from there; this returns the matching call object so
 * downstream consumers can read `contract` / `transfers` / `args`.
 *
 * Generic over the call shape so consumers (e.g. `app.store.ts` operating
 * on `Tx['calls']`, which has `transfers`) keep their full type rather than
 * being narrowed to the bare `{contract, method, args}` carrier.
 *
 * Behavior preserved exactly: empty input → undefined; an all-fee-only call
 * list returns the first call verbatim (pinned as a BUG PIN in the helper's
 * test file).
 */
export function getPrimaryCall<T extends { method: string }>(calls: T[]): T | undefined {
	if (!calls?.length) return undefined
	const primary = pickPrimaryMethod(calls)
	if (!primary) return calls[0]
	return calls.find((c) => c.method === primary) ?? calls[0]
}

/**
 * Categorizes a transaction by its calls.
 */
export function getTxCategory(calls: TxCall[]): "transfer" | "mint" | "tx" {
	const call = getPrimaryCall(calls)
	if (call?.method?.startsWith("transfer")) return "transfer"
	if (call?.method?.startsWith("mint_to_")) return "mint"
	return "tx"
}

/**
 * Returns a display title for a transaction.
 * - Transfer/mint get existing labels
 * - Generic txs get humanized primary method name
 */
export function getTxTitle(calls: TxCall[]): string {
	const category = getTxCategory(calls)
	if (category === "transfer") return "Transfer"
	if (category === "mint") return "Mint"

	const primary = getPrimaryCall(calls)
	return primary ? humanizeMethodName(primary.method) : "Transaction"
}

/**
 * Returns "N calls" label for multi-call transactions, null for single.
 * Excludes fee/entrypoint infrastructure calls from the count.
 */
export function getCallCountLabel(calls: TxCall[]): string | null {
	if (!calls) return null
	const userCalls = calls.filter((c) => !FEE_METHODS.has(c.method))
	if (userCalls.length <= 1) return null
	return `${userCalls.length} calls`
}

/**
 * Returns dApp name for DAPP origin, null for UI/other.
 */
export function getOriginLabel(origin?: TxOrigin): string | null {
	if (!origin || origin.type !== OriginType.DAPP) return null
	return origin.name || "dApp"
}

/**
 * Formats a call for compact display: "Method on 0x1234..ab"
 */
export function formatCallSummary(method: string, contract: string): string {
	return `${humanizeMethodName(method)} on ${trimAddress(contract, 6, 4)}`
}

// TransferType enum values: Private=0, PrivateToPublic=1, Public=2, PublicToPrivate=3
const TRANSFER_TYPE_LABELS: Record<number | string, string> = {
	0: "Private → Private",
	1: "Private → Public",
	2: "Public → Public",
	3: "Public → Private",
	Private: "Private → Private",
	PrivateToPublic: "Private → Public",
	Public: "Public → Public",
	PublicToPrivate: "Public → Private",
}

/**
 * Returns a human-readable transfer type label.
 */
export function formatTransferType(type: number | string): string {
	return TRANSFER_TYPE_LABELS[type] ?? String(type)
}
