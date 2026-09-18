import { LEGAL_MANIFEST, LEGAL_SITE_ORIGIN, type LegalDocument, type LegalVersion } from "./manifest"

export const LEGAL_ACCEPTANCE_KEY = "nulo:legal:accepted"
export const LEGAL_HISTORY_LIMIT = 20

export type LegalSurface = "onboarding" | "popup"
export type LegalStatus = "current" | "stale" | "missing"

export interface LegalAcceptanceEntry {
	readonly termsVersion: string
	/** The policy version on display at acceptance. Shown, never "accepted": Terms § 23. */
	readonly privacyVersionShown: string
	/** Device clock, informational only. Nothing orders or expires by it. */
	readonly acceptedAt: number
	readonly surface: LegalSurface
}

export interface LegalAcceptanceRecord extends LegalAcceptanceEntry {
	/** The most recent `LEGAL_HISTORY_LIMIT` acceptances, oldest first. */
	readonly history: readonly LegalAcceptanceEntry[]
}

const VERSION_PATTERN = /^(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?$/

/** `[major, minor]`, or `null` for anything that is not a well-formed version. */
export function parseVersion(value: unknown): readonly [number, number] | null {
	if (typeof value !== "string") return null
	const match = VERSION_PATTERN.exec(value)
	if (!match) return null
	return [Number(match[1]), Number(match[2])]
}

function compareMajorMinor(a: readonly [number, number], b: readonly [number, number]): number {
	return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]
}

export function currentVersion(doc: LegalDocument, manifest = LEGAL_MANIFEST): LegalVersion {
	const versions = manifest[doc]
	const head = versions[versions.length - 1]
	if (!head) throw new Error(`legal manifest has no versions for ${doc}`)
	return head
}

function newestMaterial(doc: LegalDocument, manifest = LEGAL_MANIFEST): LegalVersion | undefined {
	return [...manifest[doc]].reverse().find((entry) => entry.material)
}

function parseEntry(raw: unknown): LegalAcceptanceEntry | null {
	if (typeof raw !== "object" || raw === null) return null
	const { termsVersion, privacyVersionShown, acceptedAt, surface } = raw as Record<string, unknown>
	if (!parseVersion(termsVersion) || !parseVersion(privacyVersionShown)) return null
	if (typeof acceptedAt !== "number" || !Number.isFinite(acceptedAt)) return null
	if (surface !== "onboarding" && surface !== "popup") return null
	return { termsVersion: termsVersion as string, privacyVersionShown: privacyVersionShown as string, acceptedAt, surface }
}

/** Storage is untrusted input: anything that is not exactly a record is no record. */
export function parseAcceptanceRecord(raw: unknown): LegalAcceptanceRecord | null {
	const head = parseEntry(raw)
	if (!head) return null
	const rawHistory = (raw as { history?: unknown }).history
	const history = Array.isArray(rawHistory) ? rawHistory.map(parseEntry).filter((entry) => entry !== null) : []
	return { ...head, history: history.slice(-LEGAL_HISTORY_LIMIT) }
}

/**
 * Derived from the Terms alone — § 20 promises re-acceptance for the Terms, and § 23 says accepting
 * them is not privacy consent. An accepted version newer than the manifest (an extension downgrade)
 * is current.
 */
export function acceptanceStatus(raw: unknown, manifest = LEGAL_MANIFEST): LegalStatus {
	const record = parseAcceptanceRecord(raw)
	if (!record) return "missing"
	const required = newestMaterial("terms", manifest)
	const accepted = parseVersion(record.termsVersion)
	const needed = parseVersion(required?.version)
	if (!accepted || !needed) return "missing"
	return compareMajorMinor(accepted, needed) >= 0 ? "current" : "stale"
}

/** Material Terms versions newer than the accepted one, oldest first; all of them with no record. */
export function pendingTermsVersions(raw: unknown, manifest = LEGAL_MANIFEST): readonly LegalVersion[] {
	const accepted = parseVersion(parseAcceptanceRecord(raw)?.termsVersion)
	return manifest.terms.filter((entry) => {
		const version = parseVersion(entry.version)
		if (!entry.material || !version) return false
		return !accepted || compareMajorMinor(version, accepted) > 0
	})
}

/**
 * The record after an acceptance. Never replaces a newer accepted Terms version with an older one:
 * evidence of the newer acceptance outlives a downgrade.
 */
export function applyAcceptance(
	previousRaw: unknown,
	surface: LegalSurface,
	acceptedAt: number,
	manifest = LEGAL_MANIFEST,
): LegalAcceptanceRecord {
	const previous = parseAcceptanceRecord(previousRaw)
	const entry: LegalAcceptanceEntry = {
		termsVersion: currentVersion("terms", manifest).version,
		privacyVersionShown: currentVersion("privacy", manifest).version,
		acceptedAt,
		surface,
	}
	const history = [...(previous?.history ?? []), entry].slice(-LEGAL_HISTORY_LIMIT)
	const prevVersion = parseVersion(previous?.termsVersion)
	const nextVersion = parseVersion(entry.termsVersion)
	const keepPrevious = previous && prevVersion && nextVersion && compareMajorMinor(prevVersion, nextVersion) > 0
	const head: LegalAcceptanceEntry = keepPrevious
		? {
				termsVersion: previous.termsVersion,
				privacyVersionShown: previous.privacyVersionShown,
				acceptedAt: previous.acceptedAt,
				surface: previous.surface,
			}
		: entry
	return { ...head, history }
}

/** A version's own permalink, so the text a user is asked to accept cannot move under them. */
export function permalink(doc: LegalDocument, version: string): string {
	return `${LEGAL_SITE_ORIGIN}/${doc}/v${version}/`
}
