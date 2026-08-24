import { Fr } from "@aztec/foundation/curves/bn254"
import { describe, expect, test } from "vitest"
import { toJsonSafe } from "./to-json-safe"

/**
 * Adopts the 2026-08-22 audit's c6-2 proof (previously a fragile verbatim
 * copy — the function was module-private): shared NON-cyclic references must
 * serialize in full; only true ancestor cycles collapse to "[Circular]".
 */
describe("toJsonSafe — shared references vs cycles", () => {
	test("the same object referenced twice is not '[Circular]' (c6-2 pin)", () => {
		const zero = Fr.ZERO
		const out = toJsonSafe({ maxFee: zero, fee: zero }) as { maxFee: unknown; fee: unknown }
		expect(out.fee).toEqual(out.maxFee)
		expect(out.fee).not.toBe("[Circular]")
	})

	test("a true cycle still terminates (c6-2 pin)", () => {
		const a: Record<string, unknown> = {}
		a.self = a
		expect(() => JSON.stringify(toJsonSafe(a))).not.toThrow()
		expect((toJsonSafe(a) as Record<string, unknown>).self).toBe("[Circular]")
	})

	test("a value revisited AFTER leaving its subtree serializes in full (ancestor semantics)", () => {
		const shared = { n: 7n }
		const out = toJsonSafe({ first: { inner: shared }, second: shared }) as {
			first: { inner: { n: string } }
			second: { n: string }
		}
		expect(out.first.inner).toEqual({ n: "7" })
		expect(out.second).toEqual({ n: "7" })
	})

	test("a deep cycle through an array and a map collapses only the cycling edge", () => {
		const root: Record<string, unknown> = { list: [] as unknown[] }
		;(root.list as unknown[]).push(new Map([["back", root]]))
		const out = toJsonSafe(root) as { list: Array<Array<[string, unknown]>> }
		expect(out.list[0][0][1]).toBe("[Circular]")
	})

	test("a throwing child does not leave its ancestor marked (finally cleanup)", () => {
		const poison = {
			get boom(): never {
				throw new Error("reader boom")
			},
		}
		const reused = { ok: true }
		expect(() => toJsonSafe({ a: poison })).toThrow("reader boom")
		// The SAME WeakSet instance is internal per call — a fresh call must
		// treat previously-visited objects as clean.
		const out = toJsonSafe({ x: reused, y: reused }) as { x: unknown; y: unknown }
		expect(out.y).toEqual({ ok: true })
	})
})

describe("toJsonSafe — existing branch behavior preserved", () => {
	test("bigint → string, primitives pass through, null/undefined pass through", () => {
		expect(toJsonSafe(42n)).toBe("42")
		expect(toJsonSafe("s")).toBe("s")
		expect(toJsonSafe(null)).toBeNull()
		expect(toJsonSafe(undefined)).toBeUndefined()
	})

	test("Map and Set become arrays with converted members", () => {
		expect(toJsonSafe(new Map([[1n, 2n]]))).toEqual([["1", "2"]])
		expect(toJsonSafe(new Set([3n]))).toEqual(["3"])
	})

	test("toJSON is honored and its result recursed", () => {
		const custom = { toJSON: () => ({ inner: 5n }) }
		expect(toJsonSafe(custom)).toEqual({ inner: "5" })
	})

	test("a toJSON returning its own ancestor still terminates", () => {
		const evil: Record<string, unknown> = {}
		evil.toJSON = () => ({ back: evil })
		const out = toJsonSafe(evil) as { back: unknown }
		expect(out.back).toBe("[Circular]")
	})
})
