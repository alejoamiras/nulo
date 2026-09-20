import { type LegalDocument, currentVersion, permalink } from "@nulo/legal"

const SIZES = { popup: { width: 360, height: 600 }, tab: { width: 480, height: 720 } } as const

/**
 * Opens the CURRENT version's own permalink, never the moving `/terms` page: what a person reads
 * before agreeing has to be the text whose version is about to be recorded.
 */
export function openLegalDocument(doc: LegalDocument, from: keyof typeof SIZES = "popup"): void {
	void chrome.windows.create({ type: "popup", url: permalink(doc, currentVersion(doc).version), ...SIZES[from] })
}

/** The file the build's notices plugin emits at the extension root; pinned to the plugin's constant by test. */
export const THIRD_PARTY_NOTICES_FILE = "THIRD-PARTY-NOTICES.txt"

/** A tab, not a popup window: the file runs to thousands of lines and wants the browser's own find and zoom. */
export function openThirdPartyNotices(): void {
	void chrome.tabs.create({ url: chrome.runtime.getURL(THIRD_PARTY_NOTICES_FILE) })
}
