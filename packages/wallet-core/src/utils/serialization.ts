/**
 * JSON serialization for Aztec/Node-style values. Buffers, Maps, Sets,
 * bigints, and Errors round-trip via `jsonStringify`. Copied (with
 * Buffer handling) from `@aztec/foundation/json-rpc`.
 *
 * Why a naked `Buffer` identifier + `declare`: wallet-core's tsconfig
 * ships with `"types": []` to stay Node-types free. In tests (vitest,
 * node env) Buffer is a real global; in the extension bundle,
 * vite-plugin-node-polyfills' `globals: { Buffer: true }` option tells
 * rollup's inject plugin to auto-import Buffer from its shim wherever
 * a naked `Buffer` reference appears. Using `import { Buffer } from
 * "buffer"` breaks because vite's polyfill rewrites the path to one
 * that can't be resolved from a different workspace package. Using
 * `globalThis.Buffer` breaks because `globals: true` does *not* publish
 * Buffer onto globalThis — it only wires the identifier-rewrite.
 */

declare const Buffer: {
	from(data: unknown, encoding?: string): { toString(encoding: string): string }
	isBuffer(x: unknown): boolean
}

// copied from @aztec/foundation/json-rpc
export function jsonStringify(obj: unknown): string {
	return JSON.stringify(obj, (_key, value) => {
		if (typeof value === "bigint") {
			return value.toString()
		} else if (typeof value === "object" && value && value.type === "Buffer" && Array.isArray(value.data)) {
			return Buffer.from(value.data).toString("base64")
		} else if (typeof value === "object" && value && Buffer.isBuffer(value)) {
			return (value as { toString(encoding: string): string }).toString("base64")
		} else if (typeof value === "object" && value instanceof Map) {
			return Array.from(value.entries())
		} else if (typeof value === "object" && value instanceof Set) {
			return Array.from(value.values())
		} else if (value instanceof Error) {
			// Error's `name`, `message`, and `stack` are non-enumerable, so
			// JSON.stringify silently drops them and returns `{}`. Serialize
			// them explicitly. WalletError subclasses (from base/errors.ts)
			// add `code` + optional `details` which we also preserve.
			// Reconstruction on the receiving side is deserializer-agnostic:
			// consumers that check `x instanceof Error` will now at least
			// see `{ name, message, stack?, code?, details? }` and can
			// format it usefully.
			const err = value as Error & { code?: unknown; details?: unknown }
			return {
				name: err.name,
				message: err.message,
				...(err.stack !== undefined ? { stack: err.stack } : {}),
				...(err.code !== undefined ? { code: err.code } : {}),
				...(err.details !== undefined ? { details: err.details } : {}),
			}
		} else {
			return value
		}
	})
}

export function jsonSanitize<T>(obj: T): T {
	return (obj !== undefined ? JSON.parse(jsonStringify(obj)) : undefined) as T
}
