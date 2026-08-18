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
 * lists RAW entries (no codec), matches the predicate on the raw parsed object,
 * and deletes by the TRUE storage id. Run it AFTER the typed pass, inside the
 * SAME lock hold: everything still matching is a row the codec could not see
 * (or an aliased copy) — deleted silently, no events (it was never visible to
 * consumers). JSON-syntax-broken rows are skipped by `rawEntries()` itself
 * (no readable predicate field) — unattributable by construction, fail-closed.
 * Pattern lifted from `dapp-session/mac-storage.rowsForProfile` and
 * `incoming-transfer/repository.deleteKeysWhere`.
 */
export async function purgeMalformedRows(
	storage: { rawEntries(): Promise<Array<[string, unknown]>>; delete(id: string): Promise<void> },
	matchesRaw: (raw: Record<string, unknown>) => boolean,
	onPurged?: (storageId: string) => void,
): Promise<number> {
	let purged = 0
	for (const [storageId, raw] of await storage.rawEntries()) {
		if (typeof raw !== "object" || raw === null) continue
		if (!matchesRaw(raw as Record<string, unknown>)) continue
		await storage.delete(storageId)
		onPurged?.(storageId)
		purged++
	}
	return purged
}
