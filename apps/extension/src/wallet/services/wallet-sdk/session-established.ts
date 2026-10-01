/**
 * The wallet-SDK `onSessionEstablished` handler, extracted from `background.ts` so
 * the security-critical verify path is unit-testable without the whole SW service
 * graph. See `session-established.test.ts` for the B-06 / B-13 pins.
 */
import type { Fr } from "@aztec-labs/foundation/curves/bn254"
import type { WindowPort } from "@nulo/wallet-core/ports"
import type { ILogger } from "../../logger"
import { LogLevel } from "../../logger"
import { createPlaced, topRightOf } from "../window-manager/window-manager"
import { isPendingVerificationDead, type PendingVerificationEntry, settlePendingVerification } from "./pending-verification"
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
	/** The port the check is shown on; a window's `onRemoved` is what frees its slot. */
	windows: Pick<WindowPort, "create" | "remove" | "getLastFocused" | "navigate" | "update">
	/** The verify-window slot admission reserved for this session id, if the handshake needed one. */
	reservations: { reservation(sessionId: string): WindowReservation | undefined }
	logger: ILogger
}

/** The emoji check's page for one session. Its grid is drawn from `verificationHash` as given here,
 *  never read back from the shared row. */
export function verifyWindowUrl(dappSessionId: string, verificationHash: string, isReconnect: boolean): string {
	return chrome.runtime.getURL(
		`src/popup/index.html#/windows/verify?sessionId=${dappSessionId}&verificationHash=${encodeURIComponent(verificationHash)}&isReconnect=${isReconnect}`,
	)
}

/**
 * Handle an established wallet-SDK session: persist its verification hash for the settings and
 * reconnect views and, for a new or untrusted connection, show the emoji check.
 *
 * The check's grid comes from this session's own hash in the window URL, never from the shared
 * row a concurrent session for the same `(origin, chainId)` can overwrite (B-06). A session whose
 * hash could not be persisted or whose check could not be shown is terminated and resolves
 * `false`, and the caller dispatches no message before this resolves `true` (B-13).
 */
export async function handleSessionEstablished(
	session: { origin: string; sessionId: string; verificationHash: string; chainInfo: { chainId: Fr | string; version: Fr | string } },
	deps: SessionEstablishedDeps,
): Promise<boolean> {
	const chainId = String(chainInfoToChainId(session))
	// The marker is keyed by the transport REQUEST id, which the upstream reuses
	// verbatim as the sessionId — so this session can only ever see its OWN
	// approval's marker (a concurrent same-tuple handshake or reconnect cannot
	// consume it). Read BEFORE any fallible await so `finally` settles it on every exit.
	const marker = deps.pendingVerification.get(session.sessionId)
	const isNewConnection = marker !== undefined
	const reservation = deps.reservations.reservation(session.sessionId)
	const terminateWith = (message: string): false => {
		deps.logger.log("wallet-sdk-bg", LogLevel.Warn, message)
		deps.terminateSession(session.sessionId)
		return false
	}
	let established = false
	try {
		// A DEAD marker (cancelled, or stale: a parked approval that would mint a channel under
		// whichever profile is active when it completes) is a dead approval and never softens into a
		// reconnect.
		if (marker && isPendingVerificationDead(marker)) {
			return terminateWith(
				`Session ${describeExternalId(session.sessionId)} established on chain ${chainId} on an abandoned or stale approval — terminating`,
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
			const url = verifyWindowUrl(dappSession.id, session.verificationHash, !isNewConnection)
			await showVerifyWindow(url, session.sessionId, reservation, deps)
		}
		established = true
		return true
	} catch (err) {
		// Fail closed: a session whose hash couldn't be persisted or whose check couldn't be shown
		// must not stay live accepting messages (B-13).
		deps.logger.log(
			"wallet-sdk-bg",
			LogLevel.Warn,
			`onSessionEstablished failed for session ${describeExternalId(session.sessionId)} on chain ${chainId} — terminating`,
			err,
		)
		deps.terminateSession(session.sessionId)
		return false
	} finally {
		// A failed exit leaves a tombstone: the SDK restores the discovery, and a marker-less retry of
		// this id would pass as a reconnect, which skips the check on a row since marked trusted.
		if (isNewConnection) settlePendingVerification(deps.pendingVerification, session.sessionId, established)
		// Every exit that opened no window gives the slot back; an issued creation keeps it.
		reservation?.releaseIfUnstarted()
	}
}

function showVerifyWindow(url: string, sessionId: string, reservation: WindowReservation, deps: SessionEstablishedDeps): Promise<void> {
	const standby = reservation.claimStandby()
	return standby === undefined
		? openVerifyWindow(url, sessionId, reservation, deps)
		: showVerifyInConnectWindow(url, standby, reservation, deps)
}

/** Load the check in the claimed connect window. A failed navigation adopts the window before
 *  closing it, so the slot frees on its removal and never while the window still shows. */
async function showVerifyInConnectWindow(
	url: string,
	windowId: number,
	reservation: WindowReservation,
	deps: SessionEstablishedDeps,
): Promise<void> {
	// The browser's rejection can carry the URL, and with it the hash and the row id: it is dropped
	// here so no log line or error ever holds it.
	const shown = await deps.windows.navigate(windowId, url).then(
		() => true,
		() => false,
	)
	if (reservation.adopt(windowId) === "abort" || !shown) {
		await deps.windows.remove(windowId).catch(() => undefined)
		throw new Error(shown ? "session ended while its verify window was loading" : "verify window could not be shown")
	}
	void deps.windows.update(windowId, { focused: true }).catch(() => undefined)
}

/** Open the verify window against its reservation. The slot is held from the moment `create` is
 *  issued: a termination that lands mid-creation cancels the attempt, and the window that then
 *  arrives is closed instead of adopted (releasing earlier would let a replacement open first). */
async function openVerifyWindow(
	url: string,
	sessionId: string,
	reservation: WindowReservation,
	deps: SessionEstablishedDeps,
): Promise<void> {
	const anchor = await deps.windows.getLastFocused()
	// Claim the slot for exactly one window: a reservation released or already spent while this
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
				url,
				width: 400,
				...topRightOf(anchor, 400, 800),
			},
			() => deps.isSessionLive(sessionId),
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
