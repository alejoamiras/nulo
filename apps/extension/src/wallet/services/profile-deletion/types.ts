/**
 * Shared types for the profile-deletion coordinator, in their own module so
 * `ProfileService` can import the delegate interface WITHOUT importing the
 * coordinator (which imports every leaf service) — no circular import.
 */

/** The exact rows a profile-delete must erase, snapshotted UNDER the facade lock
 *  before the source rows are gone — so cleanup completes/resumes even after. */
export interface ProfileDeletionSnapshot {
	addresses: string[]
	tokenIds: number[]
	networkIds: string[]
}

/** The narrow surface `ProfileService` calls (via a lazily-resolved delegate, so
 *  ProfileService keeps NO topological dependency on the coordinator). */
export interface ProfileDeletionDelegate {
	snapshot(profileId: string): Promise<ProfileDeletionSnapshot>
	runFor(profileId: string, snapshot: ProfileDeletionSnapshot): Promise<void>
}
