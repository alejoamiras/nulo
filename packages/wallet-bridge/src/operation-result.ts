export type OperationResult<T = unknown> = OkOperationResult<T> | FailedOperationResult | CancelledOperationResult | SkippedOperationResult

export type OkOperationResult<T> = {
	status: "ok"
	result: T
}

export type FailedOperationResult = {
	status: "failed"
	error: string
	/** `DuplicateInitializationError.CODE` when the executor threw that ONE
	 *  typed error (the sole failure whose dApp discrimination is a ratified
	 *  contract, and whose reconstruction is lossless message-only). The
	 *  result crosses process boundaries as data, so the class identity is
	 *  carried here and re-materialized at unwrap — a blanket WalletError
	 *  pass-through is deliberately NOT done (detail-dependent classes and
	 *  base-reconstruction policies would corrupt). */
	code?: string
}

/**
 * The user cancelled this operation after approval, mid-prove. Distinct
 * from `failed` so dApps can suppress error UI for an intentional cancel,
 * and distinct from `skipped` (which the aggregator sets for batch siblings
 * after the first non-ok result). `jobId` correlates with the journal
 * record. `reason` is future-proof — today always `"user"`, will gain
 * `"timeout"` etc.
 */
export type CancelledOperationResult = {
	status: "cancelled"
	jobId?: string
	reason?: "user" | "timeout"
}

export type SkippedOperationResult = {
	status: "skipped"
}
