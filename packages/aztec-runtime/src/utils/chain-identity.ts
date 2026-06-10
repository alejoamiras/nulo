/**
 * F-012 / Phase 5: live-node chain identity verification.
 *
 * Pre-fix, the wallet trusted `node.getNodeInfo()` for `(l1ChainId,
 * rollupVersion)` at every signing/proving boundary without comparing
 * to the stored network identity. A malicious or drifted RPC endpoint
 * could change the chain context after enrollment, signing transactions
 * against a chain the user didn't select.
 *
 * Audit ref (Round 2 codex B-4): "Phase 6's F-012 plan is incomplete...
 * nulo-account.ts:92-103 has no selected-network identity to compare
 * against." The fix is a shared helper called at call sites that have
 * BOTH the stored networkInfo AND the live nodeInfo.
 *
 * `assertLiveChainIdentity` compares the two and throws if they differ.
 * Apply at every site that consumes `node.getNodeInfo()` for signing or
 * proving — sites like `tx-request-builder` that have `networkService.getNetwork()`
 * in scope plus the live node response.
 *
 * NOT applied at:
 * - `nulo-account.ts:buildTxExecutionRequest` — no `networkInfo` parameter
 *   in scope. Would require an interface change (deferred follow-up).
 * - Read-only / metadata paths where chain identity isn't trust-load-bearing.
 */

export interface LiveNodeChainInfo {
	l1ChainId: number
	rollupVersion: number
}

export interface SelectedNetworkChainInfo {
	chainId: number
}

/**
 * Throws if the live node's chain identity drifts from the network the
 * user explicitly selected.
 *
 * The stored `chainId` is `(l1ChainId XOR rollupVersion) >>> 0` for
 * non-local networks, and `0` for local networks (where the trust
 * substitute is the loopback-only RPC scheme allowlist in
 * `network/spec.ts`). The expected live-node value is therefore the
 * same XOR; we compute it from `nodeInfo.l1ChainId ^ rollupVersion` and
 * compare against the stored value.
 *
 * Local networks (stored `chainId === 0`) skip the check because the
 * stored value carries no identity information to compare against —
 * the loopback URL allowlist is the substitute defense for local.
 */
export function assertLiveChainIdentity(network: SelectedNetworkChainInfo, nodeInfo: LiveNodeChainInfo): void {
	if (network.chainId === 0) return
	const liveComposite = (nodeInfo.l1ChainId ^ nodeInfo.rollupVersion) >>> 0
	if (network.chainId !== liveComposite) {
		throw new Error(
			`Chain identity mismatch: selected network has chainId=${network.chainId} but live node reports composite=${liveComposite} (l1ChainId=${nodeInfo.l1ChainId}, rollupVersion=${nodeInfo.rollupVersion}). Refusing to sign/prove against a drifted endpoint.`,
		)
	}
}
