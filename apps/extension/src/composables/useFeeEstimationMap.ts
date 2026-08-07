import { onScopeDispose, ref, type Ref } from "vue"

export interface UseFeeEstimationMapOptions<TKey extends string | number, TParams, TResult> {
	/**
	 * The async estimator. Receives the params handed to `estimate(key, params)`
	 * plus the caller-minted cancellation token and the per-key flow key —
	 * thread both into `estimateOperationFee` so the SW can abort + evict on
	 * remote cancel and coalesce overflow admissions per operation slot.
	 */
	estimate: (params: TParams, estimateToken: string, flowKey: string) => Promise<TResult>
	/**
	 * Debounce window per key before the estimator actually fires. Default: 500ms,
	 * matching the prior inline debounce in the execute window. Send-page-style
	 * 800ms callers should prefer `useFeeEstimation` (single-slot).
	 */
	debounceMs?: number
	/**
	 * Called when the estimator throws a real error (not a stale-counter cancel).
	 * Receives the key + the error so logs can pinpoint which op failed.
	 */
	onError?: (key: TKey, err: unknown) => void
	/** Fire-and-forget remote cancel — see `useFeeEstimation`'s doc. */
	cancelRemote?: (estimateToken: string) => void
}

export interface UseFeeEstimationMapResult<TKey extends string | number, TParams, TResult> {
	/** Per-key latest successful estimation, or `null` while pending or after a failure. */
	results: Ref<Record<TKey, TResult | null>>
	/** Per-key true-from-call-until-resolve flag. */
	estimating: Ref<Record<TKey, boolean>>
	/** Schedule a debounced estimation for `key`. Cancels any in-flight one for the same key. */
	estimate: (key: TKey, params: TParams) => void
	/** Cancel the pending estimation for `key` (if any) and clear its result. Safe to call repeatedly. */
	cancel: (key: TKey) => void
	/** Cancel every pending estimation. Useful before tearing down a multi-op view. */
	cancelAll: () => void
	/**
	 * Disarm cancellation for every key's current estimate — call on approve,
	 * BEFORE the window closes, so unmount cleanup cannot race the
	 * fire-and-forget execution out of its stashed reuse entries. Returns the
	 * handed-off token per key (undefined where a key has none).
	 */
	handoffAll: () => Partial<Record<TKey, string>>
	/** Manually dispose. Auto-runs on scope stop. */
	dispose: () => void
}

export function useFeeEstimationMap<TKey extends string | number, TParams, TResult>(
	options: UseFeeEstimationMapOptions<TKey, TParams, TResult>,
): UseFeeEstimationMapResult<TKey, TParams, TResult> {
	const { estimate, debounceMs = 500, onError, cancelRemote } = options

	const results = ref({}) as Ref<Record<TKey, TResult | null>>
	const estimating = ref({}) as Ref<Record<TKey, boolean>>

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
		// Bumping the counter for this key invalidates any in-flight estimator promise.
		counters.set(key, (counters.get(key) ?? 0) + 1)
		results.value[key] = null
		estimating.value[key] = false
	}

	const cancelAll = () => {
		const keys = new Set<TKey>([...timers.keys(), ...inflight.keys(), ...completed.keys()])
		for (const key of keys) cancel(key)
	}

	const schedule = (key: TKey, params: TParams) => {
		clearTimerFor(key)
		cancelOwnedRemoteFor(key)
		results.value[key] = null
		estimating.value[key] = true
		const myCounter = (counters.get(key) ?? 0) + 1
		counters.set(key, myCounter)
		const token = crypto.randomUUID()
		inflight.set(key, { token, started: false })

		const timer = setTimeout(async () => {
			try {
				const flight = inflight.get(key)
				if (flight?.token === token) flight.started = true
				const r = await estimate(params, token, `op:${String(key)}`)
				if (disposed || myCounter !== counters.get(key)) return
				results.value[key] = r
				completed.set(key, token)
				inflight.delete(key)
			} catch (err) {
				if (disposed || myCounter !== counters.get(key)) return
				results.value[key] = null
				inflight.delete(key)
				onError?.(key, err)
			} finally {
				if (!disposed && myCounter === counters.get(key)) {
					estimating.value[key] = false
				}
			}
		}, debounceMs)
		timers.set(key, timer)
	}

	const handoffAll = (): Partial<Record<TKey, string>> => {
		const tokens: Partial<Record<TKey, string>> = {}
		const keys = new Set<TKey>([...inflight.keys(), ...completed.keys()])
		for (const key of keys) {
			const token = completed.get(key) ?? inflight.get(key)?.token
			if (!token) continue
			handedOff.add(token)
			tokens[key] = token
		}
		return tokens
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

	onScopeDispose(dispose)

	return { results, estimating, estimate: schedule, cancel, cancelAll, handoffAll, dispose }
}
