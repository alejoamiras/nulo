/**
 * Q-10: the cache mechanics + pending-set comparison the two estimate-reuse
 * caches (`transfer-estimate-reuse`, `operation-estimate-reuse`) hand-rolled
 * identically. Only these mechanically-identical pieces are shared — each
 * cache keeps its own validation ladder (order, base-fee handling, and its
 * operation-specific gates are load-bearing and pinned by colocated tests).
 */

/**
 * A single-shot, TTL-bounded id→entry store. `stash` records an entry and
 * opportunistically sweeps expired ones (so the map can't grow unboundedly
 * when the popup re-estimates without consuming), plus a per-entry timer that
 * physically drops the entry AT the TTL. `consume` pops an entry on first read
 * (single-shot). Staleness is by `builtAt`; the caller still runs its own TTL
 * gate in the consume ladder (with its own diagnostics) — this store owns only
 * the background eviction.
 */
export class SingleShotTtlCache<E extends { builtAt: number }> {
	private readonly cache = new Map<string, E>()

	public constructor(private readonly ttlMs: number) {}

	/** Store an entry under a fresh id, then sweep expired entries. */
	public stash(id: string, entry: E): void {
		this.cache.set(id, entry)
		this.evictStale()
		// Per-entry timer so the entry is physically dropped AT the TTL
		// (idempotent vs consume/evict; dies with the SW, as does the map).
		setTimeout(() => this.cache.delete(id), this.ttlMs + 1)
	}

	/** Pop an entry, removing it (single-shot). Unknown id ⇒ undefined. */
	public consume(id: string): E | undefined {
		const entry = this.cache.get(id)
		this.cache.delete(id)
		return entry
	}

	/** Drop a stashed entry. Idempotent; unknown ids are a no-op. */
	public evict(id: string): void {
		this.cache.delete(id)
	}

	private evictStale(): void {
		const now = Date.now()
		for (const [id, entry] of this.cache) {
			if (now - entry.builtAt > this.ttlMs) {
				this.cache.delete(id)
			}
		}
	}
}

/**
 * True when the pending-tx-hash set changed between estimate and confirm
 * (order-insensitive set equality). Unifies the two prior implementations
 * (a `Set` size+membership compare and a sorted positional compare), which
 * agree for the unique tx-hash inputs both receive.
 */
export function pendingHashesChanged(current: readonly string[], cached: readonly string[]): boolean {
	const currentSet = new Set(current)
	const cachedSet = new Set(cached)
	return currentSet.size !== cachedSet.size || [...currentSet].some((h) => !cachedSet.has(h))
}
