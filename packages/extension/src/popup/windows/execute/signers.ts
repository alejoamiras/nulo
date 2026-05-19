import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"

export interface OperationLike {
	account?: Account
	network: Network
}

/**
 * The unique signers (account, chain) referenced across an operation
 * list. Anti-phishing: identity strip MUST reflect the REAL signers
 * derived from the payload, not the popup's active account.
 */
export function uniqueSignerAccounts(operations: OperationLike[]): Account[] {
	const seen = new Set<string>()
	const out: Account[] = []
	for (const op of operations) {
		if (!op.account) continue
		const key = `${op.network.chainId}:${op.account.address}`
		if (seen.has(key)) continue
		seen.add(key)
		out.push(op.account)
	}
	return out
}

export function uniqueSignerNetworks(operations: OperationLike[]): Network[] {
	const seen = new Set<number>()
	const out: Network[] = []
	for (const op of operations) {
		if (seen.has(op.network.chainId)) continue
		seen.add(op.network.chainId)
		out.push(op.network)
	}
	return out
}
