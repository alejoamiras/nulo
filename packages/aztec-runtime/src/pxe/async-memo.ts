/**
 * Async memoization with retry-on-failure, extracted from the six hand-rolled
 * promise caches this directory grew independently. The load-bearing contract,
 * encoded once: the in-flight/settled promise is cached; a REJECTION clears
 * the cache slot so the next call retries — and the clear is identity-guarded,
 * so a stale rejection handler can never clobber a newer promise that a
 * concurrent reset()+retry already installed.
 */

/** Singleton async memo. */
export function memoizeAsync<T>(loader: () => Promise<T>): { get(): Promise<T>; reset(): void } {
	let cached: Promise<T> | undefined
	return {
		get(): Promise<T> {
			if (!cached) {
				const entry = loader()
				cached = entry
				entry.catch(() => {
					if (cached === entry) cached = undefined
				})
			}
			return cached
		},
		reset(): void {
			cached = undefined
		},
	}
}

/** Minimal store surface: satisfied by `Map` for any key type and by
 *  `WeakMap` for object keys (inject one when a torn-down key must not be
 *  pinned in memory by its cached promise — GC behavior is load-bearing for
 *  per-PXE caches). */
export interface AsyncMemoStore<K, V> {
	get(key: K): Promise<V> | undefined
	set(key: K, value: Promise<V>): unknown
	delete(key: K): unknown
}

/** Keyed async memo. `reset` is per-key only: an all-keys reset cannot exist
 *  over an injected WeakMap (not enumerable), and no consumer needs one. */
export function memoizeAsyncBy<K, V>(
	loader: (key: K) => Promise<V>,
	store: AsyncMemoStore<K, V> = new Map<K, Promise<V>>(),
): { get(key: K): Promise<V>; reset(key: K): void } {
	return {
		get(key: K): Promise<V> {
			let entry = store.get(key)
			if (!entry) {
				const created = loader(key)
				entry = created
				store.set(key, created)
				created.catch(() => {
					if (store.get(key) === created) store.delete(key)
				})
			}
			return entry
		},
		reset(key: K): void {
			store.delete(key)
		},
	}
}
