import { LEGAL_ACCEPTANCE_KEY, LEGAL_MANIFEST, applyAcceptance, currentVersion } from "@nulo/legal"

/**
 * The acceptance state a launch starts from. `keep` leaves storage alone, which is what a relaunch
 * over a surviving profile needs: reseeding there would erase the state under test.
 */
export type LegalSeed = "current" | "missing" | "stale" | "corrupt" | "keep"

/** Older than any version the manifest can hold, so it stays stale however the manifest grows. */
const STALE_TERMS_VERSION = "0.9"

/** The stored value for a seed, built by the same code the service writes with; `undefined` removes the key. */
export function legalSeedValue(seed: Exclude<LegalSeed, "keep">): unknown {
	if (seed === "missing") return undefined
	if (seed === "corrupt") return { termsVersion: 7, acceptedAt: "yesterday" }
	const current = applyAcceptance(null, "onboarding", Date.UTC(2026, 0, 1), LEGAL_MANIFEST)
	if (seed === "current") return current
	return { ...current, termsVersion: STALE_TERMS_VERSION }
}

export { LEGAL_ACCEPTANCE_KEY, currentVersion }
