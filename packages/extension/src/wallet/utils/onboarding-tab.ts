/**
 * Open or focus the onboarding tab. Callable from any extension context
 * (service worker, popup, side-panel) since `chrome.tabs.*` and
 * `chrome.storage.session` are available everywhere.
 *
 * Concurrency: a module-level promise lock collapses concurrent calls into a
 * single in-flight open. Necessary because `onInstalled` (background) and
 * `register.vue` mount (popup) can race on a fresh install — both contexts
 * are different module graphs but each individually only sees one call at a
 * time. The lock keeps each context internally single-flight; the cross-
 * context race resolves naturally because the popup almost always loses
 * (chrome opens the popup AFTER firing onInstalled).
 *
 * Session-storage tab-id tracking is best-effort. chrome.storage.session is
 * cleared on reload/update/disable/browser-restart, so a stored id can
 * outlive itself — in that case we open a fresh tab and orphan the old one.
 * Acceptable; user can close the duplicate.
 */

const TAB_ID_KEY = "nulo:onboarding:tab-id"
const ONBOARDING_PATH = "src/onboarding/index.html#/onboarding/welcome"

let inFlight: Promise<void> | null = null

export function openOrFocusOnboardingTab(): Promise<void> {
	if (inFlight) return inFlight
	inFlight = (async () => {
		try {
			const stored = await chrome.storage.session.get(TAB_ID_KEY)
			const existingId = stored[TAB_ID_KEY] as number | undefined
			if (typeof existingId === "number") {
				try {
					const tab = await chrome.tabs.get(existingId)
					await chrome.tabs.update(existingId, { active: true })
					if (tab.windowId !== undefined) {
						await chrome.windows.update(tab.windowId, { focused: true })
					}
					return
				} catch {
					// Tab was closed; fall through to fresh create.
				}
			}
			const url = chrome.runtime.getURL(ONBOARDING_PATH)
			const tab = await chrome.tabs.create({ url })
			if (typeof tab.id === "number") {
				await chrome.storage.session.set({ [TAB_ID_KEY]: tab.id })
			}
		} finally {
			inFlight = null
		}
	})()
	return inFlight
}

/** Clear the tracked tab id. Call after onboarding finishes (Done page) so
 * a subsequent popup mount doesn't try to focus a tab that just closed itself. */
export async function clearOnboardingTabTracking(): Promise<void> {
	await chrome.storage.session.remove(TAB_ID_KEY)
}
