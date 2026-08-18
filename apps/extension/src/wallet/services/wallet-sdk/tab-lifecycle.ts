import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@nulo/wallet-core/logger"

/** Structural slice of the SDK handler `wireTabLifecycle` needs — mirrors the
 *  `SessionEstablishedDeps` shape so the wiring is unit-testable without the
 *  full SDK handler. */
export interface TabLifecycleDeps {
	terminateForTab: (tabId: number) => void
	terminateSession: (sessionId: string) => void
	getActiveSessions: () => Array<{ sessionId: string; origin: string; tabId: number }>
	logger: ILogger
}

/**
 * Q-04 pilot: the tab-lifecycle wiring extracted from `initWalletSdkHandler`'s
 * closure root. Registers the two `chrome.tabs` listeners that bound a dApp
 * session's life to its tab. Pure side-effecting registration — no unsubscribe
 * (nothing tears down in a service worker); MUST be called before
 * `handler.initialize()`, at the same position the inline block held.
 */
export function wireTabLifecycle(deps: TabLifecycleDeps): void {
	// Terminate sessions when a tab is closed
	chrome.tabs.onRemoved.addListener((tabId) => {
		deps.terminateForTab(tabId)
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
							`Tab ${tabId} navigated to ${newOrigin}, terminating session ${session.sessionId}`,
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
