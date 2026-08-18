/**
 * Snapshot-iterate already-loaded `rows`, deleting each then emitting its
 * post-delete event — centralizing the delete-before-emit ORDER that every
 * lifecycle-purge listener (profile/chain/account teardown) across the service
 * fleet relies on.
 *
 * The caller owns row loading on purpose: `await this.ensureInitialized()`, any
 * `this.lock.enter()/leave()`, the `.filter(predicate)`, and any post-loop
 * cleanup all stay visibly caller-side. That keeps each service's lock-vs-
 * lockless discipline auditable at its own call site rather than buried behind
 * a `load` callback here.
 *
 * Deliberately NOT best-effort: a rejected `remove` aborts the loop (no
 * `try`/`finally`, no continue-on-error), exactly like the hand-rolled
 * originals. Callers depend on this — e.g. a post-loop cache drop or secondary
 * key delete must run only when every row was purged. Do not "harden" this into
 * swallowing errors; the differing per-entrypoint error/await semantics
 * (awaited+swallowed chain-purge subscribers vs `EventHandler.invoke`
 * listeners) are owned by those entrypoints, not by this helper.
 */
export async function purgeRows<T>(rows: readonly T[], remove: (row: T) => Promise<void>, emitDeleted: (row: T) => void): Promise<void> {
	for (const row of rows) {
		await remove(row)
		emitDeleted(row)
	}
}

/**
 * F-B23: the raw SECOND pass of a lifecycle purge. The typed pass above
 * enumerates through the codec (`getValues()`/`getAll()`), which KEEPS-but-hides
 * a validation-failed row — so a malformed row belonging to the purged
 * profile/account would survive the privacy-erasing delete forever. This pass
 * lists RAW string entries (no codec), matches the predicate on the parsed
 * object, and deletes by the TRUE storage id — but only after a
 * **compare-and-delete**: the key's current raw bytes are re-read and must
 * still equal the snapshotted bytes, so a concurrent legitimate write landing
 * on the same key between snapshot and delete (e.g. a restore reusing an
 * aliased key — codex audit) is never destroyed. Run it AFTER the typed pass,
 * inside the store's write-serializing hold where one exists; the CAS is the
 * containment where none does. Deleted silently, no events (the row was never
 * visible to consumers). JSON-syntax-broken values fail the parse and are
 * skipped — unattributable by construction, fail-closed. Pattern lifted from
 * `dapp-session/mac-storage.rowsForProfile` and
 * `incoming-transfer/repository.deleteKeysWhere`.
 */
export async function purgeMalformedRows(
	storage: {
		rawStringEntries(): Promise<Array<[string, string]>>
		rawValue(id: string): Promise<string | undefined>
		delete(id: string): Promise<void>
	},
	matchesRaw: (raw: Record<string, unknown>) => boolean,
	onPurged?: (storageId: string) => void,
): Promise<number> {
	let purged = 0
	for (const [storageId, rawString] of await storage.rawStringEntries()) {
		let raw: unknown
		try {
			raw = JSON.parse(rawString)
		} catch {
			continue // syntax-broken — no readable predicate field; fail-closed
		}
		if (typeof raw !== "object" || raw === null) continue
		if (!matchesRaw(raw as Record<string, unknown>)) continue
		// CAS: only delete the exact bytes the decision was made about.
		if ((await storage.rawValue(storageId)) !== rawString) continue
		await storage.delete(storageId)
		onPurged?.(storageId)
		purged++
	}
	return purged
}
