import { describe, expect, test } from "vitest"

import { normalizeError } from "./error"
import { NORMALIZED_RAW_MAX_CHARS } from "./types"

describe("normalizeError", () => {
	test("captures Error subclasses with stack into JobError envelope", () => {
		const err = new Error("boom")
		const result = normalizeError(err, "prover")

		expect(result.kind).toBe("prover")
		expect(result.message).toBe("boom")
		expect(result.normalizedRaw).toBeTypeOf("string")
		expect(result.normalizedRaw).toContain("boom")
	})

	test("Error envelope carries the __error discriminant + standard fields", () => {
		const parsed = JSON.parse(normalizeError(new Error("boom"), "prover").normalizedRaw!) as Record<string, unknown>
		expect(parsed.__error).toBe(true)
		expect(parsed.name).toBe("Error")
		expect(parsed.message).toBe("boom")
		expect(typeof parsed.stack).toBe("string")
	})

	test("bigint serializes with the trailing-n suffix (diverges from wire serialization's plain string)", () => {
		expect(normalizeError({ value: 123n }, "unknown").normalizedRaw).toBe('{"value":"123n"}')
	})

	test("handles BigInt and circular refs without throwing", () => {
		const cyclic: { self?: unknown; value: bigint } = { value: 99n }
		cyclic.self = cyclic
		const result = normalizeError(cyclic, "network")

		expect(result.kind).toBe("network")
		// JSON.stringify on a circular ref throws — trySerialize returns null
		expect(result.normalizedRaw).toBeNull()
		// `message` is whatever String() returns; never throws
		expect(typeof result.message).toBe("string")
	})

	test("caps normalizedRaw at NORMALIZED_RAW_MAX_CHARS with truncation suffix", () => {
		const huge = "x".repeat(NORMALIZED_RAW_MAX_CHARS * 2)
		const result = normalizeError(new Error(huge), "unknown")

		expect(result.normalizedRaw).not.toBeNull()
		expect(result.normalizedRaw!.length).toBeLessThanOrEqual(NORMALIZED_RAW_MAX_CHARS)
		expect(result.normalizedRaw).toMatch(/…\[truncated\]$/)
	})

	test("never throws — hostile Proxy hits the exact outer-catch fallback envelope", () => {
		const hostile = new Proxy(
			{},
			{
				get: () => {
					throw new Error("trap")
				},
			},
		)

		// `extractMessage` calls `String(hostile)`, whose ToPrimitive triggers the
		// throwing `get` trap before `trySerialize` runs, so the OUTER try/catch is
		// the only thing between that and a re-throw. Pin the EXACT fallback
		// envelope (the load-bearing never-throw guarantee), not merely "didn't throw".
		expect(normalizeError(hostile, "unknown")).toEqual({
			kind: "unknown",
			message: "<unrenderable error>",
			normalizedRaw: null,
		})
	})

	test("non-Error values (strings, numbers, null, undefined) round-trip safely", () => {
		expect(normalizeError("just a string", "unknown").message).toBe("just a string")
		expect(normalizeError(42).message).toBe("42")
		expect(normalizeError(null).message).toBe("null")
		expect(normalizeError(undefined).message).toBe("undefined")
	})
})
