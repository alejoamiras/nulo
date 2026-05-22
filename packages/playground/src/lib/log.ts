/**
 * Wrap an async wallet-sdk call so the result feed records:
 *   - a pending row immediately on invocation (lets tests detect "call started"
 *     deterministically rather than via timing windows)
 *   - the settled row on success/failure
 *
 * Returns the call's resolved value (or rethrows) — the feed update is a side effect.
 */
import { appendPendingResult, settleResult } from "../state"
import { E2E_PROBE_ENABLED, probe } from "./probe"

export async function logCall<T>(method: string, fn: () => Promise<T>): Promise<T> {
	const seq = appendPendingResult(method)
	const startedAt = Date.now()
	if (E2E_PROBE_ENABLED) probe("PG-OUT", { method, seq })
	try {
		const result = await fn()
		settleResult(seq, "ok", result)
		if (E2E_PROBE_ENABLED) probe("PG-IN", { method, seq, status: "ok", elapsedMs: Date.now() - startedAt })
		return result
	} catch (err) {
		settleResult(seq, "error", err)
		if (E2E_PROBE_ENABLED) probe("PG-IN", { method, seq, status: "error", elapsedMs: Date.now() - startedAt })
		throw err
	}
}
