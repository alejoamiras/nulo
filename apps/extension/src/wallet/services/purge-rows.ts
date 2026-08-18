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
 * object AND the TRUE storage id, and deletes by that id.
 *
 * Safety layering (the storage API has no atomic compare-and-delete):
 *   1. The predicate should attribute by the STORAGE KEY where keys encode
 *      ownership (see account's `parseAccountRowId`) — then no live writer can
 *      legitimately target a matched key and the delete races nobody.
 *   2. Each site runs the pass inside its store's write-serializing hold where
 *      one exists, excluding that store's own writers outright.
 *   3. The delete re-reads `rawValue(id)` and refuses unless the bytes still
 *      equal the snapshot. This SHRINKS the snapshot→delete window to the
 *      re-read→delete gap — a guard, not an exclusion; it is the only layer on
 *      stores with neither key-attribution nor a service-wide lock, where the
 *      remaining gap is accepted because no legitimate writer targets a
 *      malformed row's key there (see each site's comment).
 *
 * Deleted silently, no events (the row was never visible to consumers).
 * JSON-syntax-broken values fail the parse and are skipped, fail-closed. For
 * value-attributed stores they are unattributable by construction; for a
 * key-attributed store (account) the KEY could attribute them — such a parent
 * row currently survives (only its value is unreadable; its dependents still
 * cascade via the key-based harvest), an accepted gap owned as a follow-up.
 * Pattern lifted from `dapp-session/mac-storage.rowsForProfile` and
 * `incoming-transfer/repository.deleteKeysWhere`.
 */
export async function purgeMalformedRows(
	storage: {
		rawStringEntries(): Promise<Array<[string, string]>>
		rawValue(id: string): Promise<string | undefined>
		delete(id: string): Promise<void>
	},
	matchesRaw: (raw: Record<string, unknown>, storageId: string) => boolean,
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
		if (!matchesRaw(raw as Record<string, unknown>, storageId)) continue
		// Guard layer 3: only delete the exact bytes the decision was made about.
		if ((await storage.rawValue(storageId)) !== rawString) continue
		await storage.delete(storageId)
		onPurged?.(storageId)
		purged++
	}
	return purged
}

/**
 * The number a purely-numeric storage-key suffix canonically encodes, or
 * undefined. `String(n) === id` rejects aliases like "01"/"1e3"/" 1" that
 * `Number()` would silently collapse onto a DIFFERENT valid row's id — a
 * malformed row at key "01" must never contribute id 1 to a purge cascade
 * (codex audit). Negative and non-integer suffixes are never allocated.
 */
export function canonicalNumericStorageId(id: string): number | undefined {
	const n = Number(id)
	if (!Number.isInteger(n) || n < 0 || String(n) !== id) return undefined
	return n
}
