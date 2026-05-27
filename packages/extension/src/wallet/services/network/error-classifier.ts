/**
 * Classifies errors thrown by AztecNode method calls into failure-tracking
 * buckets. The output drives whether a call counts toward the endpoint's
 * failure threshold and how aggressively we react.
 *
 * Buckets:
 *   - hard:   count toward the hard failure counter (threshold 2 → failover)
 *   - soft:   count toward the soft failure counter (threshold 8 → failover)
 *   - ignore: not counted; either a client bug, user cancel, or 2xx-with-parse-error
 *   - evict:  permanent session quarantine (chainId-mismatch case only)
 *
 * The classification is conservative — anything we can't confidently bucket
 * lands in `ignore`. False ignores are recoverable (the user re-tries); false
 * hards are noisy (early failover when the endpoint is actually fine).
 *
 * The fetch layer at `packages/aztec-runtime/src/utils/fetch.ts` already does
 * its own retry-with-backoff, so by the time a counted failure reaches this
 * helper, it's "this endpoint failed despite N transport-level retries."
 */

export type FailureKind = "hard" | "soft" | "ignore" | "evict"
export type FailureClassification = { kind: FailureKind; reason: string }

export function classifyEndpointError(err: unknown): FailureClassification {
	if (err === undefined || err === null) return { kind: "ignore", reason: "no error" }

	// User-initiated abort. DOMException is the runtime shape; some envs throw a
	// plain Error with name = AbortError.
	if (
		(typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") ||
		(err instanceof Error && err.name === "AbortError")
	) {
		return { kind: "ignore", reason: "user abort" }
	}

	const msg = String((err as { message?: string })?.message ?? err)

	// HTTP status — check before generic string-matching so structured signals win.
	const status = (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode
	if (typeof status === "number" && Number.isFinite(status)) {
		if (status === 429) return { kind: "hard", reason: "http: 429 rate limit" }
		if (status >= 500) return { kind: "hard", reason: `http: ${status}` }
		if (status >= 400) return { kind: "soft", reason: `http: ${status}` }
	}

	// JSON-RPC envelope error code.
	const code = (err as { code?: number })?.code
	if (typeof code === "number" && Number.isFinite(code)) {
		if (code === -32603) return { kind: "hard", reason: "jsonrpc: -32603 internal" }
		if (code >= -32099 && code <= -32000) {
			return { kind: "hard", reason: `jsonrpc: ${code} server-defined` }
		}
		if (code === -32600 || code === -32601 || code === -32602) {
			return { kind: "ignore", reason: `jsonrpc: ${code} client bug` }
		}
	}

	// chainId-mismatch signalled by network/service.ts via ERR_ENDPOINT_CHAIN_MISMATCH.
	// This is the only path that triggers permanent session quarantine; rest just
	// count toward the threshold.
	if (/ENDPOINT_CHAIN_MISMATCH/i.test(msg)) {
		return { kind: "evict", reason: "chainId mismatch" }
	}

	// Fetch-level transport failures. TypeError from undici/web-fetch, plus the
	// platform-specific connection-refused / DNS / TLS errors.
	if (err instanceof TypeError && /fetch|network|failed to fetch/i.test(msg)) {
		return { kind: "hard", reason: "transport: fetch reject" }
	}
	if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|certificate|TLS|self.signed/i.test(msg)) {
		return { kind: "hard", reason: "transport: connect/TLS" }
	}

	// Heuristic: server-overloaded messages without explicit code. These are the
	// most common "endpoint is breathing but won't serve" signals.
	if (/timeout|overloaded|unavailable|service unavailable/i.test(msg)) {
		return { kind: "hard", reason: "msg: overloaded/timeout" }
	}

	return { kind: "ignore", reason: "uncategorized" }
}
