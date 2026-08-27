import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@nulo/wallet-core/logger"

/** Structural slice of the SDK handler `wireTabLifecycle` needs — mirrors the
 *  `SessionEstablishedDeps` shape so the wiring is unit-testable without the
 *  full SDK handler. */
export interface TabLifecycleDeps {
	terminateForTab: (tabId: number) => void
	terminateSession: (sessionId: string) => void
	getActiveSessions: () => Array<{ sessionId: string; origin: string; tabId: number }>
	/** Extra per-tab cleanup (e.g. dropping pending-verification markers whose
	 *  handshake died with the tab — before establishment there is no
	 *  ActiveSession to reach them through, so the tabId is the only key). */
	onTabTeardown?: (tabId: number) => void
	logger: ILogger
}

/**
 * Q-04 pilot: the tab-lifecycle wiring extracted from `initWalletSdkHandler`'s
 * closure root. Registers the two `chrome.tabs` listeners that bound a dApp
 * session's life to its tab. Pure side-effecting registration — no unsubscribe
 * (nothing tears down in a service worker); MUST be called before
 * `handler.initialize()`, at the same position the inline block held.
 *
 * URL visibility — the onUpdated guard below is MOSTLY DEAD, verified
 * empirically (the two-sided pin in
 * tests/e2e/network/session-tabNavigate.test.ts): `changeInfo.url` is
 * permission-gated on "tabs" (not declared) or an EXPLICIT `host_permissions`
 * match for the tab's new URL (only nulo.sh + 127.0.0.1 in this manifest; a
 * runtime tab-specific/site-access grant would be another route, none exists
 * in the default state). The content script's all-URLs `matches` pattern does
 * NOT count — tabs-API scrubbing checks explicit hosts, not scriptable hosts.
 * So for a navigation to an ordinary web origin the cross-origin branch never
 * sees a URL and cannot fire; it executes only when the DESTINATION is an
 * explicitly host-permitted origin. Making it live for all origins would
 * require adding the "tabs" permission — a store-listing-visible manifest
 * change, owner-gated, deliberately NOT shipped here.
 *
 * That is acceptable because the guard is bookkeeping hygiene + reconnect UX,
 * NOT a security control. The boundary is realm teardown, not session-id
 * secrecy (the PAGE generates the discovery requestId that becomes the
 * sessionId, so it is not a secret from the dApp): navigation destroys both
 * MessagePort ends and the content script's per-document ports map, and the
 * ECDH sharedKey dies with that realm — a stale ActiveSession is inert
 * memory. Cleanup holds without URL visibility: tabs.onRemoved (fires without
 * any URL grant), SW eviction, the DappSession deletion sweep, and the 7-day
 * TTL.
 */
export function wireTabLifecycle(deps: TabLifecycleDeps): void {
	// Terminate sessions when a tab is closed
	chrome.tabs.onRemoved.addListener((tabId) => {
		deps.terminateForTab(tabId)
		deps.onTabTeardown?.(tabId)
	})

	// Terminate sessions when a tab navigates to a different origin.
	// SPA navigations (e.g. Next.js router.push) fire tabs.onUpdated with
	// status "loading" but stay on the same origin — these must NOT kill
	// the session. (backport of upstream #56)
	chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
		if (changeInfo.status === "loading" && changeInfo.url) {
			try {
				const newOrigin = new URL(changeInfo.url).origin
				const sessions = deps.getActiveSessions().filter((s) => s.tabId === tabId)
				for (const session of sessions) {
					if (session.origin !== newOrigin) {
						deps.logger.log(
							"wallet-sdk",
							LogLevel.Info,
							// The destination origin is browsing history, and this fires on every dApp-tab
							// navigation. The session id already identifies which connection was dropped.
							`Tab ${tabId} navigated cross-origin, terminating session ${session.sessionId}`,
						)
						deps.terminateSession(session.sessionId)
					}
				}
			} catch {
				// Fail-closed for the WHOLE branch — a malformed URL, or a throw from
				// getActiveSessions/terminateSession, all land here and terminate the
				// tab's sessions rather than leaving a session bound to an unknown page.
				deps.terminateForTab(tabId)
			}
		}
	})
}
