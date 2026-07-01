/**
 * Snapshot-iterate `rows` through a per-row `writeOne`, capturing any failure as a
 * `restoreError` STRING on that row instead of aborting — centralizing the
 * `try → write → catch → Restored<T>[]` loop every service's `restore()`
 * hand-rolled.
 *
 * The caller owns id allocation + validation INSIDE `writeOne` (id cursors diverge
 * per store — shared numeric cursor, per-row alloc, keep-id-else-random — so they
 * stay visibly caller-side, exactly like `purgeRows` keeps row-loading caller-side).
 *
 * Best-effort BY DESIGN: a rejected `writeOne` is recorded on that row and the loop
 * CONTINUES (unlike `purgeRows`, which aborts). Restore deliberately tolerates
 * per-row failure so one bad row doesn't drop the rest of an import; do not
 * "harden" this into aborting. A successful row is returned as-is (so any in-place
 * id reassignment `writeOne` made is reflected); a failed row is a shallow copy
 * carrying `restoreError`.
 */
import { toRestoreError } from "@/utils/restore-error"
import type { Restored } from "@/wallet/base"

export async function restoreRows<T extends object>(rows: readonly T[], writeOne: (row: T) => Promise<void>): Promise<Restored<T>[]> {
	const results: Restored<T>[] = []
	for (const row of rows) {
		try {
			await writeOne(row)
			results.push(row)
		} catch (err) {
			results.push({ ...row, restoreError: toRestoreError(err) })
		}
	}
	return results
}
