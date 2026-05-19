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

	test("never throws — hostile Proxy that throws on .message access still returns a fallback", () => {
		const hostile = new Proxy(
			{},
			{
				get: () => {
					throw new Error("trap")
				},
			},
		)

		const result = normalizeError(hostile, "unknown")

		// Outer try/catch fallback is reachable; envelope is still valid
		expect(result.kind).toBe("unknown")
		expect(typeof result.message).toBe("string")
		// normalizedRaw may be null OR the inner trySerialize succeeded — both fine
		// What we care about: function did not throw.
		expect(result).toHaveProperty("normalizedRaw")
	})

	test("non-Error values (strings, numbers, null, undefined) round-trip safely", () => {
		expect(normalizeError("just a string", "unknown").message).toBe("just a string")
		expect(normalizeError(42).message).toBe("42")
		expect(normalizeError(null).message).toBe("null")
		expect(normalizeError(undefined).message).toBe("undefined")
	})
})
