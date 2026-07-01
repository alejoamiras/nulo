/**
 * Snapshot-iterate `rows` through a per-row `writeOne`, capturing any failure as a
 * `restoreError` STRING on that row instead of aborting — centralizing the
 * `try → write → catch → Restored<T>[]` loop every service's `restore()`
 * hand-rolled.
 *
 * `writeOne` owns id allocation + validation + the write, and RETURNS the row as
 * persisted — because most restores reassign the id (collision avoidance / a fresh
 * numeric cursor), so the returned row must carry the WRITTEN id, not the input's
 * (hence `TIn → TOut`, not a `void` callback). Keeping alloc caller-side mirrors how
 * `purgeRows` keeps row-loading caller-side; the cursors diverge per store.
 *
 * Best-effort BY DESIGN: a rejected `writeOne` is recorded on that row and the loop
 * CONTINUES (unlike `purgeRows`, which aborts). Restore deliberately tolerates
 * per-row failure so one bad row doesn't drop the rest of an import; do not
 * "harden" this into aborting. On failure the ORIGINAL input row is returned as a
 * shallow copy carrying `restoreError` (matching every hand-rolled original).
 */
import { toRestoreError } from "@/utils/restore-error"
import type { Restored } from "@/wallet/base"

export async function restoreRows<TIn extends object, TOut extends object = TIn>(
	rows: readonly TIn[],
	writeOne: (row: TIn) => Promise<TOut>,
): Promise<Restored<TIn | TOut>[]> {
	const results: Restored<TIn | TOut>[] = []
	for (const row of rows) {
		try {
			results.push(await writeOne(row))
		} catch (err) {
			results.push({ ...row, restoreError: toRestoreError(err) })
		}
	}
	return results
}
