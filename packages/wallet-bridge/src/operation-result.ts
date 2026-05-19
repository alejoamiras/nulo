export type OperationResult<T = unknown> = OkOperationResult<T> | FailedOperationResult | CancelledOperationResult | SkippedOperationResult

export type OkOperationResult<T> = {
	status: "ok"
	result: T
}

export type FailedOperationResult = {
	status: "failed"
	error: string
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
