/**
 * Make a dispatch result safe for the wallet-sdk's plain JSON.stringify:
 * BigInt → string (stringify throws on BigInt; PXE results are full of them —
 * Fr fields, addresses), Map/Set → arrays, recursion through objects.
 *
 * Cycle guard tracks the ANCESTOR chain, not every visited node: a value that
 * appears twice as a sibling (a shared Fr singleton, a cached row referenced
 * from two fields — a DAG edge) serializes in full at both sites; only a true
 * ancestor cycle collapses to "[Circular]". The delete runs in a finally so a
 * throwing child can never leave its ancestor marked and misclassify a later
 * legitimate reference.
 */
export function toJsonSafe(value: unknown, ancestors = new WeakSet()): unknown {
	if (value === null || value === undefined) return value
	if (typeof value === "bigint") return value.toString()
	if (typeof value !== "object") return value

	if (ancestors.has(value as object)) return "[Circular]"
	ancestors.add(value as object)
	try {
		if (Array.isArray(value)) return value.map((v) => toJsonSafe(v, ancestors))
		if (value instanceof Map) {
			return Array.from(value.entries(), ([k, v]) => [toJsonSafe(k, ancestors), toJsonSafe(v, ancestors)])
		}
		if (value instanceof Set) {
			return Array.from(value, (v) => toJsonSafe(v, ancestors))
		}
		// Objects with a toJSON method (Fr, AztecAddress, etc.) — let it shape
		// the output, but recurse the RESULT under the SAME ancestor frame so a
		// toJSON returning its own ancestor still terminates.
		const obj = value as Record<string, unknown>
		if (typeof obj.toJSON === "function") {
			return toJsonSafe(obj.toJSON(), ancestors)
		}
		const out: Record<string, unknown> = {}
		for (const key of Object.keys(obj)) {
			out[key] = toJsonSafe(obj[key], ancestors)
		}
		return out
	} finally {
		ancestors.delete(value as object)
	}
}
