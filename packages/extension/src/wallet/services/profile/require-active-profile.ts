import type { ProfileInfo } from "./spec"

/**
 * Canonical active-profile lock guard: returns the active profile, or throws
 * `lockedMessage` when none is set (a locked or un-selected wallet).
 *
 * Centralizes the `getActiveProfile()` + `if (!profile) throw` preamble that was
 * hand-rolled across the SW service layer. The message stays a parameter
 * because the exact strings are load-bearing — `"Profile locked"` is asserted in
 * the profile unit/integration tests and the full-backup import flow, and
 * `"Wallet locked"` is the dApp-observable error pinned by view-executor tests —
 * so callers preserve their own wording rather than unifying it.
 *
 * Accepts any `{ getActiveProfile() }` source so the varied SW-side receivers
 * (the `ProfileService`, an execution deps adapter, a captured getter) reuse one
 * guard without widening any DI contract. The source must be an in-process
 * service — NOT the popup-side `ProfileServiceClient` (an RPC proxy that happens
 * to share the shape); this guard is for the service worker, not the popup.
 *
 * NOT a substitute for identity guards (`profile?.id !== expected`) or the
 * deliberate silent non-throwers (`if (!profile) return`) — those encode
 * different contracts and must stay inline.
 */
export async function requireActiveProfile(
	source: { getActiveProfile(): Promise<ProfileInfo | undefined> },
	lockedMessage = "Profile locked",
): Promise<ProfileInfo> {
	const profile = await source.getActiveProfile()
	if (!profile) {
		throw new Error(lockedMessage)
	}
	return profile
}
