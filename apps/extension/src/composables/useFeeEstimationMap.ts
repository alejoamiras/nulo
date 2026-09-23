import { onScopeDispose, ref, type Ref } from "vue"
import { createFeeEstimationEngine } from "./internal/fee-estimation-engine"

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
	 * Disarm cancellation for every key's COMPLETED estimate — call on
	 * approve, BEFORE the window closes, so unmount cleanup cannot race the
	 * fire-and-forget execution out of its stashed reuse entries. In-flight
	 * estimates are deliberately left armed: their ids never reach the
	 * approve payload, so handing them off would only orphan their eventual
	 * stashes. Returns the handed-off token per key.
	 */
	handoffAll: () => Partial<Record<TKey, string>>
	/** Undo handoffAll after a FAILED approve — the execution path never
	 *  took ownership, so normal cancellation must apply again. */
	rearm: () => void
	/** Manually dispose. Auto-runs on scope stop. */
	dispose: () => void
}

export function useFeeEstimationMap<TKey extends string | number, TParams, TResult>(
	options: UseFeeEstimationMapOptions<TKey, TParams, TResult>,
): UseFeeEstimationMapResult<TKey, TParams, TResult> {
	const { estimate, debounceMs = 500, onError, cancelRemote } = options

	const results = ref({}) as Ref<Record<TKey, TResult | null>>
	const estimating = ref({}) as Ref<Record<TKey, boolean>>

	// Scopes the SW-side coalescing slot to THIS composable instance: two
	// concurrent approval windows both estimating op 0 must never share a
	// latest-wins slot, or one window's parked estimate would evict the
	// other's under capacity pressure.
	const instanceId = Math.random().toString(36).slice(2, 8)

	const engine = createFeeEstimationEngine<TKey, TParams, TResult>({
		run: (params, estimateToken, key) => estimate(params, estimateToken, `op:${instanceId}:${String(key)}`),
		debounceMs,
		onResult: (key, r) => {
			results.value[key] = r
		},
		onEstimating: (key, e) => {
			estimating.value[key] = e
		},
		onError,
		cancelRemote,
	})

	onScopeDispose(engine.dispose)

	const handoffAll = (): Partial<Record<TKey, string>> => {
		const tokens: Partial<Record<TKey, string>> = {}
		engine.handoffCompleted((key, token) => {
			tokens[key] = token
		})
		return tokens
	}

	return {
		results,
		estimating,
		estimate: engine.schedule,
		cancel: engine.cancel,
		cancelAll: engine.cancelAll,
		handoffAll,
		rearm: engine.rearm,
		dispose: engine.dispose,
	}
}
