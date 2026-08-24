/**
 * The wallet-SDK `onSessionEstablished` handler, extracted from `background.ts` so
 * the security-critical verify path is unit-testable without the whole SW service
 * graph. See `session-established.test.ts` for the B-06 / B-13 pins.
 */
import type { Fr } from "@aztec/foundation/curves/bn254"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import type { ILogger } from "../../logger"
import { LogLevel } from "../../logger"
import { isPendingVerificationStale, type PendingVerificationEntry } from "./pending-verification"

/** The Nulo chain id derived from a session/discovery's `chainInfo` (chainId ^ version). */
export function chainInfoToChainId(obj: { chainInfo: { chainId: Fr | string; version: Fr | string } }): number {
	const raw = obj.chainInfo
	const chainId = typeof raw.chainId === "string" ? Number(BigInt(raw.chainId)) : Number(raw.chainId.toBigInt())
	const version = typeof raw.version === "string" ? Number(BigInt(raw.version)) : Number(raw.version.toBigInt())
	return (chainId ^ version) >>> 0
}

/** Deps for {@link handleSessionEstablished} — injected so the path is testable
 *  without the full SDK handler. */
export interface SessionEstablishedDeps {
	dappSessionService: {
		tryGetDappSessionByOriginAndChain(
			origin: string,
			chainId: string,
		): Promise<{ id: string; profileId: string; trustedVerification?: boolean } | undefined>
		setVerificationHash(sessionId: string, verificationHash: string): Promise<unknown>
	}
	terminateSession: (sessionId: string) => void
	pendingVerification: Map<string, PendingVerificationEntry>
	/** Bind the established transport session to the profile that owns it —
	 *  the dispatch guard and the switch-teardown listener consume this. */
	stampSessionProfile: (sessionId: string, profileId: string) => void
	logger: ILogger
}

/**
 * Handle an established wallet-SDK session: persist its verification hash for the
 * settings/reconnect view and, for a new or untrusted connection, open the verify
 * window carrying THIS session's own hash.
 *
 * B-06: the verify window receives `session.verificationHash` via its URL, so a
 * concurrent session for the same `(origin, chainId)` overwriting the shared
 * `DappSession` row can never make the window show the WRONG emojis at the
 * trust-decision point. B-13: the body is fail-closed — any failure to persist the
 * hash or open the verify window TERMINATES the session (it must never stay live
 * unverified), and the pending-verification marker is ALWAYS cleared in `finally`,
 * including the missing-row early return (the prior leak).
 *
 * Returns `true` when the session validated + established, `false` when it was
 * terminated. The caller gates message dispatch on this so a message can't ride a
 * session that is concurrently being torn down (B-13 race).
 */
export async function handleSessionEstablished(
	session: { origin: string; sessionId: string; verificationHash: string; chainInfo: { chainId: Fr | string; version: Fr | string } },
	deps: SessionEstablishedDeps,
): Promise<boolean> {
	const chainId = String(chainInfoToChainId(session))
	// The marker is keyed by the transport REQUEST id, which the upstream reuses
	// verbatim as the sessionId — so this session can only ever see its OWN
	// approval's marker (a concurrent same-tuple handshake or reconnect cannot
	// consume it). Read BEFORE any fallible await so `finally` always clears it —
	// including the missing-row early return that previously leaked (B-13).
	const marker = deps.pendingVerification.get(session.sessionId)
	const isNewConnection = marker !== undefined
	try {
		// A STALE marker is a DEAD approval: an approved handshake parked past
		// the freshness window must terminate, never soften into reconnect
		// semantics (that downgrade would let a parked A-era approval mint a
		// channel under whichever profile is active by the time it completes).
		if (marker && isPendingVerificationStale(marker)) {
			deps.logger.log(
				"wallet-sdk-bg",
				LogLevel.Warn,
				`Session established for ${session.origin} chain ${chainId} on a stale approval — terminating`,
			)
			deps.terminateSession(session.sessionId)
			return false
		}
		const dappSession = await deps.dappSessionService.tryGetDappSessionByOriginAndChain(session.origin, chainId)
		if (!dappSession) {
			// Revoked between approveDiscovery and key-exchange — terminate so the dApp
			// can't ride a stale approval into a live ActiveSession (F-006).
			deps.logger.log(
				"wallet-sdk-bg",
				LogLevel.Warn,
				`Session established for ${session.origin} chain ${chainId} but DappSession missing — terminating to honor revocation`,
			)
			deps.terminateSession(session.sessionId)
			return false
		}
		// The approving profile must be the validating one: a profile switch
		// between Allow and key-exchange completion otherwise re-resolves the
		// row under the NEW profile and would bind an old approval to it.
		if (marker && dappSession.profileId !== marker.profileId) {
			deps.logger.log(
				"wallet-sdk-bg",
				LogLevel.Warn,
				`Session established for ${session.origin} chain ${chainId} under profile ${dappSession.profileId} but approved under ${marker.profileId} — terminating`,
			)
			deps.terminateSession(session.sessionId)
			return false
		}
		// Persist for the settings/reconnect view (informational). The verify window
		// does NOT rely on this — it gets the per-session snapshot via its URL (B-06).
		await deps.dappSessionService.setVerificationHash(dappSession.id, session.verificationHash)
		// Bind the live channel to its owning profile — consumed by the dispatch
		// guard and the profile-switch teardown.
		deps.stampSessionProfile(session.sessionId, dappSession.profileId)

		const needsVerification = isNewConnection || !dappSession.trustedVerification
		if (needsVerification) {
			const win = await chrome.windows.create({
				type: "popup",
				url: chrome.runtime.getURL(
					`src/popup/index.html#/windows/verify?sessionId=${dappSession.id}&verificationHash=${encodeURIComponent(session.verificationHash)}&isReconnect=${!isNewConnection}`,
				),
				height: 800,
				width: 400,
			})
			if (!win?.id) throw new Error("verify window creation returned no window id")
		}
		return true
	} catch (err) {
		// Fail closed: a session whose verification couldn't be persisted or shown must
		// not stay live accepting messages unverified (B-13).
		deps.logger.log(
			"wallet-sdk-bg",
			LogLevel.Warn,
			`onSessionEstablished failed for ${session.origin} chain ${chainId} — terminating: ${getErrorMessage(err)}`,
		)
		deps.terminateSession(session.sessionId)
		return false
	} finally {
		if (isNewConnection) deps.pendingVerification.delete(session.sessionId)
	}
}
