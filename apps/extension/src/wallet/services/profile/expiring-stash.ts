/**
 * An in-memory map of secret-bearing entries that expire `ttlMs` after `capturedAt`.
 *
 * Ownership: the stash owns each entry's buffers until a successful `take` hands them to the
 * caller. `drop`, an expired `take` and `sweep` wipe; the inherited `delete`, `clear` and `set`
 * do NOT (a `set` over a live key discards the old entry unwiped). Expiry is checked only on
 * these calls, never by a timer. Callers serialize access (the profile facade lock); every
 * method is synchronous, so no call interleaves with another.
 */
export class ExpiringStash<E extends { capturedAt: number }> extends Map<string, E> {
	public constructor(
		private readonly ttlMs: number,
		private readonly wipe: (entry: E) => void,
	) {
		super()
	}

	/** Wipes and drops every expired entry except `exceptId`'s. */
	public sweep(now: number, exceptId?: string): void {
		for (const [id, entry] of this) {
			if (id === exceptId) continue
			if (now - entry.capturedAt >= this.ttlMs) {
				this.delete(id)
				this.wipe(entry)
			}
		}
	}

	/** Removes `id`'s entry and hands it over, or wipes it and returns `undefined` once expired:
	 *  a sweep spares the id being consumed, so the TTL is enforced here or never on that entry. */
	public take(id: string, now: number): E | undefined {
		const entry = this.get(id)
		if (!entry) return undefined
		this.delete(id)
		if (now - entry.capturedAt >= this.ttlMs) {
			this.wipe(entry)
			return undefined
		}
		return entry
	}

	/** Removes and wipes `id`'s entry, if any. */
	public drop(id: string): void {
		const entry = this.get(id)
		if (entry) {
			this.delete(id)
			this.wipe(entry)
		}
	}
}
