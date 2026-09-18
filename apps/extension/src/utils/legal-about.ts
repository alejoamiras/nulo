import { LEGAL_MANIFEST, type LegalAcceptanceRecord, type LegalStatus, currentVersion, parseVersion } from "@nulo/legal"

export interface LegalAboutRow {
	accepted: boolean
	title: string
	description: string
	/** The policy moved since it was last shown. It never blocks: Terms § 23 keeps it out of consent. */
	privacyUpdated: boolean
}

const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }

function isOlder(shown: string, current: string): boolean {
	const a = parseVersion(shown)
	const b = parseVersion(current)
	if (!a || !b) return false
	// Exact, patch included: this only informs, so every published change is worth the notice.
	const at = a.findIndex((part, index) => part !== b[index])
	return at !== -1 && (a[at] as number) < (b[at] as number)
}

/** What Settings shows about the acceptance: only the Terms are ever "accepted". */
export function legalAboutRow(
	status: LegalStatus | "loading",
	record: LegalAcceptanceRecord | null,
	locale?: string,
	manifest = LEGAL_MANIFEST,
): LegalAboutRow {
	const privacyUpdated = !!record && isOlder(record.privacyVersionShown, currentVersion("privacy", manifest).version)
	if (status !== "current" || !record) {
		const pending = `Terms v${currentVersion("terms", manifest).version}`
		return { accepted: false, title: "Not accepted", description: status === "loading" ? "" : `${pending}. Review`, privacyUpdated }
	}
	const when = new Date(record.acceptedAt).toLocaleString(locale, WHEN)
	return { accepted: true, title: "You accepted the Terms", description: `Terms v${record.termsVersion} · ${when}`, privacyUpdated }
}
