/** Max RPC arity. No wallet method takes anywhere near this many args; the cap
 *  bounds `unwrapParams` so a hostile params object can't drive a huge loop. */
const MAX_RPC_ARITY = 256

export const wrapParams = (params: unknown[]): Record<number, unknown> => {
	return params.reduce<Record<number, unknown>>((acc, v, i) => {
		acc[i] = v
		return acc
	}, {})
}

/**
 * Reverse `wrapParams`: read the contiguous `0..n` prefix into an array.
 *
 * Hardened against hostile input. The previous implementation took
 * `max(keys)` and looped `0..max`, so a crafted `{999999999: "x"}` (which
 * passes the service's typeof-object guard) drove a ~10^9-iteration loop — a
 * trivial internal DoS. This reads only the contiguous prefix and stops at the
 * first gap, capped at `MAX_RPC_ARITY`, so sparse / oversized key sets degrade
 * to a short array instead of a runaway loop.
 */
export const unwrapParams = <T>(params: T): T => {
	const obj = params as Record<number, unknown>
	// Gap-TOLERANT on purpose: the wire strips `undefined`-valued entries (`jsonSanitize`'s
	// JSON.stringify drops them), so a mid-position `undefined` argument arrives as a KEY GAP —
	// e.g. `exportPlain(id, undefined, credentialData)` wraps to `{0, 2}`. Stopping at the first
	// gap silently truncated every argument after it (which broke passkey full-backup export).
	// Scanning the fixed 0..MAX_RPC_ARITY window keeps the DoS bound (constant work regardless of
	// hostile key sets) while restoring holes as `undefined`; trailing holes still degrade to a
	// shorter array, which is semantically equivalent for optional trailing params.
	let last = -1
	for (let i = 0; i < MAX_RPC_ARITY; i++) {
		if (Object.hasOwn(obj, i)) last = i
	}
	const res: unknown[] = []
	for (let i = 0; i <= last; i++) {
		res.push(Object.hasOwn(obj, i) ? obj[i] : undefined)
	}
	return res as T
}
