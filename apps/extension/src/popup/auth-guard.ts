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
	// Transport-level failures back off across ~1.5s before degrading: respawns under CPU
	// pressure have been observed to outlast any single short gap.
	const delays = [0, 250, 500, 750]
	let rejected = false
	for (const delay of delays) {
		if (delay) await new Promise<void>((r) => setTimeout(r, delay))
		try {
			const active = await getActiveProfile()
			return active ? "pass" : "auth"
		} catch {
			rejected = true
		}
	}
	return rejected ? "pass" : "auth"
}
