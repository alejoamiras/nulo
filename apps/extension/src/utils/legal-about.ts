import { type LegalAcceptanceRecord, type LegalStatus, currentVersion, parseVersion } from "@nulo/legal"

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
	return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]
}

/** What Settings shows about the acceptance: only the Terms are ever "accepted". */
export function legalAboutRow(status: LegalStatus | "loading", record: LegalAcceptanceRecord | null, locale?: string): LegalAboutRow {
	const privacyUpdated = !!record && isOlder(record.privacyVersionShown, currentVersion("privacy").version)
	if (status !== "current" || !record) {
		const pending = `Terms v${currentVersion("terms").version}`
		return { accepted: false, title: "Not accepted", description: status === "loading" ? "" : `${pending}. Review`, privacyUpdated }
	}
	const when = new Date(record.acceptedAt).toLocaleString(locale, WHEN)
	return { accepted: true, title: "You accepted the Terms", description: `Terms v${record.termsVersion} · ${when}`, privacyUpdated }
}
