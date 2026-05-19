/**
 * CAIP (Chain-Agnostic Improvement Proposal) helpers for the Aztec namespace.
 *
 * This module is the single source of truth for parsing and formatting
 * CAIP identifiers anywhere on the extension side (dispatcher, execute
 * window, verify window, capabilities window, connected-apps settings,
 * dapp-interaction service, fpc service, token-balance service, …). Do
 * NOT hand-roll the regex or `split(":")` parsing elsewhere — partial
 * validation drift is exactly what consolidating this module prevents.
 *
 * Spec reference: CAIP-2 chain id `aztec:<chainId>`; CAIP-10 account
 * identifier `aztec:<chainId>:<address>` where `address` is the hex
 * `AztecAddress`.
 */

import type { CaipAccount, CaipChain } from "@/wallet/services/dapp-interaction/spec"

/** Namespace segment shared by every CAIP string this wallet emits. */
export const AZTEC_NAMESPACE = "aztec" as const

/** Format a chainId into a CAIP-2 chain identifier (`aztec:<chainId>`). */
export function formatCaipChain(chainId: number): CaipChain {
	return `${AZTEC_NAMESPACE}:${chainId}` as CaipChain
}

/** Format a (chainId, address) pair into a CAIP-10 account identifier. */
export function formatCaipAccount(chainId: number, address: string): CaipAccount {
	return `${AZTEC_NAMESPACE}:${chainId}:${address}` as CaipAccount
}

/** Parse a CAIP-2 chain identifier. Throws if the shape or namespace is wrong. */
export function parseCaipChain(caip: string): { chainId: number } {
	const parts = caip.split(":")
	if (parts.length !== 2 || parts[0] !== AZTEC_NAMESPACE) {
		throw new Error(`Invalid CAIP chain identifier: ${caip}`)
	}
	// `Number("")` is 0, not NaN, so check the raw segment first.
	if (parts[1] === "") {
		throw new Error(`Invalid chainId in CAIP chain identifier: ${caip}`)
	}
	const chainId = Number(parts[1])
	if (!Number.isFinite(chainId) || !Number.isInteger(chainId)) {
		throw new Error(`Invalid chainId in CAIP chain identifier: ${caip}`)
	}
	return { chainId }
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

/** Minimal shape expected of a NetworkService-like object. Using the
 *  structural interface keeps this helper import-free relative to the
 *  service concrete type so it's callable from both SW and popup. */
interface NetworksQuery<TNetwork> {
	getNetworks(chainId: number): Promise<TNetwork[]>
}

/**
 * Resolve a chainId to a single `Network`. The network model guarantees
 * exactly one `Network` per `(profileId, chainId)`, so picking the first
 * row is unambiguous. Throws when no network is configured for the
 * chainId.
 */
export async function resolveNetworkByChainId<TNetwork>(networkService: NetworksQuery<TNetwork>, chainId: number): Promise<TNetwork> {
	const networks = await networkService.getNetworks(chainId)
	if (networks.length === 0) {
		throw new Error(`No network configured for chainId ${chainId}`)
	}
	return networks[0]!
}
