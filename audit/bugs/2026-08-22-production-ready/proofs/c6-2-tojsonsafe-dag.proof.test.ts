/**
 * BUG PROOF — C6-2: `toJsonSafe`'s cycle guard treats SHARED (non-cyclic)
 * references as cycles, corrupting dApp responses.
 *
 * PROVENANCE: the function below is copied VERBATIM from
 * apps/extension/src/wallet/services/wallet-sdk/background.ts:753-787 (the
 * function is module-private, so it cannot be imported directly; this copy is
 * byte-for-byte and must be re-synced if the source changes). Every dispatched
 * method's success path runs its result through this exact algorithm
 * (`background.ts:695`).
 *
 * The `seen` WeakSet accumulates every visited node and is never pruned, so a
 * value appearing TWICE in a result tree (a DAG edge, not a cycle) serializes
 * the second occurrence as the literal string "[Circular]". `Fr.ZERO` is a
 * module singleton used pervasively across @aztec/*, so any response carrying
 * one shared instance twice hits this. The internal RPC path is immune
 * (jsonSanitize destroys identity); only the dApp response path is exposed.
 *
 * RED today: second occurrence becomes "[Circular]". GREEN after fix: each
 * occurrence serializes in full; only true ancestor cycles are substituted.
 */
import { Fr } from "@aztec/foundation/curves/bn254"
import { describe, expect, test } from "vitest"

function toJsonSafe(value: unknown, seen = new WeakSet()): unknown {
	if (value === null || value === undefined) return value
	if (typeof value === "bigint") return value.toString()
	if (typeof value !== "object") return value

	if (seen.has(value as object)) return "[Circular]"
	seen.add(value as object)

	if (Array.isArray(value)) return value.map((v) => toJsonSafe(v, seen))
	if (value instanceof Map) {
		return Array.from(value.entries(), ([k, v]) => [toJsonSafe(k, seen), toJsonSafe(v, seen)])
	}
	if (value instanceof Set) {
		return Array.from(value, (v) => toJsonSafe(v, seen))
	}
	const obj = value as Record<string, unknown>
	if (typeof obj.toJSON === "function") {
		return toJsonSafe(obj.toJSON(), seen)
	}
	const out: Record<string, unknown> = {}
	for (const key of Object.keys(obj)) {
		out[key] = toJsonSafe(obj[key], seen)
	}
	return out
}

describe("C6-2: toJsonSafe must serialize repeated non-cyclic references in full", () => {
	test("the same object referenced twice is not '[Circular]'", () => {
		const zero = Fr.ZERO
		const out = toJsonSafe({ maxFee: zero, fee: zero }) as { maxFee: unknown; fee: unknown }

		expect(out.fee).toEqual(out.maxFee)
		expect(out.fee).not.toBe("[Circular]")
	})

	test("a true cycle still terminates", () => {
		const a: Record<string, unknown> = {}
		a.self = a
		expect(() => JSON.stringify(toJsonSafe(a))).not.toThrow()
	})
})
