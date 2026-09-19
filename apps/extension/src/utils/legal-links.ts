import { type LegalDocument, currentVersion, permalink } from "@nulo/legal"

const SIZES = { popup: { width: 360, height: 600 }, tab: { width: 480, height: 720 } } as const

/**
 * Opens the CURRENT version's own permalink, never the moving `/terms` page: what a person reads
 * before agreeing has to be the text whose version is about to be recorded.
 */
export function openLegalDocument(doc: LegalDocument, from: keyof typeof SIZES = "popup"): void {
	void chrome.windows.create({ type: "popup", url: permalink(doc, currentVersion(doc).version), ...SIZES[from] })
}
