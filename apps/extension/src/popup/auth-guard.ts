/**
 * Decision core for the popup router's auth-required gate.
 *
 * `appStore.isLogined` flips only at the END of the activation bootstrap (`useProfileBootstrap`
 * sets it after the full network/account/transaction chain resolves). Between an accepted unlock
 * and that flip lies a window — seconds on a loaded machine — where the session record is OPEN
 * but the flag still reads false. Bouncing auth-required navigations in that window ejects the
 * user to the password screen they just left. The authoritative active-session read decides
 * instead: the lagging flag stays in the equation only where no better source exists.
 */

export type AuthRequiredGate = "pass" | "auth"

/**
 * Whether navigation to an auth-required route may proceed.
 *
 * @param isLogined - the store's activation flag (true ⇒ pass, short-circuits the lookup)
 * @param isSessionChecked - false while initial load is still deciding; conservatively `auth`
 *   (loadProfile owns boot-time advancement)
 * @param getActiveProfile - AUTHORITATIVE session read (service-side); an active profile means
 *   the session is genuinely open regardless of the lagging flag. A clean `undefined` means
 *   genuinely locked → `auth`. A REJECTION means the service worker is restarting — state
 *   unknown, not closed: after exhausting the backoff schedule it degrades to `pass`, because a
 *   locked wallet answers cleanly (never rejects) and ejecting an open session to the password
 *   screen is the exact bug this gate exists to prevent.
 */
export async function authRequiredGate(
	isLogined: boolean,
	isSessionChecked: boolean,
	getActiveProfile: () => Promise<{ id: string } | undefined>,
): Promise<AuthRequiredGate> {
	if (isLogined) return "pass"
	if (!isSessionChecked) return "auth"
	const lookup = await lookupActiveProfileWithBackoff(getActiveProfile)
	// Unreachable degrades to pass: a locked wallet answers cleanly, so a rejection means the
	// worker is restarting, and ejecting an open session to the password screen is the bug.
	return lookup.kind === "locked" ? "auth" : "pass"
}

export type ActiveProfileLookup<P> = { kind: "active"; profile: P } | { kind: "locked" } | { kind: "unreachable" }

/**
 * A boot-time service read with the transport backoff every such caller needs: a
 * service-worker respawn under CPU pressure has been observed to outlast any single short gap,
 * so transport-level rejections retry across ~1.5s before the result is reported as
 * `unreachable` — which is UNKNOWN, never locked. A clean `undefined` answer is `locked`; any
 * other value is `active` with that value (for the active-session read, the profile; the same
 * shape serves the profile-list read, whose empty array is a value, not a lock).
 */
export async function lookupActiveProfileWithBackoff<P>(getActiveProfile: () => Promise<P | undefined>): Promise<ActiveProfileLookup<P>> {
	const delays = [0, 250, 500, 750]
	for (const delay of delays) {
		if (delay) await new Promise<void>((r) => setTimeout(r, delay))
		try {
			const profile = await getActiveProfile()
			return profile ? { kind: "active", profile } : { kind: "locked" }
		} catch {
			// Retry on the next delay; the schedule's end is the only "unreachable" verdict.
		}
	}
	return { kind: "unreachable" }
}
