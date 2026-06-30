/**
 * CAIP (Chain-Agnostic Improvement Proposal) helpers for the Aztec namespace.
 *
 * The format / parse-account / network-resolve helpers are single-owned by
 * `@nulo/wallet-bridge` (ownership flows downward only — package registry #15)
 * and re-exported here so the established `@/wallet/utils/caip` import site keeps
 * working everywhere on the extension side (dispatcher, execute / verify /
 * capabilities windows, connected-apps settings, dapp-interaction + fpc
 * services, queued journal). Do NOT hand-roll the regex or `split(":")` parsing
 * elsewhere — partial validation drift is exactly what this single owner
 * prevents.
 *
 * `parseCaipChain` (CAIP-2) has no bridge counterpart, so it stays local along
 * with the `AZTEC_NAMESPACE` const it validates against. The parity test pins
 * that the re-exports remain the bridge's own implementation.
 *
 * Spec reference: CAIP-2 chain id `aztec:<chainId>`; CAIP-10 account
 * identifier `aztec:<chainId>:<address>` where `address` is the hex
 * `AztecAddress`.
 */

export { formatCaipAccount, formatCaipChain, parseCaipAccount, resolveNetworkByChainId } from "@nulo/wallet-bridge"

/** Namespace segment shared by every CAIP string this wallet emits. */
export const AZTEC_NAMESPACE = "aztec" as const

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
