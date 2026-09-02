/**
 * Decision core for the popup's boot-time session check (`loadProfile` in app.vue): the profile
 * list, the active-session read and the activation bootstrap, each through the transport backoff,
 * folded into ONE result the shell applies. Pure over injected reads so every outcome — including
 * the ones only a service-worker restart produces — is unit-testable without mounting the shell.
 *
 * Every await is followed by an `isCurrent()` check: mount and each background reconnect start a
 * run, and a run that awaited past a newer one must commit nothing (`superseded`).
 */

import { lookupActiveProfileWithBackoff } from "./auth-guard"

export interface BootSessionDeps<P extends { id: string }> {
	getProfiles: () => Promise<P[]>
	getActiveProfile: () => Promise<P | undefined>
	/** The activation bootstrap; resolves whether the session survived it. */
	bootstrap: (profile: P) => Promise<boolean>
	lastActiveProfileId: () => Promise<string | undefined>
	/** False once a newer run started. */
	isCurrent: () => boolean
	/** Overall bound per service read; see `lookupActiveProfileWithBackoff`. */
	deadlineMs?: number
}

export type BootSessionResult<P> =
	/** A newer run superseded this one; nothing may be applied. */
	| { kind: "superseded" }
	/** The service stayed unreachable across the backoff. `candidate` is the lock screen's
	 *  profile when the list was readable (so the password path stays reachable); undefined
	 *  when even the list was not. */
	| { kind: "unreachable"; profiles: P[]; candidate: P | undefined }
	/** A clean lock: no open session. `candidate` = the last active profile, else the first. */
	| { kind: "locked"; profiles: P[]; candidate: P | undefined }
	/** An OPEN session whose activation bootstrap threw — not a lock; re-entering a password
	 *  cannot repair it. The shell offers a retry. */
	| { kind: "failed"; profiles: P[]; profile: P }
	| { kind: "active"; profiles: P[]; profile: P; stillActive: boolean }

export async function resolveBootSession<P extends { id: string }>(deps: BootSessionDeps<P>): Promise<BootSessionResult<P>> {
	const opts = { deadlineMs: deps.deadlineMs }
	const list = await lookupActiveProfileWithBackoff(deps.getProfiles, opts)
	if (!deps.isCurrent()) return { kind: "superseded" }
	if (list.kind === "unreachable") return { kind: "unreachable", profiles: [], candidate: undefined }
	// An empty list is a value (register-vs-auth is decided on it), not a lock.
	const profiles = list.kind === "active" ? list.profile : []

	const session = await lookupActiveProfileWithBackoff(deps.getActiveProfile, opts)
	if (!deps.isCurrent()) return { kind: "superseded" }
	if (session.kind !== "active") {
		const candidate = await lockScreenCandidate(profiles, deps.lastActiveProfileId)
		if (!deps.isCurrent()) return { kind: "superseded" }
		return { kind: session.kind, profiles, candidate }
	}

	let stillActive: boolean
	try {
		stillActive = await deps.bootstrap(session.profile)
	} catch {
		if (!deps.isCurrent()) return { kind: "superseded" }
		return { kind: "failed", profiles, profile: session.profile }
	}
	if (!deps.isCurrent()) return { kind: "superseded" }
	return { kind: "active", profiles, profile: session.profile, stillActive }
}

/** The profile the lock screen unlocks: the last active one when it still exists, else the first. */
async function lockScreenCandidate<P extends { id: string }>(
	profiles: P[],
	lastActiveProfileId: () => Promise<string | undefined>,
): Promise<P | undefined> {
	if (profiles.length === 0) return undefined
	const lastId = await lastActiveProfileId()
	return (lastId ? profiles.find((p) => p.id === lastId) : undefined) ?? profiles[0]
}
