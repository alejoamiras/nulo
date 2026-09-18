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

type VersionTriple = readonly [major: number, minor: number, patch: number]

/** `[major, minor, patch]`, or `null` for anything that is not a well-formed version. */
export function parseVersion(value: unknown): VersionTriple | null {
	if (typeof value !== "string") return null
	const match = VERSION_PATTERN.exec(value)
	if (!match) return null
	return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
}

/** Consent is per `major.minor`: a patch never asks again. */
function compareMajorMinor(a: VersionTriple, b: VersionTriple): number {
	return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]
}

/** Evidence is exact: which text was on screen includes the patch. */
function compareExact(a: VersionTriple, b: VersionTriple): number {
	return compareMajorMinor(a, b) || a[2] - b[2]
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

const ENTRY_FIELDS = ["termsVersion", "privacyVersionShown", "acceptedAt", "surface"] as const

/** Own data properties of a plain object only: an inherited field is not something that was stored. */
function ownFields(raw: unknown): Record<(typeof ENTRY_FIELDS)[number], unknown> | null {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
	if (!ENTRY_FIELDS.every((field) => Object.hasOwn(raw, field))) return null
	return raw as Record<(typeof ENTRY_FIELDS)[number], unknown>
}

function parseEntry(raw: unknown): LegalAcceptanceEntry | null {
	const fields = ownFields(raw)
	if (!fields) return null
	const { termsVersion, privacyVersionShown, acceptedAt, surface } = fields
	if (!parseVersion(termsVersion) || !parseVersion(privacyVersionShown)) return null
	if (typeof acceptedAt !== "number" || !Number.isFinite(acceptedAt)) return null
	if (surface !== "onboarding" && surface !== "popup") return null
	return { termsVersion: termsVersion as string, privacyVersionShown: privacyVersionShown as string, acceptedAt, surface }
}

/** Storage is untrusted input: anything that is not exactly a record is no record. */
export function parseAcceptanceRecord(raw: unknown): LegalAcceptanceRecord | null {
	const head = parseEntry(raw)
	if (!head) return null
	const rawHistory = Object.hasOwn(raw as object, "history") ? (raw as { history: unknown }).history : undefined
	// Bounded before parsing: a hostile record cannot make this walk an arbitrarily long array.
	const tail = Array.isArray(rawHistory) ? rawHistory.slice(-LEGAL_HISTORY_LIMIT) : []
	return { ...head, history: tail.map(parseEntry).filter((entry) => entry !== null) }
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
 * The record after an acceptance. Never replaces a newer accepted Terms version with an older one,
 * patch included: evidence of the newer acceptance outlives a downgrade.
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
	const keepPrevious = previous && prevVersion && nextVersion && compareExact(prevVersion, nextVersion) > 0
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
