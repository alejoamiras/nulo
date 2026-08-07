import { onScopeDispose, ref, type Ref } from "vue"

export interface UseFeeEstimationOptions<TParams, TResult> {
	/**
	 * The async estimator. Receives the params handed to `estimate(params)`
	 * plus the caller-minted cancellation token for this attempt — thread it
	 * into `estimateTransferFee` / `estimateOperationFee` so the SW can
	 * abort + evict on remote cancel.
	 */
	estimate: (params: TParams, estimateToken: string) => Promise<TResult>
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
	/**
	 * Fire-and-forget remote cancel (`executionService.cancelEstimate`).
	 * Invoked for a superseded or abandoned token whose RPC actually started —
	 * a debounce that never fired needs no remote cancel. Never invoked for
	 * tokens released via `handoff()` (ownership transferred to the
	 * execution path, which is about to consume the stashed estimate).
	 */
	cancelRemote?: (estimateToken: string) => void
}

export interface UseFeeEstimationResult<TParams, TResult> {
	/** Latest successful estimation, or `null` while pending or after a failure. */
	result: Ref<TResult | null>
	/** True from the moment `estimate()` is called until the result lands or fails. */
	isEstimating: Ref<boolean>
	/** Schedule a debounced estimation. Cancels any in-flight one (incl. remotely). */
	estimate: (params: TParams) => void
	/** Cancel the pending estimation (if any) and clear `result`. Safe to call repeatedly. */
	cancel: () => void
	/**
	 * Disarm cancellation for the current estimate — call on successful
	 * submit, BEFORE navigating away, so unmount cleanup cannot race the
	 * fire-and-forget confirm out of its stashed reuse entry. Returns the
	 * handed-off token (or null when there's nothing to hand off).
	 */
	handoff: () => string | null
	/** Manually dispose. Auto-runs on scope stop. */
	dispose: () => void
}

export function useFeeEstimation<TParams, TResult>(
	options: UseFeeEstimationOptions<TParams, TResult>,
): UseFeeEstimationResult<TParams, TResult> {
	const { estimate, debounceMs = 800, onError, cancelRemote } = options

	const result = ref<TResult | null>(null) as Ref<TResult | null>
	const isEstimating = ref(false)

	let timer: ReturnType<typeof setTimeout> | null = null
	let counter = 0
	let disposed = false
	/** Token of the scheduled/in-flight attempt; `started` flips when the RPC fires. */
	let inflight: { token: string; started: boolean } | null = null
	/** Token of the last completed attempt (its stash may be cached SW-side). */
	let completedToken: string | null = null
	const handedOff = new Set<string>()

	const clearTimer = () => {
		if (timer) {
			clearTimeout(timer)
			timer = null
		}
	}

	/** Remote-cancel every live token this composable still owns. */
	const cancelOwnedRemote = () => {
		const tokens = [inflight?.started ? inflight.token : null, completedToken]
		for (const token of tokens) {
			if (token && !handedOff.has(token)) cancelRemote?.(token)
		}
		inflight = null
		completedToken = null
	}

	const cancel = () => {
		clearTimer()
		cancelOwnedRemote()
		// Bumping the counter invalidates any in-flight estimator promise.
		counter++
		result.value = null
		isEstimating.value = false
	}

	const schedule = (params: TParams) => {
		clearTimer()
		cancelOwnedRemote()
		result.value = null
		isEstimating.value = true
		const myCounter = ++counter
		const token = crypto.randomUUID()
		inflight = { token, started: false }

		timer = setTimeout(async () => {
			try {
				if (inflight?.token === token) inflight.started = true
				const r = await estimate(params, token)
				if (disposed || myCounter !== counter) return
				result.value = r
				completedToken = token
				inflight = null
			} catch (err) {
				if (disposed || myCounter !== counter) return
				result.value = null
				// A transport failure (RPC timeout) leaves the SW-side runner
				// alive with no local owner — without this cancel it would be
				// unreachable by every later cleanup path and its stash would
				// sit un-evictable for the full TTL.
				if (inflight?.token && !handedOff.has(inflight.token)) cancelRemote?.(inflight.token)
				inflight = null
				onError?.(err)
			} finally {
				if (!disposed && myCounter === counter) {
					isEstimating.value = false
				}
			}
		}, debounceMs)
	}

	const handoff = (): string | null => {
		const token = completedToken ?? inflight?.token ?? null
		if (token) handedOff.add(token)
		return token
	}

	const dispose = () => {
		if (disposed) return
		clearTimer()
		cancelOwnedRemote()
		disposed = true
		counter++
	}

	onScopeDispose(dispose)

	return { result, isEstimating, estimate: schedule, cancel, handoff, dispose }
}
