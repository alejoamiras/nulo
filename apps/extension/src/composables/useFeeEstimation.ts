import { onScopeDispose, ref, type Ref } from "vue"

export interface UseFeeEstimationOptions<TParams, TResult> {
	/** The async estimator. Receives the params handed to `estimate(params)`. */
	estimate: (params: TParams) => Promise<TResult>
	/**
	 * Debounce window before the estimator actually fires. Default: 800ms,
	 * matching the prior inline debounce in `send.vue`. Lower it (e.g. 500)
	 * for per-op estimation in the execute window.
	 */
	debounceMs?: number
	/**
	 * Called when the estimator throws a real error (not a stale-counter cancel).
	 * The composable already swallows the error and clears `result` — this hook
	 * is for logging or surfacing user-visible state.
	 */
	onError?: (err: unknown) => void
}

export interface UseFeeEstimationResult<TParams, TResult> {
	/** Latest successful estimation, or `null` while pending or after a failure. */
	result: Ref<TResult | null>
	/** True from the moment `estimate()` is called until the result lands or fails. */
	isEstimating: Ref<boolean>
	/** Schedule a debounced estimation. Cancels any in-flight one. */
	estimate: (params: TParams) => void
	/** Cancel the pending estimation (if any) and clear `result`. Safe to call repeatedly. */
	cancel: () => void
	/** Manually dispose. Auto-runs on scope stop. */
	dispose: () => void
}

export function useFeeEstimation<TParams, TResult>(
	options: UseFeeEstimationOptions<TParams, TResult>,
): UseFeeEstimationResult<TParams, TResult> {
	const { estimate, debounceMs = 800, onError } = options

	const result = ref<TResult | null>(null) as Ref<TResult | null>
	const isEstimating = ref(false)

	let timer: ReturnType<typeof setTimeout> | null = null
	let counter = 0
	let disposed = false

	const clearTimer = () => {
		if (timer) {
			clearTimeout(timer)
			timer = null
		}
	}

	const cancel = () => {
		clearTimer()
		// Bumping the counter invalidates any in-flight estimator promise.
		counter++
		result.value = null
		isEstimating.value = false
	}

	const schedule = (params: TParams) => {
		clearTimer()
		result.value = null
		isEstimating.value = true
		const myCounter = ++counter

		timer = setTimeout(async () => {
			try {
				const r = await estimate(params)
				if (disposed || myCounter !== counter) return
				result.value = r
			} catch (err) {
				if (disposed || myCounter !== counter) return
				result.value = null
				onError?.(err)
			} finally {
				if (!disposed && myCounter === counter) {
					isEstimating.value = false
				}
			}
		}, debounceMs)
	}

	const dispose = () => {
		if (disposed) return
		disposed = true
		clearTimer()
		counter++
	}

	onScopeDispose(dispose)

	return { result, isEstimating, estimate: schedule, cancel, dispose }
}
