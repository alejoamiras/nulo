import { feeJuiceAddress } from "@/wallet/utils/fee-juice"
import { getAuthRegistryAddress } from "@/wallet/utils/auth-registry"
import { seedsForChain } from "@/wallet/services/token/default-tokens"

export type KnownContract = { address: string; name: string }

/**
 * The contracts the permission window lists as "Nulo knows", addresses lower-cased. Names come only
 * from this table and the built-in token list: stored FPC rows are user-renamable and the token
 * store holds dApp-registered rows, so a name read from either could dress a contract up as one
 * Nulo vouches for.
 */
export function knownContracts(chainId: number, protocolFpcs: { sponsored: string; private: string }): KnownContract[] {
	const table: KnownContract[] = [
		{ address: feeJuiceAddress, name: "Fee Juice" },
		{ address: protocolFpcs.sponsored, name: "Sponsored fee payer" },
		{ address: protocolFpcs.private, name: "Private fee payer" },
		{ address: getAuthRegistryAddress().toString(), name: "Auth registry" },
		...seedsForChain(chainId).map((seed) => ({ address: seed.contract, name: seed.displayName })),
	]
	return table.map((entry) => ({ address: entry.address.toLowerCase(), name: entry.name }))
}
