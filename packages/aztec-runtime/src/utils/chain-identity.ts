/**
 * Live-node chain identity verification.
 *
 * The wallet trusts `node.getNodeInfo()` for `(l1ChainId, rollupVersion)` at every
 * signing/proving boundary. A malicious or drifted RPC endpoint could otherwise change
 * the chain context after enrollment and have the account sign against a chain the user
 * never selected. `assertLiveChainIdentity` compares the live pair to the stored network
 * and throws on any drift; apply it at every site that has BOTH the stored network AND
 * the live node response in scope, before `chainInfoFrom`.
 *
 * NOT applied inside `nulo-account.ts:buildTxExecutionRequest` (no network in scope) —
 * every caller of that method asserts first.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import type { ChainInfo } from "@aztec/entrypoints/interfaces"
import { assertCanonicalL1ChainId } from "@nulo/wallet-crypto"

export interface LiveNodeChainInfo {
	l1ChainId: number
	rollupVersion: number
}

/** The stored network's identity: the XOR composite used for storage scoping (`0` for
 *  local networks) AND the exact L1 chain id written at enrollment. */
export interface SelectedNetworkChainInfo {
	chainId: number
	l1ChainId: number
}

const U32_MAX = 0xffffffff

/**
 * Throws if the live node's chain identity drifts from the network the user selected.
 *
 * Both live values must be canonical unsigned 32-bit integers: the composite is
 * `(l1ChainId ^ rollupVersion) >>> 0`, so without the range bound a `rollupVersion` that
 * differs only above bit 32 (e.g. `4248422647` vs `8543389943`) collides with the stored
 * value. Within u32, XOR with the pinned `l1ChainId` is a bijection, so exact-L1 equality
 * plus the composite pins `rollupVersion` exactly.
 *
 * Local networks store `chainId === 0` (no composite to compare — the loopback URL
 * allowlist is the substitute defense for the rollup half); the exact `l1ChainId` check
 * still runs against the stored row, which carries the seeded or probed local value.
 */
export function assertLiveChainIdentity(network: SelectedNetworkChainInfo, nodeInfo: LiveNodeChainInfo): void {
	assertCanonicalL1ChainId(nodeInfo.l1ChainId)
	if (!Number.isSafeInteger(nodeInfo.rollupVersion) || nodeInfo.rollupVersion < 0 || nodeInfo.rollupVersion > U32_MAX) {
		throw new Error(
			`Chain identity mismatch: live node reports non-canonical rollupVersion=${nodeInfo.rollupVersion}. Refusing to sign/prove against a drifted endpoint.`,
		)
	}
	if (nodeInfo.l1ChainId !== network.l1ChainId) {
		throw new Error(
			`Chain identity mismatch: selected network has l1ChainId=${network.l1ChainId} but live node reports l1ChainId=${nodeInfo.l1ChainId} (rollupVersion=${nodeInfo.rollupVersion}). Refusing to sign/prove against a drifted endpoint.`,
		)
	}
	if (network.chainId === 0) return
	const liveComposite = (nodeInfo.l1ChainId ^ nodeInfo.rollupVersion) >>> 0
	if (network.chainId !== liveComposite) {
		throw new Error(
			`Chain identity mismatch: selected network has chainId=${network.chainId} but live node reports composite=${liveComposite} (l1ChainId=${nodeInfo.l1ChainId}, rollupVersion=${nodeInfo.rollupVersion}). Refusing to sign/prove against a drifted endpoint.`,
		)
	}
}

/**
 * Build the `ChainInfo` (Fr-encoded `l1ChainId` + `rollupVersion`) that the
 * account entrypoint commits to, from a live node's raw identity. On the
 * signing path the caller MUST pass a `nodeInfo` already checked with
 * `assertLiveChainIdentity`; this helper performs no validation itself.
 */
export function chainInfoFrom(nodeInfo: LiveNodeChainInfo): ChainInfo {
	return { chainId: new Fr(nodeInfo.l1ChainId), version: new Fr(nodeInfo.rollupVersion) }
}
