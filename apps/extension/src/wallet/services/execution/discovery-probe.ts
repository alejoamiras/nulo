/**
 * `CollectingDiscoveryProbe` — the concrete `DiscoveryProbe` handed to folded
 * strategy runs. It owns the three fold-safety rules:
 *
 * - **Chain-bound extraction**: the authwit message hash derives from the LIVE
 *   node's `getNodeInfo()`, fetched lazily ONLY when effects exist and
 *   checked against the stored network identity first (`liveChainInfo`). The
 *   decode loop is `decodeAuthwitEffects`, shared with the other discovery paths.
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

import { collectOffchainEffects } from "@aztec-labs/stdlib/tx"
import { liveChainInfo } from "@nulo/aztec-runtime/utils"
import type { DiscoveredAuthwit } from "@nulo/wallet-bridge"
import { type AuthwitDecodeCrypto, decodeAuthwitEffects } from "./decode-authwit-effects"
import type { DiscoveryProbe } from "./discovery-aware-estimator"
import type { FeeEstimate } from "./fee/fee-strategy"
import type { AddPrivateAuthwitAction } from "./spec"

export type { AuthwitDecodeCrypto as DiscoveryProbeCrypto } from "./decode-authwit-effects"

export class CollectingDiscoveryProbe implements DiscoveryProbe {
	/** Actions this probe's one extraction produced — executor bookkeeping. */
	public readonly collected: AddPrivateAuthwitAction[] = []
	/** The decoded authorization behind each collected action, same order. */
	public readonly discovered: DiscoveredAuthwit[] = []
	private used = false

	public constructor(
		private readonly existingMessageHashes: ReadonlySet<string> = new Set(),
		private readonly crypto?: AuthwitDecodeCrypto,
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
		const chainInfo = liveChainInfo(ctx.network, nodeInfo)

		const seen = new Set(this.existingMessageHashes)
		for (const { record } of await decodeAuthwitEffects(effects, chainInfo, this.crypto)) {
			if (seen.has(record.messageHash)) {
				continue
			}
			seen.add(record.messageHash)
			this.collected.push({ kind: "add_private_authwit", content: { kind: "message_hash", messageHash: record.messageHash } })
			this.discovered.push(record)
		}
		return [...this.collected]
	}
}
