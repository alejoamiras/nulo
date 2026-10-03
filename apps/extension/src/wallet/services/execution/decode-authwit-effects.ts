/**
 * The authwit decode loop all three discovery paths share (the standalone discoverer, the folded
 * probe, the NO_FROM send): each offchain effect that decodes as a `CallAuthorizationRequest` is
 * hashed over the given chain and recorded, in effect order; any effect that fails is skipped.
 * Callers keep their own early return for "no effects" above the live-chain fetch, and any dedupe.
 */

import { CallAuthorizationRequest, computeAuthWitMessageHash } from "@aztec-labs/aztec.js/authorization"
import type { ChainInfo } from "@aztec-labs/entrypoints/interfaces"
import type { Fr } from "@aztec-labs/foundation/curves/bn254"
import type { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import type { DiscoveredAuthwit } from "@nulo/wallet-bridge"
import { type DecodedAuthRequest, toDiscoveredAuthwit } from "./discovered-authwit"

/** The decode and hash seams; unit tests inject fakes so they run without Barretenberg. */
export interface AuthwitDecodeCrypto {
	fromFields(data: Fr[]): Promise<DecodedAuthRequest>
	computeMessageHash(intent: { consumer: AztecAddress; innerHash: Fr }, chainInfo: { chainId: Fr; version: Fr }): Promise<Fr>
}

const REAL_CRYPTO: AuthwitDecodeCrypto = {
	fromFields: (data) => CallAuthorizationRequest.fromFields(data),
	computeMessageHash: (intent, chainInfo) => computeAuthWitMessageHash(intent, chainInfo),
}

export async function decodeAuthwitEffects(
	effects: readonly { data: Fr[]; contractAddress: AztecAddress }[],
	chainInfo: ChainInfo,
	crypto: AuthwitDecodeCrypto = REAL_CRYPTO,
): Promise<{ record: DiscoveredAuthwit; messageHash: Fr }[]> {
	const decoded: { record: DiscoveredAuthwit; messageHash: Fr }[] = []
	for (const effect of effects) {
		try {
			const authRequest = await crypto.fromFields(effect.data)
			const messageHash = await crypto.computeMessageHash(
				{ consumer: effect.contractAddress, innerHash: authRequest.innerHash as Fr },
				chainInfo,
			)
			decoded.push({ record: toDiscoveredAuthwit(effect.contractAddress, authRequest, messageHash), messageHash })
		} catch {}
	}
	return decoded
}
