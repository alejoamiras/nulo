/** Pre-auth entry routes — the only screens `loadProfile` may auto-advance to
 *  `/popup/general` FROM once a profile is active. */
const AUTH_ENTRY_ROUTES = ["popup-register", "popup-auth"] as const

/**
 * Whether `loadProfile` should push to `/popup/general` after bootstrapping the
 * active profile.
 *
 * Only advance when the session SURVIVED bootstrap (`stillActive` — which is
 * `false` if a lock fired mid-bootstrap and `isLogined` stayed off) AND we are on
 * a pre-auth entry route. Advancing on a dead session would drop the user behind
 * the router's auth guard (`popup/index.ts` redirects an auth-required route to
 * `/popup/auth` when `!isLogined`), so the push would bounce straight back — the
 * lock's `onActiveProfileChanged(undefined)` handler already routes to auth.
 *
 * `routeName` is typed `unknown` because `route.name` is `string | symbol |
 * undefined`; a non-string is simply not a member, matching runtime behavior.
 */
export function shouldAdvanceToGeneral(stillActive: boolean, routeName: unknown): boolean {
	return stillActive && (AUTH_ENTRY_ROUTES as readonly unknown[]).includes(routeName)
}
