import type { PendingDiscovery } from "@aztec/wallet-sdk/extension/handlers"
import type { PendingVerificationEntry } from "./pending-verification"
import { isDiscoveryExpired } from "@nulo/wallet-bridge"
import { type ILogger, LogLevel } from "@nulo/wallet-core/logger"

/**
 * Finalize a new-dApp discovery once its session has been persisted: approve
 * it, or roll it back.
 *
 * The durable writes that create the session (addDappSession +
 * setCapabilityGrants) can themselves cross the dApp's discovery window —
 * storage contention, service-worker suspension, or the machine sleeping mid
 * `await`. So freshness is re-checked HERE, immediately before the approval,
 * NOT only at the popup boundary. If the discovery expired during those writes
 * the just-created session is deleted (best effort — a genuine storage failure
 * can still leave the row, but approval fails closed regardless), no
 * verification is scheduled, and the discovery is rejected — so an
 * approved-but-unreachable, or unverified-yet-live, session is not handed to a
 * dApp that has stopped listening.
 *
 * @returns `true` iff the discovery was approved; `false` on rollback or when
 *   the SDK reports the approval did not land (the request was already gone).
 */
export async function approveOrRollbackDiscoverySession(args: {
	discovery: PendingDiscovery
	sessionId: string
	/** The profile whose DappSession row this approval created — bound into the
	 *  marker so establishment can fail-close an approve/validate profile skew. */
	approverProfileId: string
	approveDiscovery: (requestId: string) => boolean
	rejectDiscovery: (requestId: string) => void
	deleteSession: (sessionId: string) => Promise<unknown>
	pendingVerification: Map<string, PendingVerificationEntry>
	logger: ILogger
}): Promise<boolean> {
	const { discovery, sessionId, approverProfileId, approveDiscovery, rejectDiscovery, deleteSession, pendingVerification, logger } = args

	if (isDiscoveryExpired(discovery)) {
		try {
			await deleteSession(sessionId)
		} catch (rollbackError) {
			// A concurrent disconnect may have already removed the row — the
			// rejection below still stands, so swallow and log.
			logger.log(
				"wallet-sdk",
				LogLevel.Warn,
				`Failed to roll back expired discovery session ${sessionId}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
			)
		}
		rejectDiscovery(discovery.requestId)
		logger.log("wallet-sdk", LogLevel.Warn, `Discovery rejected (expired during session creation): ${discovery.origin}`)
		return false
	}

	// Schedule verification before approving so onSessionEstablished can find
	// the entry, keyed by the REQUEST id (which the upstream reuses as the
	// sessionId) so concurrent same-tuple handshakes can never consume each
	// other's markers. If the SDK reports the approval didn't land (the request
	// was already gone) undo it — a leaked entry would otherwise persist for
	// the SW's lifetime.
	pendingVerification.set(discovery.requestId, { at: Date.now(), profileId: approverProfileId, tabId: discovery.tabId })
	if (!approveDiscovery(discovery.requestId)) {
		pendingVerification.delete(discovery.requestId)
		logger.log("wallet-sdk", LogLevel.Warn, `Discovery approve did not land (already gone): ${discovery.origin}`)
		return false
	}
	return true
}
