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
