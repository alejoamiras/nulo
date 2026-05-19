/**
 * CAIP (Chain-Agnostic Improvement Proposal) helpers used by the
 * wallet-sdk dispatcher.
 *
 * Narrowed to only the helpers dispatcher + scope-enforcement need. Kept
 * local so `@nulo/wallet-bridge` does not depend on any
 * extension-internal module. The full-featured `caip.ts` in
 * `@nulo/extension` remains the source of truth for the wallet-side
 * code; this file mirrors only the subset the bridge requires.
 *
 * `CaipChain` / `CaipAccount` template-literal types are defined locally
 * — they're just string patterns, no runtime.
 */

/** CAIP-2 chain identifier: `aztec:<chainId>`. */
export type CaipChain = `aztec:${number}`

/** CAIP-10 account identifier: `aztec:<chainId>:<address>`. */
export type CaipAccount = `${CaipChain}:${string}`

const AZTEC_NAMESPACE = "aztec" as const

/** Format a chainId into a CAIP-2 chain identifier. */
export function formatCaipChain(chainId: number): CaipChain {
	return `${AZTEC_NAMESPACE}:${chainId}` as CaipChain
}

/** Format a (chainId, address) pair into a CAIP-10 account identifier. */
export function formatCaipAccount(chainId: number, address: string): CaipAccount {
	return `${AZTEC_NAMESPACE}:${chainId}:${address}` as CaipAccount
}

/** Parse a CAIP-10 account identifier. Throws if any segment is wrong. */
export function parseCaipAccount(caip: string): { chainId: number; address: string } {
	const parts = caip.split(":")
	if (parts.length !== 3 || parts[0] !== AZTEC_NAMESPACE) {
		throw new Error(`Invalid CAIP account identifier: ${caip}`)
	}
	if (parts[1] === "") {
		throw new Error(`Invalid chainId in CAIP account identifier: ${caip}`)
	}
	const chainId = Number(parts[1])
	if (!Number.isFinite(chainId) || !Number.isInteger(chainId)) {
		throw new Error(`Invalid chainId in CAIP account identifier: ${caip}`)
	}
	const address = parts[2]
	if (!address) {
		throw new Error(`Missing address in CAIP account identifier: ${caip}`)
	}
	return { chainId, address }
}

/** Minimal structural shape of a NetworkService-like object. */
interface NetworksQuery<TNetwork> {
	getNetworks(chainId: number): Promise<TNetwork[]>
}

/**
 * Resolve a chainId to a single Network. The network model guarantees
 * exactly one Network per `(profileId, chainId)` pair, so picking the
 * first row is unambiguous. Throws when no network is configured for
 * the chainId.
 */
export async function resolveNetworkByChainId<TNetwork>(networkService: NetworksQuery<TNetwork>, chainId: number): Promise<TNetwork> {
	const networks = await networkService.getNetworks(chainId)
	if (networks.length === 0) {
		throw new Error(`No network configured for chainId ${chainId}`)
	}
	return networks[0]!
}
