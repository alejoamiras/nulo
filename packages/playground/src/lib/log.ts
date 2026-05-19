/**
 * Wrap an async wallet-sdk call so the result feed records:
 *   - a pending row immediately on invocation (lets tests detect "call started"
 *     deterministically rather than via timing windows)
 *   - the settled row on success/failure
 *
 * Returns the call's resolved value (or rethrows) — the feed update is a side effect.
 */
import { appendPendingResult, settleResult } from "../state"

export async function logCall<T>(method: string, fn: () => Promise<T>): Promise<T> {
	const seq = appendPendingResult(method)
	try {
		const result = await fn()
		settleResult(seq, "ok", result)
		return result
	} catch (err) {
		settleResult(seq, "error", err)
		throw err
	}
}
