/**
 * Deletion fence for backup slice-restore writers. The composable's rollback
 * path runs a plain `deleteProfile` while a timed-out slice restore may still
 * be writing rows SW-side — writes landing after the purge become permanently
 * orphaned. Every restore writer captures epochs at METHOD ENTRY (before any
 * await beyond `ensureInitialized` — a lazy capture inside the row loop can
 * observe a post-deletion epoch and pass) and re-asserts immediately before
 * each row's write, with no await in between.
 */
import type { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"

/** Refuses a restore whose threaded created-profile id is not a non-empty string. Dispatch does
 *  not validate parameters, and the threaded id is the only one allowed to anchor the fence. */
export function requireRestoreProfileId(profileId: unknown): asserts profileId is string {
	if (typeof profileId !== "string" || profileId.length === 0) {
		throw new Error("restore requires the created profile id")
	}
}

/** A backup row's claimed profile id, for `captureRestoreEpochs`. Never throws: rows are
 *  attacker-shaped and may be `null` or a primitive. */
export function restoreRowProfileId(row: unknown): unknown {
	return (row as { profileId?: unknown } | null)?.profileId
}

/**
 * Capture the current deletion epoch for every profile id a restore intends to
 * write under. Non-string/empty ids and profiles already mid-deletion
 * (`isReserved`) are deliberately NOT captured — their rows then fail closed at
 * `assertRestoreEpoch`, preserving `restoreRows`' per-row best-effort contract
 * instead of aborting the whole slice.
 */
export function captureRestoreEpochs(deletion: ProfileDeletionState, profileIds: Iterable<unknown>): Map<string, number> {
	const epochs = new Map<string, number>()
	for (const pid of profileIds) {
		if (typeof pid !== "string" || pid.length === 0 || epochs.has(pid)) continue
		if (deletion.isReserved(pid)) continue
		epochs.set(pid, deletion.capture(pid))
	}
	return epochs
}

/**
 * Assert, immediately before a row's write (no await in between), that the
 * row's profile was captured at entry and its deletion epoch has not moved.
 * Throws for: missing/invalid profile id, a profile that was reserved (or
 * unseen) at entry, and an epoch advanced by a deletion that began mid-restore.
 */
export function assertRestoreEpoch(deletion: ProfileDeletionState, epochs: ReadonlyMap<string, number>, profileId: unknown): void {
	if (typeof profileId !== "string" || profileId.length === 0) {
		throw new Error("row has no profile id — write rejected")
	}
	const epoch = epochs.get(profileId)
	if (epoch === undefined) {
		throw new Error(`profile ${profileId} is being deleted or was not captured at restore entry — write rejected`)
	}
	deletion.assertCurrent(profileId, epoch)
}
