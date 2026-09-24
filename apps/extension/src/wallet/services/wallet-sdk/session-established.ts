/**
 * The wallet-SDK `onSessionEstablished` handler, extracted from `background.ts` so
 * the security-critical verify path is unit-testable without the whole SW service
 * graph. See `session-established.test.ts` for the B-06 / B-13 pins.
 */
import type { Fr } from "@aztec/foundation/curves/bn254"
import type { WindowPort } from "@nulo/wallet-core/ports"
import type { ILogger } from "../../logger"
import { LogLevel } from "../../logger"
import { createPlaced, topRightOf } from "../window-manager/window-manager"
import { isPendingVerificationStale, type PendingVerificationEntry } from "./pending-verification"
import type { WindowReservation } from "./verify-admission"
import { describeExternalId } from "@nulo/wallet-bridge"

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
	/** Whether the transport session is still in the handler's active set — a
	 *  switch-teardown can terminate a mid-validation session, and stamping a
	 *  dead one would leak a `sessionProfiles` entry and pop a verify window
	 *  for a closed channel. */
	isSessionLive: (sessionId: string) => boolean
	pendingVerification: Map<string, PendingVerificationEntry>
	/** Bind the established transport session to the profile that owns it —
	 *  the dispatch guard and the switch-teardown listener consume this. */
	stampSessionProfile: (sessionId: string, profileId: string) => void
	/** The port the verify window is created on; its `onRemoved` is what frees the slot. */
	windows: Pick<WindowPort, "create" | "remove" | "getLastFocused">
	/** The verify-window slot admission reserved for this session id, if the handshake needed one. */
	reservations: { reservation(sessionId: string): WindowReservation | undefined }
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
	const reservation = deps.reservations.reservation(session.sessionId)
	const terminateWith = (message: string): false => {
		deps.logger.log("wallet-sdk-bg", LogLevel.Warn, message)
		deps.terminateSession(session.sessionId)
		return false
	}
	try {
		// A STALE marker is a DEAD approval: an approved handshake parked past
		// the freshness window must terminate, never soften into reconnect
		// semantics (that downgrade would let a parked A-era approval mint a
		// channel under whichever profile is active by the time it completes).
		// The terminate costs the dApp ONE round trip, not the approval — the
		// DappSession row survives and upstream restores an approved discovery,
		// so a re-handshake lands in the marker-less branch below. The
		// cross-profile floors there are the live-profile row lookup and the
		// `!trustedVerification` gate; the 90 s TTL is NOT a security boundary
		// and nothing may lean on it as one.
		if (marker && isPendingVerificationStale(marker)) {
			return terminateWith(
				`Session ${describeExternalId(session.sessionId)} established on chain ${chainId} on a stale approval — terminating`,
			)
		}
		const dappSession = await deps.dappSessionService.tryGetDappSessionByOriginAndChain(session.origin, chainId)
		if (!dappSession) {
			// Revoked between approveDiscovery and key-exchange — terminate so the dApp
			// can't ride a stale approval into a live ActiveSession (F-006).
			return terminateWith(
				`Session ${describeExternalId(session.sessionId)} on chain ${chainId} has no DappSession — terminating to honor revocation`,
			)
		}
		// The approving profile must be the validating one: a profile switch
		// between Allow and key-exchange completion otherwise re-resolves the
		// row under the NEW profile and would bind an old approval to it.
		if (marker && dappSession.profileId !== marker.profileId) {
			return terminateWith(
				`Session ${describeExternalId(session.sessionId)} on chain ${chainId} runs under profile ${dappSession.profileId} but was approved under ${marker.profileId} — terminating`,
			)
		}
		// Upstream inserts into `activeSessions` BEFORE this handler runs, so a
		// profile-switch teardown can have terminated this session mid-validation.
		// Establishing a dead channel would leak its stamp and pop a verify window
		// for nothing. The residual window between this check and the stamp is
		// benign: upstream delivers no messages for a deleted session and the
		// dispatch guard fails closed on the leftover stamp.
		if (!deps.isSessionLive(session.sessionId)) {
			deps.logger.log(
				"wallet-sdk-bg",
				LogLevel.Warn,
				`Session ${describeExternalId(session.sessionId)} terminated during validation — skipping establishment`,
			)
			return false
		}
		// Persist for the settings/reconnect view (informational). The verify window
		// does NOT rely on this — it gets the per-session snapshot via its URL (B-06).
		await deps.dappSessionService.setVerificationHash(dappSession.id, session.verificationHash)
		// Second liveness gate: the await above is itself a window the
		// switch-teardown can land in — a session confirmed dead here must not
		// be stamped and must not pop a verify window. (The stamp wiring also
		// self-compensates; see `stampSessionProfileGuarded`.)
		if (!deps.isSessionLive(session.sessionId)) {
			deps.logger.log(
				"wallet-sdk-bg",
				LogLevel.Warn,
				`Session ${describeExternalId(session.sessionId)} terminated during establishment — not stamping`,
			)
			return false
		}
		// Bind the live channel to its owning profile — consumed by the dispatch
		// guard and the profile-switch teardown.
		deps.stampSessionProfile(session.sessionId, dappSession.profileId)

		const needsVerification = isNewConnection || !dappSession.trustedVerification
		if (needsVerification) {
			// A window without a reserved slot would be one the origin's budget never counted:
			// admission at discovery is the only place the cap is enforced, so fail closed.
			if (!reservation) throw new Error("verify window has no reserved slot")
			await openVerifyWindow(session, dappSession.id, isNewConnection, reservation, deps)
		}
		return true
	} catch (err) {
		// Fail closed: a session whose verification couldn't be persisted or shown must
		// not stay live accepting messages unverified (B-13).
		deps.logger.log(
			"wallet-sdk-bg",
			LogLevel.Warn,
			`onSessionEstablished failed for session ${describeExternalId(session.sessionId)} on chain ${chainId} — terminating`,
			err,
		)
		deps.terminateSession(session.sessionId)
		return false
	} finally {
		if (isNewConnection) deps.pendingVerification.delete(session.sessionId)
		// Every exit that opened no window gives the slot back; an issued creation keeps it.
		reservation?.releaseIfUnstarted()
	}
}

