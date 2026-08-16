/**
 * The one fee-estimation state machine: per-key debounce, monotonic staleness
 * counters, caller-minted cancellation tokens, remote-cancel ownership, and
 * the handed-off set. `useFeeEstimation` (single-slot) and `useFeeEstimationMap`
 * (per-op) are thin adapters over this engine — it owns every lifecycle
 * transition; they own the Vue state (via the sink callbacks) and their public
 * API shapes.
 *
 * Deliberately Vue-free and NOT auto-importable (the auto-import `dirs` scan is
 * non-recursive, so `internal/` is reachable only by explicit import).
 */

export interface FeeEstimationEngineOptions<TKey extends string | number, TParams, TResult> {
	/**
	 * The RPC leg. Receives the raw key — adapters mint their own derived
	 * identifiers (e.g. the keyed composable's SW-coalescing flowKey); the
	 * engine never constructs one.
	 */
	run: (params: TParams, estimateToken: string, key: TKey) => Promise<TResult>
	/** No default here — each adapter supplies its own documented default. */
	debounceMs: number
	/**
	 * State sinks. Invoked synchronously at exactly the points the transitions
	 * occur, in a fixed observable order: `schedule` clears the result BEFORE
	 * flipping estimating true; `cancel` clears the result BEFORE flipping
	 * estimating false; on a real error, `onError` fires BEFORE estimating
	 * flips false (an error handler observes estimating === true).
	 */
	onResult: (key: TKey, result: TResult | null) => void
	onEstimating: (key: TKey, estimating: boolean) => void
	/** Called only for real errors, never for stale-counter or post-dispose settles. */
	onError?: (key: TKey, err: unknown) => void
	/**
	 * Fire-and-forget remote cancel. Invoked for a superseded or abandoned
	 * token whose RPC actually started — a debounce that never fired needs no
	 * remote cancel. Never invoked for handed-off tokens (ownership
	 * transferred to the execution path, which is about to consume the
	 * stashed estimate).
	 */
	cancelRemote?: (estimateToken: string) => void
}

export interface FeeEstimationEngine<TKey extends string | number, TParams> {
	/** Schedule a debounced estimation for `key`, superseding any live one for it. */
	schedule(key: TKey, params: TParams): void
	/** Cancel `key`'s pending estimation (if any) and clear its state. Idempotent. */
	cancel(key: TKey): void
	/** Cancel every key with any live state. */
	cancelAll(): void
	/**
	 * Single-slot submit seam: returns the completed token, or — deliberately —
	 * a still-in-flight one (`completed ?? inflight`), marked handed off. The
	 * submit path consumes THIS slot's estimate, so an in-flight token's stash
	 * will be consumed the moment it lands.
	 */
	handoffInclusive(key: TKey): string | null
	/**
	 * Multi-op approve seam: completed tokens ONLY, each marked handed off.
	 * In-flight estimates are deliberately left armed — their ids never reach
	 * the approve payload, so handing them off would only orphan their
	 * eventual stashes.
	 */
	handoffCompleted(): Array<[TKey, string]>
	/** Undo a handoff after a FAILED approve — normal cancellation applies again. */
	rearm(): void
	/** Idempotent teardown: clears timers, remote-cancels every owned live token. */
	dispose(): void
}

export function createFeeEstimationEngine<TKey extends string | number, TParams, TResult>(
	options: FeeEstimationEngineOptions<TKey, TParams, TResult>,
): FeeEstimationEngine<TKey, TParams> {
	const { run, debounceMs, onResult, onEstimating, onError, cancelRemote } = options

	const timers = new Map<TKey, ReturnType<typeof setTimeout>>()
	const counters = new Map<TKey, number>()
	const inflight = new Map<TKey, { token: string; started: boolean }>()
	const completed = new Map<TKey, string>()
	const handedOff = new Set<string>()
	let disposed = false

	const clearTimerFor = (key: TKey) => {
		const t = timers.get(key)
		if (t) {
			clearTimeout(t)
			timers.delete(key)
		}
	}

	/** Remote-cancel every live token still owned for `key`. */
	const cancelOwnedRemoteFor = (key: TKey) => {
		const flight = inflight.get(key)
		const tokens = [flight?.started ? flight.token : null, completed.get(key) ?? null]
		for (const token of tokens) {
			if (token && !handedOff.has(token)) cancelRemote?.(token)
		}
		inflight.delete(key)
		completed.delete(key)
	}

	const cancel = (key: TKey) => {
		clearTimerFor(key)
		cancelOwnedRemoteFor(key)
		// Bumping the counter for this key invalidates any in-flight run promise.
		counters.set(key, (counters.get(key) ?? 0) + 1)
		onResult(key, null)
		onEstimating(key, false)
	}

	const cancelAll = () => {
		const keys = new Set<TKey>([...timers.keys(), ...inflight.keys(), ...completed.keys()])
		for (const key of keys) cancel(key)
	}

	const schedule = (key: TKey, params: TParams) => {
		clearTimerFor(key)
		cancelOwnedRemoteFor(key)
		onResult(key, null)
		onEstimating(key, true)
		const myCounter = (counters.get(key) ?? 0) + 1
		counters.set(key, myCounter)
		const token = crypto.randomUUID()
		inflight.set(key, { token, started: false })

		const timer = setTimeout(async () => {
			try {
				const flight = inflight.get(key)
				if (flight?.token === token) flight.started = true
				const r = await run(params, token, key)
				if (disposed || myCounter !== counters.get(key)) return
				onResult(key, r)
				completed.set(key, token)
				inflight.delete(key)
			} catch (err) {
				if (disposed || myCounter !== counters.get(key)) return
				onResult(key, null)
				// A transport failure (RPC timeout) leaves the SW-side runner
				// alive with no local owner — without this cancel it would be
				// unreachable by every later cleanup path and its stash would
				// sit un-evictable for the full TTL.
				const flight = inflight.get(key)
				if (flight?.token && !handedOff.has(flight.token)) cancelRemote?.(flight.token)
				inflight.delete(key)
				onError?.(key, err)
			} finally {
				if (!disposed && myCounter === counters.get(key)) {
					onEstimating(key, false)
				}
			}
		}, debounceMs)
		timers.set(key, timer)
	}

	const handoffInclusive = (key: TKey): string | null => {
		const token = completed.get(key) ?? inflight.get(key)?.token ?? null
		if (token) handedOff.add(token)
		return token
	}

	const handoffCompleted = (): Array<[TKey, string]> => {
		const tokens: Array<[TKey, string]> = []
		for (const [key, token] of completed) {
			handedOff.add(token)
			tokens.push([key, token])
		}
		return tokens
	}

	const rearm = (): void => {
		handedOff.clear()
	}

	const dispose = () => {
		if (disposed) return
		for (const t of timers.values()) clearTimeout(t)
		timers.clear()
		for (const key of new Set<TKey>([...inflight.keys(), ...completed.keys()])) {
			cancelOwnedRemoteFor(key)
		}
		disposed = true
	}

	return { schedule, cancel, cancelAll, handoffInclusive, handoffCompleted, rearm, dispose }
}
