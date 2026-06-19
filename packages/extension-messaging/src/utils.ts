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
	const res: unknown[] = []
	for (let i = 0; i < MAX_RPC_ARITY && Object.hasOwn(obj, i); i++) {
		res.push(obj[i])
	}
	return res as T
}