/** Open the verify window against its reservation. The slot is held from the moment `create` is
 *  issued: a termination that lands mid-creation cancels the attempt, and the window that then
 *  arrives is closed instead of adopted (releasing earlier would let a replacement open first). */
async function openVerifyWindow(
	session: { sessionId: string; verificationHash: string },
	dappSessionId: string,
	isNewConnection: boolean,
	reservation: WindowReservation,
	deps: SessionEstablishedDeps,
): Promise<void> {
	const anchor = await deps.windows.getLastFocused()
	// Claim the slot for exactly one creation: a reservation released or already spent while this
	// handler awaited must not open a second window against the same slot.
	if (!reservation.markInFlight()) throw new Error("verify window slot was not claimable")
	let windowId: number | undefined
	try {
		// Hold the reservation across both attempts; release only after the terminal failure or the
		// window's removal.
		const win = await createPlaced(
			deps.windows,
			{
				type: "popup",
				url: chrome.runtime.getURL(
					`src/popup/index.html#/windows/verify?sessionId=${dappSessionId}&verificationHash=${encodeURIComponent(session.verificationHash)}&isReconnect=${!isNewConnection}`,
				),
				width: 400,
				...topRightOf(anchor, 400, 800),
			},
			() => deps.isSessionLive(session.sessionId),
			deps.logger,
			"wallet-sdk-bg",
		)
		windowId = win?.id
	} catch {
		reservation.creationFailed()
		throw new Error("verify window could not be opened")
	}
	if (windowId === undefined) {
		reservation.creationFailed()
		throw new Error("verify window creation returned no window id")
	}
	if (reservation.adopt(windowId) === "abort") {
		// The session ended (or the window closed) while this was opening: close the window we got.
		// Its slot is released when `onRemoved` fires for this id — either from the close below, or
		// (if the window had already closed) when the reservation adopted and drained the buffered
		// removal.
		await deps.windows.remove(windowId).catch(() => undefined)
		throw new Error("session ended while its verify window was opening")
	}
}
