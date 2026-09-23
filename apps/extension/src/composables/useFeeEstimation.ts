import { onScopeDispose, ref, type Ref } from "vue"
import { createFeeEstimationEngine } from "./internal/fee-estimation-engine"

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
	 * Deliberately in-flight-inclusive, unlike the keyed `handoffAll()`.
	 */
	handoff: () => string | null
	/** Manually dispose. Auto-runs on scope stop. */
	dispose: () => void
}

/** The engine is keyed; the single-slot composable uses one fixed key. */
const SINGLE_SLOT = 0

export function useFeeEstimation<TParams, TResult>(
	options: UseFeeEstimationOptions<TParams, TResult>,
): UseFeeEstimationResult<TParams, TResult> {
	const { estimate, debounceMs = 800, onError, cancelRemote } = options

	const result = ref<TResult | null>(null) as Ref<TResult | null>
	const isEstimating = ref(false)

	const engine = createFeeEstimationEngine<typeof SINGLE_SLOT, TParams, TResult>({
		// The single-slot path does no per-op SW-side coalescing — no flowKey
		// (or instanceId) exists here; the estimator keeps its 2-arg shape.
		run: (params, estimateToken) => estimate(params, estimateToken),
		debounceMs,
		onResult: (_key, r) => {
			result.value = r
		},
		onEstimating: (_key, estimating) => {
			isEstimating.value = estimating
		},
		onError: onError ? (_key, err) => onError(err) : undefined,
		cancelRemote,
	})

	onScopeDispose(engine.dispose)

	return {
		result,
		isEstimating,
		estimate: (params) => engine.schedule(SINGLE_SLOT, params),
		cancel: () => engine.cancel(SINGLE_SLOT),
		handoff: () => engine.handoffInclusive(SINGLE_SLOT),
		dispose: engine.dispose,
	}
}
