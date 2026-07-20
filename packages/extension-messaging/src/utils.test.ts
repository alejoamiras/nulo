import { jsonSanitize } from "@nulo/wallet-core/utils"
import { describe, expect, test } from "vitest"
import { unwrapParams, wrapParams } from "./utils"

describe("wrapParams / unwrapParams", () => {
	test("dense args round-trip", () => {
		expect(unwrapParams(wrapParams(["a", 2, { x: 1 }]))).toEqual(["a", 2, { x: 1 }])
	})

	test("REGRESSION: a mid-position undefined survives the full wire path (jsonSanitize gap)", () => {
		// jsonSanitize's JSON.stringify DROPS undefined-valued keys, so {0,1:undefined,2} arrives
		// as {0,2}. The first-gap-stop unwrap truncated to [id] and silently discarded every later
		// argument — the exact failure behind "credentialData is required for passkey profile" in
		// the passkey full-backup export flow (exportPlain(id, undefined, credentialData)).
		const wire = jsonSanitize(wrapParams(["id", undefined, { credential: "data" }]))
		expect(unwrapParams(wire)).toEqual(["id", undefined, { credential: "data" }])
	})

	test("multiple interior gaps restore as undefined holes", () => {
		expect(unwrapParams({ 0: "a", 3: "d" })).toEqual(["a", undefined, undefined, "d"])
	})

	test("trailing undefined degrades to shorter arity (equivalent for optional params)", () => {
		const wire = jsonSanitize(wrapParams(["id", undefined]))
		expect(unwrapParams(wire)).toEqual(["id"])
	})

	test("hostile sparse key does not DoS and unwraps to no args", () => {
		expect(unwrapParams({ 999999999: "x" })).toEqual([])
	})

	test("hostile max-boundary key stays bounded at the arity cap", () => {
		const res = unwrapParams({ 255: "x" }) as unknown as unknown[]
		expect(res.length).toBe(256)
		expect(res[255]).toBe("x")
		expect(unwrapParams({ 256: "x" })).toEqual([])
	})
})
