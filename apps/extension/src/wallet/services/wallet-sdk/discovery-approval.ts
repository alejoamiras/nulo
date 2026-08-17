import type { PendingDiscovery } from "@aztec/wallet-sdk/extension/handlers"
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
 * the just-created session is deleted, no verification is scheduled, and the
 * discovery is rejected — we never leave behind an approved-but-unreachable
 * (nor, worse, an unverified-yet-live) session for a dApp that has stopped
 * listening.
 *
 * @returns `true` iff the discovery was approved; `false` on rollback.
 */
export async function approveOrRollbackDiscoverySession(args: {
	discovery: PendingDiscovery
	sessionId: string
	dedupeKey: string
	approveDiscovery: (requestId: string) => void
	rejectDiscovery: (requestId: string) => void
	deleteSession: (sessionId: string) => Promise<unknown>
	pendingVerification: Set<string>
	logger: ILogger
}): Promise<boolean> {
	const { discovery, sessionId, dedupeKey, approveDiscovery, rejectDiscovery, deleteSession, pendingVerification, logger } = args

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

	pendingVerification.add(dedupeKey)
	approveDiscovery(discovery.requestId)
	return true
}
