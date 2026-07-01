/**
 * Fail-closed profile-ownership guard for a by-id lookup: returns `row` only when
 * it EXISTS and belongs to `profileId`, otherwise throws.
 *
 * `profileId` is an EXPLICIT argument — deliberately NOT read from the active
 * profile in here — so every call site keeps its active-vs-caller-profile choice
 * visible. Conflating them (auto-injecting the active profile) is exactly the
 * documented wrong-profile-wipe bug this repo already navigated. Fail-closed by
 * construction: a missing row, or a mismatched/absent `profileId`, throws — it
 * never falls through to return an unowned row.
 */
export function requireOwnedRow<T extends { profileId: string }>(row: T | undefined, profileId: string, message = "Invalid id"): T {
	if (!row || row.profileId !== profileId) {
		throw new Error(message)
	}
	return row
}
