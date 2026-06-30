/**
 * JSON-stringify replacer that handles the types the wallet-sdk surface returns:
 *   - bigint → decimal string
 *   - Fr / AztecAddress / Buffer-like → toString()
 *   - undefined → null (so JSON.stringify keeps the key)
 *
 * Used by the result feed so tests can read `data-result-json` and JSON.parse it
 * without losing information from BN-style fields.
 */
export function safeJsonStringify(value: unknown, indent = 0): string {
	return JSON.stringify(
		value,
		(_key, v) => {
			if (typeof v === "bigint") return v.toString()
			if (v && typeof v === "object" && "toString" in v && typeof v.toString === "function") {
				const proto = Object.getPrototypeOf(v)
				const ctorName = proto?.constructor?.name
				if (ctorName === "Fr" || ctorName === "AztecAddress" || ctorName === "EthAddress" || ctorName === "Buffer") {
					return v.toString()
				}
			}
			return v
		},
		indent,
	)
}
