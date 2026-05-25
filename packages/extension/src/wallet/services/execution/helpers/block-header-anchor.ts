/**
 * Block-header anchor used by both fast paths (`fast-path.ts:runFastPath`
 * for dApp `aztec_simulateTx`, and `batched-view-simulation.ts` for
 * internal view reads) when calling `simulateViaNode` against the chain
 * node directly.
 *
 * Mirrors upstream `BaseWallet.simulateTx`: prefer PXE's synced header so
 * a parallel slow arm using `pxe.simulateTx` (which anchors at PXE's
 * internal sync state) observes roughly the same chain block. Falls back
 * to `node.getBlockHeader()` if PXE is not yet synced. Returns
 * `undefined` on double-failure so callers can treat "no anchor" as a
 * uniform "fall back to standard path" signal instead of branching on
 * thrown error types.
 *
 * Note that even with the same anchor, the slow arm has no way to pin
 * `pxe.simulateTx` to a specific block — it uses live PXE state. Inter-
 * arm chain-state skew is therefore best-effort, not atomic.
 */
import type { BlockHeader } from "@aztec/stdlib/tx"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { IPXE } from "@nulo/aztec-runtime/pxe"

export async function getBlockHeaderAnchor(pxe: IPXE, node: AztecNode): Promise<BlockHeader | undefined> {
	try {
		return await pxe.getSyncedBlockHeader()
	} catch {
		try {
			return (await node.getBlockHeader()) ?? undefined
		} catch {
			return undefined
		}
	}
}
