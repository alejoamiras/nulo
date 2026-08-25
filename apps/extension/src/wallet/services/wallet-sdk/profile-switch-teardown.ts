/**
 * Terminate live dApp channels that do not belong to the newly active
 * profile. Sessions are STAMP-matched (sessionId → owning profileId, minted
 * at establishment), not tuple-matched: a same-`(origin, chainId)` DappSession
 * row can legitimately exist under BOTH profiles, so tuple matching would keep
 * exactly the channels whose cross-profile continuity is the leak — the dApp
 * observing one unbroken encrypted channel across an identity switch.
 *
 * Unstamped sessions are terminated too (fail closed): within one SW lifetime
 * every legitimately established session is stamped before its validation
 * gate resolves, so an unstamped entry is establishment-in-flight debris or a
 * foreign artifact — the dispatch guard would reject it anyway; killing it
 * here just delivers the disconnect signal sooner.
 *
 * LOCK (profile → undefined) deliberately tears nothing down: the pinned
 * production semantics are per-call "Wallet is locked" errors over surviving
 * channels, and unlock-to-the-SAME-profile must find them intact. A key
 * exchange completing AFTER this listener ran is handled at establishment
 * (the approver-bound marker fail-closes a profile skew), not here.
 *
 * Same registration shape as `wireTabLifecycle`: side-effecting, deps-injected,
 * unit-testable without the SDK handler.
 */
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@nulo/wallet-core/logger"
import { getErrorMessage } from "@nulo/wallet-core/utils"

export interface ProfileSwitchTeardownDeps {
	onActiveProfileChanged: { add(listener: (profile: { id: string } | undefined) => void): unknown }
	getActiveSessions: () => Array<{ sessionId: string; origin: string }>
	sessionProfiles: Map<string, string>
	terminateSession: (sessionId: string) => void
	logger: ILogger
}

/**
 * The dispatch-side face of the same binding: a message may proceed ONLY when
 * the session's establishment stamp matches the active profile (map-miss =
 * fail closed). On mismatch the caller-provided respond runs FIRST (awaited —
 * terminating first would break sendResponse on the deleted session), then
 * the teardown, so the dApp gets both the error envelope and the standard
 * disconnect. Returns true when dispatch may proceed.
 */
export async function enforceSessionProfileBinding(args: {
	sessionId: string
	origin: string
	activeProfileId: string
	sessionProfiles: Map<string, string>
	respond: () => Promise<void>
	terminateSession: (sessionId: string) => void
	logger: ILogger
}): Promise<boolean> {
	const stamped = args.sessionProfiles.get(args.sessionId)
	if (stamped === args.activeProfileId) return true
	try {
		await args.respond()
	} catch {
		// The DISCONNECT below is the fallback signal.
	} finally {
		args.terminateSession(args.sessionId)
	}
	args.logger.log(
		"wallet-sdk",
		LogLevel.Warn,
		`Rejected message for ${args.origin}: session bound to ${stamped ?? "no"} profile, active is ${args.activeProfileId}`,
	)
	return false
}

/**
 * Stamp a session's owning profile with terminate-race compensation: the
 * switch-teardown can terminate a mid-validation session, and termination is
 * FINAL — so after setting, a dead session's stamp is pure leak and is
 * deleted again. Every interleaving converges: terminate-before-set (the
 * check catches it), terminate-after-set (`onSessionTerminated` deletes),
 * terminate-between (both delete, idempotent).
 */
export function stampSessionProfileGuarded(
	sessionProfiles: Map<string, string>,
	sessionId: string,
	profileId: string,
	isSessionLive: (sessionId: string) => boolean,
): void {
	sessionProfiles.set(sessionId, profileId)
	if (!isSessionLive(sessionId)) sessionProfiles.delete(sessionId)
}

export function wireProfileSwitchTeardown(deps: ProfileSwitchTeardownDeps): void {
	deps.onActiveProfileChanged.add((profile) => {
		if (!profile) return // lock — pinned semantics, no teardown
		for (const session of deps.getActiveSessions()) {
			const stamped = deps.sessionProfiles.get(session.sessionId)
			if (stamped === profile.id) continue
			deps.logger.log(
				"wallet-sdk-bg",
				LogLevel.Info,
				`Profile switch: terminating session ${session.sessionId} (${session.origin}) bound to ${stamped ?? "no"} profile`,
			)
			try {
				deps.terminateSession(session.sessionId)
			} catch (err) {
				// One failing teardown must not shield the remaining foreign
				// sessions; the dispatch guard fail-closes whatever survives.
				deps.logger.log(
					"wallet-sdk-bg",
					LogLevel.Warn,
					`Profile switch: failed to terminate ${session.sessionId}: ${getErrorMessage(err)}`,
				)
			}
		}
	})
}
