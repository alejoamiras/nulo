import { onScopeDispose, ref, type Ref } from "vue"

export interface UseFeeEstimationMapOptions<TKey extends string | number, TParams, TResult> {
	/** The async estimator. Receives the params handed to `estimate(key, params)`. */
	estimate: (params: TParams) => Promise<TResult>
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
	/** Manually dispose. Auto-runs on scope stop. */
	dispose: () => void
}

export function useFeeEstimationMap<TKey extends string | number, TParams, TResult>(
	options: UseFeeEstimationMapOptions<TKey, TParams, TResult>,
): UseFeeEstimationMapResult<TKey, TParams, TResult> {
	const { estimate, debounceMs = 500, onError } = options

	const results = ref({}) as Ref<Record<TKey, TResult | null>>
	const estimating = ref({}) as Ref<Record<TKey, boolean>>

	const timers = new Map<TKey, ReturnType<typeof setTimeout>>()
	const counters = new Map<TKey, number>()
	let disposed = false

	const clearTimerFor = (key: TKey) => {
		const t = timers.get(key)
		if (t) {
			clearTimeout(t)
			timers.delete(key)
		}
	}

	const cancel = (key: TKey) => {
		clearTimerFor(key)
		// Bumping the counter for this key invalidates any in-flight estimator promise.
		counters.set(key, (counters.get(key) ?? 0) + 1)
		results.value[key] = null
		estimating.value[key] = false
	}

	const cancelAll = () => {
		for (const key of Array.from(timers.keys())) cancel(key)
	}

	const schedule = (key: TKey, params: TParams) => {
		clearTimerFor(key)
		results.value[key] = null
		estimating.value[key] = true
		const myCounter = (counters.get(key) ?? 0) + 1
		counters.set(key, myCounter)

		const timer = setTimeout(async () => {
			try {
				const r = await estimate(params)
				if (disposed || myCounter !== counters.get(key)) return
				results.value[key] = r
			} catch (err) {
				if (disposed || myCounter !== counters.get(key)) return
				results.value[key] = null
				onError?.(key, err)
			} finally {
				if (!disposed && myCounter === counters.get(key)) {
					estimating.value[key] = false
				}
			}
		}, debounceMs)
		timers.set(key, timer)
	}

	const dispose = () => {
		if (disposed) return
		disposed = true
		for (const t of timers.values()) clearTimeout(t)
		timers.clear()
	}

	onScopeDispose(dispose)

	return { results, estimating, estimate: schedule, cancel, cancelAll, dispose }
}
