/**
 * Pins for the RPC param wire format: the explicit-arity round-trip (an
 * `undefined` mid-argument must survive JSON serialization — the wire drops
 * undefined-valued keys, and a gap-stopping reader then truncated every
 * argument after the hole) and the DoS-hardening posture it must preserve.
 */

import { jsonSanitize } from "@nulo/wallet-core/utils"
import { describe, expect, test } from "vitest"
import { unwrapParams, wrapParams } from "./utils"

/** The actual wire: postMessage payloads go through base-client.ts's real `jsonSanitize`, not a hand-rolled JSON shim. */
const overTheWire = <T>(value: T): T => jsonSanitize(value)

describe("wrapParams/unwrapParams — explicit-arity round-trip", () => {
	test("an undefined MIDDLE argument survives the wire; later args are not truncated", () => {
		const args = ["profile-1", undefined, { id: "cred", prf: "secret" }]
		const out = unwrapParams(overTheWire(wrapParams(args)))
		expect(out).toEqual(["profile-1", undefined, { id: "cred", prf: "secret" }])
		expect(out).toHaveLength(3)
	})

	test("multiple holes and a trailing undefined all keep their positions", () => {
		const args = [undefined, "b", undefined, null, undefined]
		expect(unwrapParams(overTheWire(wrapParams(args)))).toEqual([undefined, "b", undefined, null, undefined])
	})

	test("zero-arg and dense calls round-trip unchanged", () => {
		expect(unwrapParams(overTheWire(wrapParams([])))).toEqual([])
		expect(unwrapParams(overTheWire(wrapParams([1, "two", { three: 3 }])))).toEqual([1, "two", { three: 3 }])
	})
})

describe("unwrapParams — hostile-input posture (unchanged)", () => {
	test("sparse huge-key payload without n cannot drive a runaway loop", () => {
		expect(unwrapParams({ 999999999: "x" })).toEqual([])
	})

	test("bogus n values are ignored: negative, fractional, huge, non-numeric", () => {
		expect(unwrapParams({ 0: "a", n: -1 })).toEqual(["a"])
		expect(unwrapParams({ 0: "a", n: 1.5 })).toEqual(["a"])
		expect(unwrapParams({ 0: "a", n: 10_000_000 })).toEqual(["a"])
		expect(unwrapParams({ 0: "a", n: "256" })).toEqual(["a"])
	})

	test("payload WITHOUT n (stale sender / hand-rolled object) degrades to the contiguous-prefix read", () => {
		expect(unwrapParams({ 0: "a", 1: "b", 3: "after-gap" })).toEqual(["a", "b"])
	})

	test("n is capped at the max arity on the wrap side too", () => {
		const wrapped = wrapParams(Array.from({ length: 500 }, (_, i) => i))
		expect(wrapped.n).toBe(256)
		expect(unwrapParams(overTheWire(wrapped))).toHaveLength(256)
	})
})
