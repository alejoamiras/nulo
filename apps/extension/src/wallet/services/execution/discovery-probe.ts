/**
 * `CollectingDiscoveryProbe` — the concrete `DiscoveryProbe` handed to folded
 * strategy runs. It owns the three fold-safety rules the measurement arc
 * pinned (single-sim-estimates B1):
 *
 * - **Chain-bound extraction**: the authwit message hash derives from the LIVE
 *   node's `getNodeInfo()`, fetched lazily ONLY when effects exist and
 *   asserted against the stored network identity first
 *   (`assertLiveChainIdentity` — F-012 / A-01 V-01, ledger #11). Byte-mirrors
 *   `AuthwitDiscoverer.discoverPrivateAuthwits`' effect loop.
 * - **First-sim-only**: a probe instance responds to exactly ONE extraction.
 *   The folded two-pass runs Pass 2 with the discovered witnesses attached —
 *   the Pass-2 sim re-emits the same `CallAuthorizationRequest`s (Noir emits
 *   them unconditionally; measured live), so a second extraction would
 *   double-splice.
 * - **Dedup**: within one extraction, identical message hashes collapse to one
 *   action, and hashes already covered by pre-attached actions are dropped
 *   (belt-and-braces — the F-4 guard upstream keeps pre-attached-authwit ops
 *   off the folded path entirely).
 *
 * The instance is per-estimate and stateful: `collected` is the executor's
 * bookkeeping surface (what discovery added), replacing the standalone
 * discovery sim's return value in the folded flow.
 */

import { CallAuthorizationRequest, computeAuthWitMessageHash } from "@aztec/aztec.js/authorization"
import { Fr } from "@aztec/foundation/curves/bn254"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import { collectOffchainEffects } from "@aztec/stdlib/tx"
import { assertLiveChainIdentity } from "@nulo/aztec-runtime/utils"
import type { DiscoveryProbe } from "./discovery-aware-estimator"
import type { FeeEstimate } from "./fee/fee-strategy"
import type { AddPrivateAuthwitAction } from "./spec"

/** Hash seams injectable for unit tests — the real ones run Barretenberg WASM
 *  (poseidon2), which is e2e-only. Production uses the module defaults. */
export interface DiscoveryProbeCrypto {
	fromFields(data: Fr[]): Promise<{ innerHash: Fr }>
	computeMessageHash(intent: { consumer: AztecAddress; innerHash: Fr }, chainInfo: { chainId: Fr; version: Fr }): Promise<Fr>
}

const realCrypto: DiscoveryProbeCrypto = {
	fromFields: (data) => CallAuthorizationRequest.fromFields(data),
	computeMessageHash: (intent, chainInfo) => computeAuthWitMessageHash(intent, chainInfo),
}

export class CollectingDiscoveryProbe implements DiscoveryProbe {
	/** Actions this probe's one extraction produced — executor bookkeeping. */
	public readonly collected: AddPrivateAuthwitAction[] = []
	private used = false

	public constructor(
		private readonly existingMessageHashes: ReadonlySet<string> = new Set(),
		private readonly crypto: DiscoveryProbeCrypto = realCrypto,
	) {}

	public async extractEffects(
		sim: unknown,
		ctx: { node: FeeEstimate["node"]; network: FeeEstimate["network"] },
	): Promise<AddPrivateAuthwitAction[]> {
		if (this.used) {
			return []
		}
		this.used = true

		const effects = collectOffchainEffects(
			(sim as { privateExecutionResult: Parameters<typeof collectOffchainEffects>[0] }).privateExecutionResult,
		)
		if (!effects.length) {
			return []
		}

		const nodeInfo = await ctx.node.getNodeInfo()
		assertLiveChainIdentity(ctx.network, nodeInfo)
		const chainInfo = { chainId: new Fr(nodeInfo.l1ChainId), version: new Fr(nodeInfo.rollupVersion) }

		const seen = new Set(this.existingMessageHashes)
		for (const effect of effects) {
			try {
				const authRequest = await this.crypto.fromFields(effect.data)
				const messageHash = await this.crypto.computeMessageHash(
					{ consumer: effect.contractAddress, innerHash: authRequest.innerHash },
					chainInfo,
				)
				const key = messageHash.toString()
				if (seen.has(key)) {
					continue
				}
				seen.add(key)
				this.collected.push({ kind: "add_private_authwit", content: { kind: "message_hash", messageHash: key } })
			} catch {
				// Effect is not a CallAuthorizationRequest — skip (discoverer-verbatim).
			}
		}
		return [...this.collected]
	}
}
