import type { PXE } from "@aztec/pxe/client/bundle"
import { PxeStaleAnchorError } from "@nulo/extension-messaging/errors"
import { errorMessageFromUnknown } from "@nulo/wallet-core/utils"

/**
 * The upstream diagnostics that mean "the PXE's anchor block and the node's chain disagree": the
 * node no longer knows the anchor's hash (a reorg, or nodes behind one endpoint disagreeing on
 * the tip — worded two ways, `Block hash … not found when resolving query` from world-state
 * queries and `Reference block … not found when querying contract` from contract lookups, both
 * ending in the same clause), the anchor header was never written, or a private-state cursor sits
 * ahead of the anchor. All cross the offscreen boundary as message text only, and the node's
 * arrives inside an `AggregateError` whose message concatenates its members — hence substrings.
 * `stale-anchor.sources.test.ts` pins the strings that live in installed packages.
 */
export function isStaleAnchorMessage(message: string): boolean {
	return (
		message.includes("possibly a reorg has occurred") ||
		message.includes("not-yet-synchronized PXE") ||
		message.includes("RewindableRegister write originates behind")
	)
}

/**
 * Run `op` once; on a stale-anchor failure resync the PXE and run it exactly once more. A second
 * stale failure — from the retried `op`, or from `sync()` itself failing stale-shaped — becomes
 * `PxeStaleAnchorError` with a constant, wallet-authored message (the upstream text rides
 * `details.cause`, which stops at the operation-result boundary). Any non-stale failure, from `op`
 * or from `sync()`, propagates unchanged, so the balance queue's transient path and the client's
 * key recovery never see a stale error dressed as something else.
 *
 * Must run under the chain write guard the op already holds: the retry then re-executes against
 * the resynced anchor with no other write interleaved.
 */
export async function withStaleAnchorRetry<T>(
	label: string,
	pxe: Pick<PXE, "sync">,
	op: () => Promise<T>,
	log: (line: string) => void,
): Promise<T> {
	try {
		return await op()
	} catch (firstErr) {
		const firstMessage = errorMessageFromUnknown(firstErr)
		if (!isStaleAnchorMessage(firstMessage)) throw firstErr
		try {
			await pxe.sync()
		} catch (syncErr) {
			const syncMessage = errorMessageFromUnknown(syncErr)
			if (!isStaleAnchorMessage(syncMessage)) throw syncErr
			throw staleAnchorError(label, "sync", syncMessage)
		}
		log(`${label}: stale anchor on first attempt — resynced, retrying once`)
		try {
			return await op()
		} catch (secondErr) {
			const secondMessage = errorMessageFromUnknown(secondErr)
			if (!isStaleAnchorMessage(secondMessage)) throw secondErr
			throw staleAnchorError(label, "op", secondMessage)
		}
	}
}

function staleAnchorError(label: string, phase: "sync" | "op", cause: string): PxeStaleAnchorError {
	return new PxeStaleAnchorError(`${label}: stale chain anchor persisted after a resync`, { op: label, phase, cause })
}
