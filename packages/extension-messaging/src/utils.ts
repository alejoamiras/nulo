/** Max RPC arity. No wallet method takes anywhere near this many args; the cap
 *  bounds `unwrapParams` so a hostile params object can't drive a huge loop. */
const MAX_RPC_ARITY = 256

/**
 * Positional params wrapped with an EXPLICIT arity in `n`.
 *
 * The arity field exists because the wire is JSON: `JSON.stringify` DROPS
 * object keys whose value is `undefined`, so a call like `f(a, undefined, c)`
 * wrapped as `{0: a, 1: undefined, 2: c}` arrives as `{0: a, 2: c}` — and a
 * gap-stopping reader then truncates EVERY argument after the hole (observed
 * live: `exportPlain(id, undefined, credentialData)` reached the service as
 * `exportPlain(id)`). `n` preserves the true length so holes survive the
 * round-trip as `undefined`, which is what optional parameters expect.
 */
export const wrapParams = (params: unknown[]): Record<number, unknown> & { n: number } => {
	const acc: Record<number, unknown> & { n: number } = { n: Math.min(params.length, MAX_RPC_ARITY) }
	params.slice(0, MAX_RPC_ARITY).forEach((v, i) => {
		acc[i] = v
	})
	return acc
}

/**
 * Reverse `wrapParams`: read `0..n-1` (missing keys → `undefined`), capped at
 * `MAX_RPC_ARITY`.
 *
 * Hardened against hostile input, same posture as before: a crafted
 * `{999999999: "x"}` or a bogus/huge `n` cannot drive a runaway loop — `n` is
 * honored only when it's a sane integer within the cap. Payloads WITHOUT `n`
 * (a hostile hand-rolled object, or a stale pre-`n` sender) degrade to the
 * old contiguous-prefix read, which stops at the first gap.
 */
export const unwrapParams = <T>(params: T): T => {
	const obj = params as Record<number, unknown> & { n?: unknown }
	const res: unknown[] = []
	const n = typeof obj.n === "number" && Number.isInteger(obj.n) && obj.n >= 0 && obj.n <= MAX_RPC_ARITY ? obj.n : undefined
	if (n !== undefined) {
		for (let i = 0; i < n; i++) {
			res.push(Object.hasOwn(obj, i) ? obj[i] : undefined)
		}
		return res as T
	}
	for (let i = 0; i < MAX_RPC_ARITY && Object.hasOwn(obj, i); i++) {
		res.push(obj[i])
	}
	return res as T
}
